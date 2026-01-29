import { Queue, Worker } from "bullmq";

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  console.warn("⚠️ Missing REDIS_URL. Queue/Worker disabled.");
}

const connection = REDIS_URL || null;

// Queue instance
let messageQueue = null;

// Worker instance
let worker = null;

/**
 * Create queue (lazy init)
 */
function getQueue() {
  if (!connection) return null;
  if (!messageQueue) {
    messageQueue = new Queue("messages", {
      connection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
  }
  return messageQueue;
}

/**
 * ✅ Exported: enqueueIncomingMessage
 * server.js expects this name
 */
export async function enqueueIncomingMessage(payload) {
  const q = getQueue();

  // لو مفيش Redis شغال، منوقفش السيرفر
  if (!q) {
    console.warn("⚠️ Queue not available (no REDIS_URL). Payload skipped.");
    return { skipped: true };
  }

  // jobName ثابت + payload كله
  const job = await q.add("incoming_message", payload);
  return { jobId: job.id };
}

/**
 * ✅ Exported: startWorker
 * server.js expects this name
 */
export function startWorker(handler) {
  if (!connection) {
    console.warn("⚠️ Worker not started (no REDIS_URL).");
    return null;
  }

  // منع تشغيل Worker مرتين
  if (worker) return worker;

  worker = new Worker(
    "messages",
    async (job) => {
      // لو server.js باعت handler هنستخدمه
      // handler(payload) => returns response maybe
      if (typeof handler === "function") {
        return await handler(job.data);
      }

      // fallback لو مفيش handler
      console.log("📩 Job received:", job.data);
      return true;
    },
    { connection }
  );

  worker.on("completed", (job) => {
    console.log(`✅ Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`❌ Job ${job?.id} failed:`, err.message);
  });

  console.log("🚀 Worker started");
  return worker;
}
