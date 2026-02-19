import "dotenv/config";
import { Queue } from "bullmq";
import { createRedisClient } from "@shared/db/clients";

const connection = createRedisClient();

export const scoutQueue = new Queue("scout", { connection });
export const normalizeQueue = new Queue("normalize", { connection });
export const fitScoreQueue = new Queue("fit-score", { connection });
export const materialsQueue = new Queue("materials", { connection });
export const complianceQueue = new Queue("compliance", { connection });
