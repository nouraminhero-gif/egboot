// apps/webhook/queue.js
import "dotenv/config";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL || "";

if (!REDIS_URL) {
  console.warn("⚠️ REDIS_URL is missing. Webhook will NOT enqueue jobs.");
}

// Railway/Upstash friendly Redis connection
export const connection = REDIS_URL
  ? new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy(times) {
        return Math.min(times * 200, 3000);
      },
    })
  : null;

connection?.on("connect", () => console.log("🔌 Redis connected (webhook)"));
connection?.on("ready", () => console.log("✅ Redis ready (webhook)"));
connection?.on("error", (e) => console.error("❌ Redis error (webhook):", e?.message || e));
connection?.on("close", () => console.warn("⚠️ Redis closed (webhook)"));

// BullMQ Queue
export const messagesQueue = connection
  ? new Queue("messages", {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { count: 5000 },
        removeOnFail: { count: 2000 },
      },
    })
  : null;

/**
 * Enqueue Messenger event (job)
 * job.data = { event, createdAt }
 */
export async function enqueueMessage(event) {
  if (!messagesQueue) {
    console.warn("⚠️ enqueue skipped: queue not available");
    return;
  }

  await messagesQueue.add(
    "incoming_message",
    { event, createdAt: Date.now() },
    {
      // priority/timing ممكن تضيفه بعدين
    }
  );
}

export async function closeQueueAndRedis() {
  try {
    if (messagesQueue) await messagesQueue.close();
  } catch (e) {
    console.warn("⚠️ queue close failed:", e?.message || e);
  }

  try {
    if (connection) await connection.quit();
  } catch (e) {
    console.warn("⚠️ redis quit failed:", e?.message || e);
    try {
      connection?.disconnect();
    } catch {}
  }
}
