/**
 * Compliance worker — fact-checks generated application materials.
 *
 * Uses asi1-mini (fast, cheap) to verify:
 *   - No numeric metrics outside the verified allowlist
 *   - No fabricated employers, projects, or experiences
 *   - No writing-style violations
 *
 * Outcomes:
 *   pass = true  →  status = ReadyForReview + follow-ups scheduled (D+7, D+14)
 *   pass = false →  status stays Drafting, flags logged for human review
 */
import type { Job } from "bullmq";
import pino from "pino";
import { createPostgresClient } from "@shared/db/clients";
import { asi } from "@shared/asi";
import { kb } from "../kb.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

interface CompliancePayload {
  jobId: string;
  resumeVersionId?: string | null;
  coverLetter?: string;
  tailoredBullets?: string[];
}

interface ComplianceResult {
  pass?: boolean;
  flags?: { excerpt: string; issue: string }[];
  summary?: string;
}

export async function runCompliance(job: Job<CompliancePayload>): Promise<void> {
  const { jobId, coverLetter, tailoredBullets } = job.data;
  const pg = createPostgresClient();

  const metricsAllowlist = kb.resume.metricsAllowlist();
  const writingStyle = kb.tone.writingStyle();

  const draftContent = [coverLetter ?? "", ...(tailoredBullets ?? [])].join("\n\n");

  const res = await asi.chat.completions.create({
    model: "asi1-mini",
    messages: [
      {
        role: "system",
        content:
          "You are a strict compliance checker for job application materials. Verify all claims against the provided allowlist. Respond with valid JSON only. No markdown, no code fences.",
      },
      {
        role: "user",
        content: `Fact-check these application materials.

=== VERIFIED METRICS ALLOWLIST ===
${JSON.stringify(metricsAllowlist.allowed_metrics, null, 2)}

=== WRITING CONSTRAINTS ===
${writingStyle.constraints.map((c) => `- ${c}`).join("\n")}

=== DRAFT MATERIALS TO CHECK ===
${draftContent}

Check every sentence for:
1. Numeric metrics (%, numbers, counts) NOT present in the allowlist → flag as unverified
2. Employer, company, or project names that seem fabricated
3. First-person claims that are exaggerated or unverifiable
4. Writing style violations (e.g. markdown fences in cover letter, forbidden formatting)

Return JSON:
{
  "pass": true,
  "flags": [
    { "excerpt": "the exact flagged text", "issue": "why it is flagged" }
  ],
  "summary": "one-sentence summary of the check result"
}

Set "pass": true only if there are ZERO flags.`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const result = JSON.parse(res.choices[0].message.content ?? "{}") as ComplianceResult;
  const passed = result.pass === true && (result.flags ?? []).length === 0;
  const newStatus = passed ? "ReadyForReview" : "Drafting";

  await pg.query(`UPDATE job_postings SET status = $2 WHERE id = $1`, [jobId, newStatus]);

  if (passed) {
    // Schedule follow-ups: D+7 and D+14 from today
    const today = new Date();
    for (const [followupNumber, daysOffset] of [
      [1, 7],
      [2, 14],
    ] as [number, number][]) {
      const scheduledFor = new Date(today.getTime() + daysOffset * 86_400_000)
        .toISOString()
        .split("T")[0];

      await pg.query(
        `INSERT INTO followups (job_id, followup_number, scheduled_for, status)
         VALUES ($1, $2, $3, 'pending')
         ON CONFLICT (job_id, followup_number) DO NOTHING`,
        [jobId, followupNumber, scheduledFor]
      );
    }

    logger.info(
      { jobId, summary: result.summary },
      "[compliance] PASSED — status=ReadyForReview, follow-ups scheduled"
    );
  } else {
    logger.warn(
      { jobId, flags: result.flags, summary: result.summary },
      "[compliance] FAILED — status=Drafting, requires human review"
    );
  }
}
