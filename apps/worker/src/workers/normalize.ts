/**
 * Normalize worker — cleans up a raw job posting from Scout.
 *
 * Uses asi1-mini (fast, cheap) to:
 *   - Produce a clean, consistent job title
 *   - Confirm/correct level, remote mode, visa sponsorship, location
 *
 * Chains to fit-score queue on completion.
 */
import type { Job } from "bullmq";
import pino from "pino";
import { createPostgresClient } from "@shared/db/clients";
import { asi } from "@shared/asi";
import { fitScoreQueue } from "../queues.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

interface NormalizePayload {
  jobId: string;
}

interface DbRow {
  id: string;
  company: string;
  title: string;
  location: string | null;
  remote_mode: string;
  visa_sponsorship: string;
  description_raw: string;
}

export async function runNormalize(job: Job<NormalizePayload>): Promise<void> {
  const { jobId } = job.data;
  const pg = createPostgresClient();

  const { rows } = await pg.query<DbRow>(
    `SELECT id, company, title, location, remote_mode, visa_sponsorship, description_raw
     FROM job_postings WHERE id = $1`,
    [jobId]
  );

  if (!rows[0]) {
    logger.warn({ jobId }, "[normalize] job not found");
    return;
  }

  const row = rows[0];
  const descSnippet = row.description_raw
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 2000);

  const res = await asi.chat.completions.create({
    model: "asi1-mini",
    messages: [
      {
        role: "system",
        content:
          "You normalize job posting metadata. Respond with valid JSON only. No markdown, no code fences.",
      },
      {
        role: "user",
        content: `Normalize this job posting.

Company: "${row.company}"
Raw title: "${row.title}"
Location: "${row.location ?? "unknown"}"
Remote mode (current): "${row.remote_mode}"
Visa sponsorship (current): "${row.visa_sponsorship}"
Description excerpt: "${descSnippet}"

Return JSON:
{
  "normalizedTitle": "clean, concise job title (e.g. 'Software Engineering Intern')",
  "level": "intern|newgrad|junior|mid|senior|unknown",
  "remoteMode": "onsite|hybrid|remote|unknown",
  "visaSponsorship": "yes|no|unknown",
  "normalizedLocation": "City, State or Remote"
}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const normalized = JSON.parse(res.choices[0].message.content ?? "{}") as {
    normalizedTitle?: string;
    level?: string;
    remoteMode?: string;
    visaSponsorship?: string;
    normalizedLocation?: string;
  };

  await pg.query(
    `UPDATE job_postings
     SET title             = COALESCE($2, title),
         level             = COALESCE($3, level),
         remote_mode       = COALESCE($4, remote_mode),
         visa_sponsorship  = COALESCE($5, visa_sponsorship),
         location          = COALESCE($6, location)
     WHERE id = $1`,
    [
      jobId,
      normalized.normalizedTitle ?? null,
      normalized.level ?? null,
      normalized.remoteMode ?? null,
      normalized.visaSponsorship ?? null,
      normalized.normalizedLocation ?? null,
    ]
  );

  await fitScoreQueue.add("fit-score", { jobId });
  logger.info({ jobId, normalized }, "[normalize] complete — enqueued fit-score");
}
