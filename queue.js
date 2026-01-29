// queue.js ✅ FULL & FIXED
// Compatible with Railway + Redis + your server.js imports

import IORedis from "ioredis";

/* =========================
   Redis Connection
========================= */

const REDIS_URL =
  process.env.REDIS_PUBLIC_URL ||
  process.env.REDIS_URL ||
  "";

if (!REDIS_URL) {
  console.error("❌ REDIS_URL is not set");
}

const needsTLS =
  REDIS_URL.startsWith("rediss://") ||
  REDIS_URL.includes("proxy.rlwy.net");

export const redis = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  connectTimeout: 20000,
  retryStrategy(times) {
    return Math.min(times * 500, 5000);
  },
  tls: needsTLS ? { rejectUnauthorized: false } : undefined,
});

redis.on("connect", () => console.log("✅ Redis connected"));
redis.on("ready", () => console.log("🟢 Redis ready"));
redis.on("error", (e) => console.error("❌ Redis error:", e.message));
redis.on("close", () => console.warn("⚠️ Redis connection closed"));

/* =========================
   Queue Logic (Simple)
========================= */

const QUEUE_KEY = "incoming_messages";

/**
 * 🔹 enqueueIncomingMessage
 * Used by server.js when a message arrives
 */
export async function enqueueIncomingMessage(payload) {
  try {
    await redis.rpush(QUEUE_KEY, JSON.stringify(payload));
    return true;
  } catch (err) {
    console.error("❌ enqueue error:", err.message);
    return false;
  }
}

/**
 * 🔹 startWorker
 * Starts background worker to process messages
 */
export function startWorker(handler) {
  console.log("👷 Worker started");

  setInterval(async () => {
    try {
      const data = await redis.lpop(QUEUE_KEY);
      if (!data) return;

      const message = JSON.parse(data);
      await handler(message);

    } catch (err) {
      console.error("❌ Worker error:", err.message);
    }
  }, 500); // every 0.5 second
}
