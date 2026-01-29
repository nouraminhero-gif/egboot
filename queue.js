// queue.js
import Redis from "ioredis";

// ================== Redis Connection ==================
const REDIS_URL =
  process.env.REDIS_PUBLIC_URL ||
  process.env.REDIS_URL ||
  null;

if (!REDIS_URL) {
  console.error("❌ REDIS_URL not found in environment variables");
}

export const redis = REDIS_URL
  ? new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      retryStrategy(times) {
        if (times > 3) return null; // prevent Railway restart loop
        return Math.min(times * 500, 2000);
      },
    })
  : null;

redis?.on("connect", () => console.log("✅ Redis connected"));
redis?.on("ready", () => console.log("✅ Redis ready"));
redis?.on("error", (err) => console.error("❌ Redis error:", err.message));

// ================== Queue Config ==================
const QUEUE_KEY = "egboot:
