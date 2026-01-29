// queue.js — FINAL STABLE VERSION FOR RAILWAY

import IORedis from "ioredis";

/* =========================
   Redis Connection
========================= */

const REDIS_URL = process.env.REDIS_PUBLIC_URL;

if (!REDIS_URL) {
  throw new Error("❌ REDIS_PUBLIC_URL is missing");
}

export const redis = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  connectTimeout: 20000,
  tls: {
    rejectUnauthorized: false, // REQUIRED for Railway
  },
});

redis.on("connect", () => console.log("✅ Redis connected"));
redis.on("ready", () => console.log("🟢 Redis ready"));
redis.on("error", (e) => console.error("❌ Redis error:", e.message));
redis.on("close", () => console.warn("⚠️ Redis connection closed"));

/* =========================
   Simple Queue
========================= */

const QUEUE_KEY = "incoming_messages";

/**
 * Used by server.js
 */
export async function enqueueIncomingMessage(payload) {
  await redis.rpush(QUEUE_KEY, JSON.stringify(payload));
}

/**
 * Background worker
 */
export function startWorker(handler) {
  console.log("👷 Worker started");

  setInterval(async () => {
    const data = await redis.lpop(QUEUE_KEY);
    if (!data) return;

    const job = JSON.parse(data);
    await handler(job);
  }, 1000);
}
