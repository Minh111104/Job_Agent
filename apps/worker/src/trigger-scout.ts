import { Queue } from "bullmq";
import { createRedisClient } from "shared";

const redis = createRedisClient();
const scoutQueue = new Queue("scout", { connection: redis });

await scoutQueue.add("run", {});
console.log("Scout job queued — check worker logs.");
await redis.quit();
