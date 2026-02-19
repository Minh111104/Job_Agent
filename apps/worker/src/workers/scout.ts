/**
 * Scout worker — discovers intern/new-grad job postings.
 *
 * Strategy:
 *  1. Hit the public Greenhouse JSON API for known target companies (no auth needed).
 *  2. Pre-filter titles by intern/new-grad keywords to avoid wasting ASI:One calls.
 *  3. Send each job's raw HTML description to asi1-mini for structured field extraction.
 *  4. Upsert into job_postings and chain a normalize job for every new row.
 */
import type { Job } from "bullmq";
import pino from "pino";
import { createPostgresClient } from "@shared/db/clients";
import { asi } from "@shared/asi";
import { normalizeQueue } from "../queues.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

// Greenhouse public API slugs — add/remove as needed
const GREENHOUSE_TARGETS: { company: string; slug: string }[] = [
  { company: "Anthropic", slug: "anthropic" },
  { company: "OpenAI", slug: "openai" },
  { company: "Stripe", slug: "stripe" },
  { company: "Snowflake", slug: "snowflake" },
  { company: "Datadog", slug: "datadoghq" },
  { company: "Chime", slug: "chime" },
  { company: "Netflix", slug: "netflix" },
  { company: "NVIDIA", slug: "nvidia" },
  { company: "Figma", slug: "figma" },
  { company: "Notion", slug: "notion" },
  { company: "Confluent", slug: "confluent" },
  { company: "HashiCorp", slug: "hashicorp" },
];

interface GreenhouseJob {
  id: number;
  title: string;
  location: { name: string };
  content: string; // raw HTML description
  absolute_url: string;
  updated_at: string;
}

async function fetchGreenhouseJobs(slug: string): Promise<GreenhouseJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
  const res = await fetch(url, {
    headers: { "User-Agent": "JobAgent/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    logger.warn({ slug, status: res.status }, "[scout] greenhouse fetch non-ok");
    return [];
  }
  const data = (await res.json()) as { jobs?: GreenhouseJob[] };
  return data.jobs ?? [];
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

interface ExtractedFields {
  level: string;
  remoteMode: string;
  visaSponsorship: string;
  structured: Record<string, unknown>;
}

async function extractStructuredFields(
  title: string,
  descriptionText: string
): Promise<ExtractedFields> {
  const snippet = descriptionText.slice(0, 3000);

  const res = await asi.chat.completions.create({
    model: "asi1-mini",
    messages: [
      {
        role: "system",
        content:
          "You extract structured fields from job descriptions. Respond with valid JSON only. No markdown, no code fences.",
      },
      {
        role: "user",
        content: `Job title: "${title}"
Description: "${snippet}"

Return JSON with exactly these fields:
{
  "level": "intern|newgrad|junior|mid|senior|unknown",
  "remoteMode": "onsite|hybrid|remote|unknown",
  "visaSponsorship": "yes|no|unknown",
  "requirements": ["string"],
  "responsibilities": ["string"],
  "techStack": ["string"],
  "minDurationWeeks": null
}

Set visaSponsorship="yes" ONLY if the description explicitly mentions sponsoring visas (H1-B, OPT, etc.).`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = JSON.parse(res.choices[0].message.content ?? "{}") as Record<string, unknown>;
  const { level, remoteMode, visaSponsorship, ...rest } = raw;

  return {
    level: (level as string) || "unknown",
    remoteMode: (remoteMode as string) || "unknown",
    visaSponsorship: (visaSponsorship as string) || "unknown",
    structured: rest,
  };
}

export async function runScout(_job: Job): Promise<void> {
  const pg = createPostgresClient();
  let discovered = 0;

  for (const target of GREENHOUSE_TARGETS) {
    let jobs: GreenhouseJob[];
    try {
      jobs = await fetchGreenhouseJobs(target.slug);
    } catch (err) {
      logger.error({ company: target.company, err }, "[scout] fetch failed, skipping");
      continue;
    }

    // Pre-filter: only intern / new-grad postings
    const relevant = jobs.filter((j) =>
      /intern|new[\s-]?grad|entry[\s-]?level|summer 202/i.test(j.title)
    );

    logger.info(
      { company: target.company, total: jobs.length, relevant: relevant.length },
      "[scout] fetched greenhouse"
    );

    for (const gh of relevant) {
      try {
        const text = stripHtml(gh.content);
        const fields = await extractStructuredFields(gh.title, text);

        const { rows } = await pg.query(
          `INSERT INTO job_postings
             (source, source_job_id, company, title, level, location, remote_mode,
              visa_sponsorship, description_raw, description_structured, apply_url, date_posted)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (source, source_job_id) DO NOTHING
           RETURNING id`,
          [
            "greenhouse",
            String(gh.id),
            target.company,
            gh.title,
            fields.level,
            gh.location?.name ?? null,
            fields.remoteMode,
            fields.visaSponsorship,
            gh.content,
            JSON.stringify(fields.structured),
            gh.absolute_url,
            gh.updated_at ?? null,
          ]
        );

        if (rows[0]?.id) {
          discovered++;
          await normalizeQueue.add("normalize", { jobId: rows[0].id as string });
          logger.info(
            { jobId: rows[0].id, company: target.company, title: gh.title },
            "[scout] new job — enqueued normalize"
          );
        }
      } catch (err) {
        logger.error({ sourceJobId: gh.id, title: gh.title, err }, "[scout] failed to process job");
      }
    }
  }

  logger.info({ discovered }, "[scout] run complete");
}
