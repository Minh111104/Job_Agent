/**
 * FitScore worker — evaluates how well a job posting matches the candidate profile.
 *
 * Uses asi1-extended (deep reasoning) with the full KB constraints as context.
 * Produces a 0-100 score, reasoning bullets, and risk flags.
 *
 * Outcomes:
 *   score >= THRESHOLD  →  status = Shortlisted, chain to materials queue
 *   score < THRESHOLD   →  status = Archived
 */
import type { Job } from "bullmq";
import pino from "pino";
import { createPostgresClient } from "@shared/db/clients";
import { asi } from "@shared/asi";
import { kb } from "../kb.js";
import { materialsQueue } from "../queues.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const FIT_THRESHOLD = 60;

interface FitScorePayload {
  jobId: string;
}

interface DbRow {
  id: string;
  company: string;
  title: string;
  level: string;
  location: string | null;
  remote_mode: string;
  visa_sponsorship: string;
  description_raw: string;
}

interface FitResult {
  fitScore?: number;
  reasoning?: string[];
  risks?: string[];
  recommendation?: string;
  keywordMatches?: { mustHave?: string[]; niceToHave?: string[] };
}

export async function runFitScore(job: Job<FitScorePayload>): Promise<void> {
  const { jobId } = job.data;
  const pg = createPostgresClient();

  const { rows } = await pg.query<DbRow>(
    `SELECT id, company, title, level, location, remote_mode, visa_sponsorship, description_raw
     FROM job_postings WHERE id = $1`,
    [jobId]
  );

  if (!rows[0]) {
    logger.warn({ jobId }, "[fit-score] job not found");
    return;
  }

  const posting = rows[0];

  // Load KB context (read synchronously — files are small)
  const dealbreakers = kb.constraints.dealbreakers();
  const roleTargets = kb.constraints.roleTargets();
  const preferences = kb.profile.preferences();
  const skills = kb.skills.technical();

  const descSnippet = posting.description_raw
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 3000);

  const res = await asi.chat.completions.create({
    model: "asi1-extended",
    messages: [
      {
        role: "system",
        content:
          "You are a job-fit evaluator. Score how well a job matches a candidate's profile and constraints. Respond with valid JSON only. No markdown, no code fences.",
      },
      {
        role: "user",
        content: `Evaluate this job posting against the candidate profile.

=== JOB POSTING ===
Company: ${posting.company}
Title: ${posting.title}
Level: ${posting.level}
Location: ${posting.location ?? "unknown"}
Remote mode: ${posting.remote_mode}
Visa sponsorship: ${posting.visa_sponsorship}
Description: ${descSnippet}

=== HARD CONSTRAINTS (dealbreakers) ===
${JSON.stringify(dealbreakers, null, 2)}

=== TARGET ROLES ===
${JSON.stringify(roleTargets, null, 2)}

=== LOCATION & TIMING PREFERENCES ===
${JSON.stringify(preferences, null, 2)}

=== CANDIDATE SKILLS ===
${JSON.stringify(skills, null, 2)}

=== SCORING RULES ===
- Score 0 automatically if: visa_sponsorship_required=true AND job visaSponsorship="no"
- Score 0 automatically if: no_unpaid_roles=true AND role appears unpaid
- Score 0 automatically if: job level is not "intern" or "newgrad" (candidate is a student)
- Deduct 20pts if location not in preferred list AND remoteMode is "onsite"
- Add 15pts per must_have keyword match found in description
- Add 5pts per nice_to_have keyword match
- Add 10pts if start date aligns with candidate preferences

Return JSON:
{
  "fitScore": 0,
  "reasoning": ["up to 4 concise bullet points explaining the score"],
  "risks": ["up to 3 specific risk flags"],
  "recommendation": "shortlist|skip",
  "keywordMatches": {
    "mustHave": ["matched keywords"],
    "niceToHave": ["matched keywords"]
  }
}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const result = JSON.parse(res.choices[0].message.content ?? "{}") as FitResult;
  const fitScore = Math.max(0, Math.min(100, result.fitScore ?? 0));
  const newStatus = fitScore >= FIT_THRESHOLD ? "Shortlisted" : "Archived";

  await pg.query(
    `UPDATE job_postings
     SET fit_score    = $2,
         fit_reasoning = $3,
         risks        = $4,
         status       = $5
     WHERE id = $1`,
    [
      jobId,
      fitScore,
      JSON.stringify(result.reasoning ?? []),
      JSON.stringify(result.risks ?? []),
      newStatus,
    ]
  );

  logger.info(
    { jobId, fitScore, recommendation: result.recommendation, newStatus },
    "[fit-score] complete"
  );

  if (newStatus === "Shortlisted") {
    await materialsQueue.add("materials", { jobId });
    logger.info({ jobId }, "[fit-score] shortlisted — enqueued materials");
  }
}
