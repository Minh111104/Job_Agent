import "dotenv/config";
import express from "express";
import cors from "cors";
import pino from "pino";
import { createPostgresClient, createRedisClient, env } from "shared";

const app = express();
const logger = pino({ level: env.LOG_LEVEL ?? "info" });

app.use(cors());
app.use(express.json());

app.get("/health", async (_req, res) => {
  res.json({ status: "ok", service: "api", timestamp: new Date().toISOString() });
});

app.listen(env.API_PORT, () => {
  logger.info({ port: env.API_PORT }, "api server running");
  // initialize shared clients lazily to keep cold start fast
  void createPostgresClient();
  void createRedisClient();
});
