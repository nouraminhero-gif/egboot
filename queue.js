// queue.js
import IORedis from "ioredis";

/**
 * تأكد إن REDIS_URL موجود
 */
if (!process.env.REDIS_URL) {
  console.error("❌ REDIS_URL is missing");
  process.exit(1);
}

/**
 * إنشاء اتصال Redis
 */
export const redis = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  retryStrategy(times) {
    const delay = Math.min(times * 1000, 5000);
    return delay;
  },
});

/**
 * Logs للاتصال
 */
redis.on("connect", () => {
  console.log("✅ Connected to Redis");
});

redis.on("ready", () => {
  console.log("🚀 Redis is ready");
});

redis.on("error", (err) => {
  console.error("❌ Redis error:", err.message);
});

redis.on("close", () => {
  console.warn("⚠️ Redis connection closed");
});

/**
 * إضافة رسالة للطابور
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
 * تشغيل worker لمعالجة الرسائل
 */
export function startWorker(handler) {
  console.log("👷 Worker started");

  const loop = async () => {
    try {
      const result = await redis.brpop("incoming_messages", 0);
      if (!result) return;

      const [, message] = result;
      const parsed = JSON.parse(message);

      await handler(parsed);
    } catch (err) {
      console.error("❌ Worker error:", err.message);
    }

    setImmediate(loop);
  };

  loop();
}
