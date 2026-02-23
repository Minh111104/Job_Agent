# Autonomous Job Application Agent 🤖

Next.js (app router) + Postgres + Redis multi-agent system that discovers roles, scores fit, drafts evidence-backed materials, and keeps you in-control with approval gates.

## Tech Stack
- Frontend: Next.js (app router) + Tailwind CSS (`apps/web`)
- API: Express + Postgres + Redis (`apps/api`)
- Worker: BullMQ + cron + asi:one orchestrations (`apps/worker`)
- Shared: env/db clients, domain types (`packages/shared`)
- KB: structured truth source for drafting (`/kb`)

## Repo Layout
- `apps/web` — dashboard (Inbox, Job detail, Drafts, Approvals)
- `apps/api` — REST surface for UI + webhook targets (health stub ready)
- `apps/worker` — scheduled scout + queues (stubs wired; cron every 6h)
- `packages/shared` — env parsing, Postgres/Redis clients, domain schema types
- `kb/` — profile/resume/projects/constraints/tone, ready for your data

## Getting Started
1) Install pnpm ≥ 9 and Node 18+.
2) Copy `.env.example` to `.env` (root or app-level) and fill:
   - `DATABASE_URL=postgres://...`
   - `REDIS_URL=redis://...`
   - `API_PORT=4000`
   - `ASI_API_KEY=...` (if set)
3) Install deps: `pnpm install`
4) Run dev services:
   - Web: `pnpm dev:web`
   - API: `pnpm dev:api`
   - Worker: `pnpm dev:worker`
5) Apply DB migrations: `pnpm --filter api migrate` (runs SQL in `packages/shared/src/db/migrations`)

## Data Model (draft)
- `job_postings` (source, company, title, level, location, visa_sponsorship, description_raw/structured, apply_url, date_posted/discovered, status, fit_score, reasoning, risks, raw_snapshot_url)
- `applications` (job_id, resume_version_id, cover_letter_id, qa_answers_id, submission_date, current_stage, next_followup_date, contact, activity_log)
- `resume_versions` (base_resume_hash, target_role, tailored_bullets, file_url)
- `followups` (job_id, followup_number, scheduled_for, status, draft_message)

## Target Sources
Meta, Google, Amazon, Microsoft, Apple, Netflix, Datadog, Stripe, Snowflake, Chime, OpenAI, Anthropic, NVIDIA, Intel, Greenhouse, LinkedIn Jobs, Indeed, Wellfound, YC Jobs, Simplify Jobs, Levels.fyi Jobs, GitHub Jobs.

## Next Steps
- Add migrations (Drizzle/Prisma/sql) for the schema above.
- Flesh out Scout → Normalize → FitScore → Materials → Compliance workers; hook asi:one tools.
- Build Inbox + Job detail pages consuming API; surface approval gates and activity timeline.
- Add PDF generation for tailored resumes/cover letters and upload to storage.
