// apps/worker/queue.js
import dotenv from "dotenv";
import IORedis from "ioredis";
import { Queue } from "bullmq";

dotenv.config();

// ================== Redis Connection ==================
const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL || "";

if (!REDIS_URL) {
  console.error("❌ REDIS_URL is missing. Queue will not work.");
  process.exit(1);
}

export const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy: (times) => Math.min(times * 200, 3000),
});

connection.on("connect", () => console.log("✅ Redis connected"));
connection.on("ready", () => console.log("✅ Redis ready"));
connection.on("error", (err) => console.error("❌ Redis error:", err?.message || err));
connection.on("close", () => console.warn("⚠️ Redis connection closed"));

// ================== BullMQ Queue ==================
// لازم يطابق الاسم اللي في worker.js
export const messagesQueue = new Queue("messages", { connection });

// ✅ Enqueue
export async function enqueueIncomingMessage(payload) {
  try {
    // اسم الـ job اختياري، بس مفيد في اللوجز
    await messagesQueue.add(
      "incoming_message",
      payload,
      {
        removeOnComplete: 200,
        removeOnFail: 200,
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
      }
    );
  } catch (err) {
    console.error("❌ enqueue error:", err?.message || err);
  }
}

// ✅ Close cleanly (اختياري لو محتاج)
export async function closeQueue() {
  try {
    await messagesQueue.close();
  } catch {}
  try {
    await connection.quit();
  } catch {
    connection.disconnect();
  }
}
