/**
 * Materials worker — drafts application materials for a shortlisted job.
 *
 * Uses asi1-extended with the full KB as grounding context to produce:
 *   - Cover letter  (~250 words)
 *   - 5 tailored resume bullets (from bullet_library only)
 *   - Why-company answer (1-2 sentences)
 *   - Q&A answers for common prompts (from story_bank)
 *
 * CRITICAL: The model is instructed to use ONLY verified bullets and metrics from the KB.
 * Compliance worker runs next and will flag any fabrications.
 *
 * Chains to compliance queue on completion.
 */
import type { Job } from "bullmq";
import { createHash } from "crypto";
import pino from "pino";
import { createPostgresClient } from "@shared/db/clients";
import { asi } from "@shared/asi";
import { kb } from "../kb.js";
import { complianceQueue } from "../queues.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

interface MaterialsPayload {
  jobId: string;
}

interface DbRow {
  id: string;
  company: string;
  title: string;
  level: string;
  description_raw: string;
  fit_reasoning: string[] | null;
}

interface GeneratedMaterials {
  coverLetter?: string;
  tailoredBullets?: string[];
  whyCompany?: string;
  qaAnswers?: Record<string, string>;
}

export async function runMaterials(job: Job<MaterialsPayload>): Promise<void> {
  const { jobId } = job.data;
  const pg = createPostgresClient();

  const { rows } = await pg.query<DbRow>(
    `SELECT id, company, title, level, description_raw, fit_reasoning
     FROM job_postings WHERE id = $1`,
    [jobId]
  );

  if (!rows[0]) {
    logger.warn({ jobId }, "[materials] job not found");
    return;
  }

  const posting = rows[0];

  // Mark as Drafting before we start
  await pg.query(`UPDATE job_postings SET status = 'Drafting' WHERE id = $1`, [jobId]);

  // Load KB grounding context
  const baseResume = kb.resume.base();
  const bulletLibrary = kb.resume.bulletLibrary();
  const metricsAllowlist = kb.resume.metricsAllowlist();
  const storyBank = kb.answers.storyBank();
  const whyTemplates = kb.answers.whyCompanyTemplates();
  const writingStyle = kb.tone.writingStyle();
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
        content: `You are an expert job application writer.

Writing voice: ${writingStyle.voice}
Constraints (strictly enforce):
${writingStyle.constraints.map((c) => `- ${c}`).join("\n")}

CRITICAL RULES:
1. Only use bullets from the BULLET LIBRARY below — do not invent new ones.
2. Only use metrics from the VERIFIED METRICS ALLOWLIST — never fabricate numbers.
3. Never invent employers, projects, or experiences not present in the resume.
4. Keep the cover letter to ~250 words, 3-4 paragraphs.`,
      },
      {
        role: "user",
        content: `Generate application materials for this job.

=== JOB ===
Company: ${posting.company}
Title: ${posting.title}
Level: ${posting.level}
Description: ${descSnippet}
Why it fits (from scorer): ${JSON.stringify(posting.fit_reasoning ?? [])}

=== BASE RESUME ===
${baseResume || "(Resume not yet filled in — populate kb/resume/base_resume.md)"}

=== BULLET LIBRARY (use only these) ===
${JSON.stringify(bulletLibrary, null, 2)}

=== VERIFIED METRICS ALLOWLIST (use only these numbers) ===
${JSON.stringify(metricsAllowlist.allowed_metrics, null, 2)}

=== CANDIDATE SKILLS ===
${JSON.stringify(skills, null, 2)}

=== STORY BANK ===
${JSON.stringify(storyBank.stories, null, 2)}

=== WHY-COMPANY TEMPLATES ===
${whyTemplates}

Return JSON:
{
  "coverLetter": "full cover letter text (~250 words, 3-4 paragraphs)",
  "tailoredBullets": ["bullet 1", "bullet 2", "bullet 3", "bullet 4", "bullet 5"],
  "whyCompany": "1-2 sentence answer to why this company",
  "qaAnswers": {
    "tellMeAboutYourself": "...",
    "whyThisRole": "...",
    "challengeYouSolved": "..."
  }
}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const materials = JSON.parse(
    res.choices[0].message.content ?? "{}"
  ) as GeneratedMaterials;

  // Insert resume version
  const baseHash = createHash("sha256").update(baseResume).digest("hex").slice(0, 16);
  const { rows: resumeRows } = await pg.query(
    `INSERT INTO resume_versions (base_resume_hash, target_role, tailored_bullets)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [baseHash, posting.title, JSON.stringify(materials.tailoredBullets ?? [])]
  );
  const resumeVersionId = (resumeRows[0]?.id as string | undefined) ?? null;

  // Upsert application record
  await pg.query(
    `INSERT INTO applications (job_id, resume_version_id, cover_letter_id, qa_answers_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [
      jobId,
      resumeVersionId,
      materials.coverLetter ? `cl-${jobId}` : null,
      materials.qaAnswers ? `qa-${jobId}` : null,
    ]
  );

  // Persist the generated text as notes (until a dedicated materials table is added)
  await pg.query(`UPDATE job_postings SET notes = $2 WHERE id = $1`, [
    jobId,
    JSON.stringify({
      coverLetter: materials.coverLetter,
      whyCompany: materials.whyCompany,
      qaAnswers: materials.qaAnswers,
    }),
  ]);

  await complianceQueue.add("compliance", {
    jobId,
    resumeVersionId,
    coverLetter: materials.coverLetter,
    tailoredBullets: materials.tailoredBullets,
  });

  logger.info({ jobId, resumeVersionId }, "[materials] complete — enqueued compliance");
}
