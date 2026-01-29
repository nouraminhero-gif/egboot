import IORedis from "ioredis";

/* =========================
   Redis Connection (Railway)
   Use REDIS_PUBLIC_URL
========================= */

const REDIS_PUBLIC_URL = process.env.REDIS_PUBLIC_URL;

if (!REDIS_PUBLIC_URL) {
  console.error("❌ REDIS_PUBLIC_URL not found in environment variables");
  // We don't exit here to allow server to run even if queue is disabled
}

export const redis = REDIS_PUBLIC_URL
  ? new IORedis(REDIS_PUBLIC_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      connectTimeout: 20000,
      tls: {
        rejectUnauthorized: false,
      },
      retryStrategy(times) {
        // exponential-ish backoff (caps at 10s)
        const delay = Math.min(times * 500, 10000);
        return delay;
      },
    })
  : null;

if (redis) {
  redis.on("connect", () => console.log("✅ Redis connected"));
  redis.on("ready", () => console.log("🟢 Redis ready"));
  redis.on("error", (err) => console.error("❌ Redis error:", err.message));
  redis.on("close", () => console.warn("⚠️ Redis connection closed"));
}

/* =========================
   Queue Logic
========================= */

const QUEUE_KEY = "incoming_messages";

/**
 * Enqueue incoming job payload to Redis list
 * @param {object} payload
 */
export async function enqueueIncomingMessage(payload) {
  if (!redis) {
    console.warn("⚠️ Redis not configured, skipping enqueue");
    return;
  }
  await redis.rpush(QUEUE_KEY, JSON.stringify(payload));
}

/**
 * Start a simple worker loop that pops messages and passes them to handler(job)
 * @param {(job: any) => Promise<void>} handler
 */
export function startWorker(handler) {
  console.log("👷 Worker started");

  // Polling loop
  setInterval(async () => {
    if (!redis) return;

    try {
      const data = await redis.lpop(QUEUE_KEY);
      if (!data) return;

      const job = JSON.parse(data);
      await handler(job);
    } catch (e) {
      console.error("❌ Worker error:", e.message);
    }
  }, 1000);
}
