// queue.js
import IORedis from "ioredis";

if (!process.env.REDIS_URL) {
  console.error("❌ REDIS_URL is missing");
  process.exit(1);
}

console.log("REDIS_URL exists? true");

export const redis = new IORedis(process.env.REDIS_URL, {
  tls: {},                 // 🔥 مهم جدًا لـ Railway
  connectTimeout: 10000,   // 10 ثواني
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 5) {
      console.error("❌ Redis retry limit reached");
      return null; // stop retrying
    }
    return Math.min(times * 1000, 5000);
  },
});

redis.on("connect", () => {
  console.log("✅ Redis connected");
});

redis.on("ready", () => {
  console.log("🚀 Redis ready");
});

redis.on("error", (err) => {
  console.error("❌ Redis error:", err.message);
});

redis.on("close", () => {
  console.warn("⚠️ Redis connection closed");
});

/**
 * enqueue message
 */
export async function enqueueIncomingMessage(data) {
  try {
    await redis.lpush("incoming_messages", JSON.stringify(data));
    console.log("📥 Message enqueued");
  } catch (err) {
    console.error("❌ enqueue error:", err.message);
  }
}

/**
 * worker
 */
export function startWorker(handler) {
  console.log("👷 Worker started");

  const work = async () => {
    try {
      const result = await redis.brpop("incoming_messages", 0);
      if (!result) return;

      const [, raw] = result;
      const data = JSON.parse(raw);

      await handler(data);
    } catch (err) {
      console.error("❌ Worker error:", err.message);
      await new Promise(r => setTimeout(r, 2000));
    }

    setImmediate(work);
  };

  work();
}
