import { Pool } from "pg";
import Redis from "ioredis";
import { env } from "../env";

let pgPool: Pool | null = null;
let redisClient: Redis | null = null;

export const createPostgresClient = () => {
  if (pgPool) return pgPool;
  pgPool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
  return pgPool;
};

export const createRedisClient = () => {
  if (redisClient) return redisClient;
  redisClient = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false
  });
  return redisClient;
};

export type PgClient = Pool;
export type RedisClient = Redis;
