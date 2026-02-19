import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().url().describe("Postgres connection string"),
  REDIS_URL: z.string().url().describe("Redis connection string"),
  API_PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z.string().optional(),
  ASI_API_KEY: z.string().min(1, "ASI_API_KEY is required — get yours at https://asi1.ai")
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // In dev we want a clear error; production should fail fast as well.
  console.error("Invalid environment variables", parsed.error.format());
  throw new Error("Env validation failed");
}

export const env = parsed.data;
