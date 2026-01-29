import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL;

let connection = null;

// 🛑 لو مفيش Redis → نوقف Queue بالكامل
if (!redisUrl) {
  console.warn("⚠️ REDIS_URL not found → Queue disabled");
} else {
  connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  connection.on("connect", () => {
    console.log("✅ Redis connected");
  });

  connection.on("error", (err) => {
    console.error("❌ Redis connection error:", err.message);
  });
}

export const messageQueue = connection
  ? new Queue("messages", { connection })
  : null;

// إضافة رسالة للـ Queue
export async function enqueueIncomingMessage(data) {
  if (!messageQueue) {
    console.warn("Queue disabled → message skipped");
    return;
  }

  await messageQueue.add("incoming", data);
}

// تشغيل Worker
export function startWorker(handler) {
  if (!connection) {
    console.warn("Worker not started (Redis disabled)");
    return;
  }

  new Worker(
    "messages",
    async (job) => {
      await handler(job.data);
    },
    { connection }
  );

  console.log("🟢 Worker started");
}
