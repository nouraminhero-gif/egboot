import { Queue, Worker } from "bullmq";

/**
 * Railway provides Redis as a full URL:
 * redis://user:password@host:port
 */
const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  console.warn("⚠️ REDIS_URL is missing. Queue & Worker will not run.");
}

/**
 * Shared connection (BullMQ accepts a Redis URL directly)
 */
const connection = REDIS_URL;

/**
 * Main Queue
 */
export const messageQueue = new Queue("messages", {
  connection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: false
  }
});

/**
 * Worker
 * هنا بتحط أي logic تقيل (AI – ردود – تحليل – تخزين)
 */
export const messageWorker = new Worker(
  "messages",
  async (job) => {
    const { type, payload } = job.data;

    // مثال بسيط
    if (type === "LOG") {
      console.log("📩 Job payload:", payload);
    }

    // هنا بعدين:
    // - AI reply
    // - Sales logic
    // - Save to DB
    // - Analytics
  },
  {
    connection
  }
);

/**
 * Worker Events (اختياري بس مفيد)
 */
messageWorker.on("completed", (job) => {
  console.log(`✅ Job ${job.id} completed`);
});

messageWorker.on("failed", (job, err) => {
  console.error(`❌ Job ${job?.id} failed:`, err.message);
});
