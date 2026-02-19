import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import yaml from "yaml";

// apps/worker/src/kb.ts  →  3 dirs up = monorepo root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_ROOT = path.resolve(__dirname, "../../../kb");

function loadYaml<T = unknown>(relPath: string): T {
  return yaml.parse(readFileSync(path.join(KB_ROOT, relPath), "utf8")) as T;
}

function loadText(relPath: string): string {
  return readFileSync(path.join(KB_ROOT, relPath), "utf8");
}

export const kb = {
  constraints: {
    dealbreakers: () =>
      loadYaml<{
        visa_sponsorship_required: boolean;
        min_intern_duration_weeks: number;
        no_unpaid_roles: boolean;
        exclude_locations: string[];
      }>("constraints/dealbreakers.yaml"),

    roleTargets: () =>
      loadYaml<{
        role_families: string[];
        keywords: { must_have: string[]; nice_to_have: string[] };
      }>("constraints/role_targets.yaml"),
  },

  profile: {
    preferences: () =>
      loadYaml<{
        locations: { preferred: string[]; avoid: string[] };
        role_families: string[];
        start_dates: string[];
      }>("profile/preferences.yaml"),
  },

  resume: {
    base: () => loadText("resume/base_resume.md"),
    bulletLibrary: () => loadYaml<string[]>("resume/bullet_library.yaml"),
    metricsAllowlist: () =>
      loadYaml<{ allowed_metrics: string[] }>("resume/metrics_allowlist.yaml"),
  },

  skills: {
    technical: () => loadYaml<Record<string, string[]>>("skills/technical.yaml"),
  },

  answers: {
    storyBank: () =>
      loadYaml<{
        stories: { prompt: string; outline: string[]; evidence_refs: string[] }[];
      }>("answers/story_bank.yaml"),
    whyCompanyTemplates: () => loadText("answers/why_company_templates.md"),
  },

  tone: {
    writingStyle: () =>
      loadYaml<{ voice: string; constraints: string[] }>("tone/writing_style.yaml"),
  },
};
