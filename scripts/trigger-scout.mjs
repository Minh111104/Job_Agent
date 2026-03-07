import { Queue } from "bullmq";
import Redis from "ioredis";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env") });

const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const scoutQueue = new Queue("scout", { connection: redis });

await scoutQueue.add("run", {});
console.log("Scout job queued — check worker logs.");
await redis.quit();
