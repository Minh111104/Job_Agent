import "dotenv/config";
import { Worker } from "bullmq";
import cron from "node-cron";
import pino from "pino";
import { env } from "@shared/env";
import { createRedisClient } from "@shared/db/clients";
import { scoutQueue, normalizeQueue, fitScoreQueue, materialsQueue, complianceQueue } from "./queues.js";
import { runScout } from "./workers/scout.js";
import { runNormalize } from "./workers/normalize.js";
import { runFitScore } from "./workers/fitScore.js";
import { runMaterials } from "./workers/materials.js";
import { runCompliance } from "./workers/compliance.js";

const logger = pino({ level: env.LOG_LEVEL ?? "info" });
const connection = createRedisClient();

// Cron: run scout every 6 hours
cron.schedule("0 */6 * * *", async () => {
  await scoutQueue.add("run-scout", {});
  logger.info("Enqueued scout run");
});

// Workers
new Worker("scout",      runScout,      { connection, concurrency: 1 });
new Worker("normalize",  runNormalize,  { connection, concurrency: 5 });
new Worker("fit-score",  runFitScore,   { connection, concurrency: 3 });
new Worker("materials",  runMaterials,  { connection, concurrency: 2 });
new Worker("compliance", runCompliance, { connection, concurrency: 3 });

logger.info("worker service bootstrapped");

// Re-export queues so other modules can enqueue jobs if needed
export { scoutQueue, normalizeQueue, fitScoreQueue, materialsQueue, complianceQueue };
