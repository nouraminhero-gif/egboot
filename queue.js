import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

/**
 * تأكيد إن REDIS_URL موجود
 */
if (!process.env.REDIS_URL) {
  console.warn("⚠️ Missing REDIS_URL. Queue will not start.");
}

/**
 * Redis connection (Railway-safe)
 */
export const redisConnection = process.env.REDIS_URL
  ? new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null, // BullMQ requirement
      enableReadyCheck: false,
    })
  : null;

/**
 * Queue
 */
export const messageQueue = redisConnection
  ? new Queue("messages", { connection: redisConnection })
  : null;

/**
 * Enqueue message
 */
export async function enqueueIncomingMessage(data) {
  if (!messageQueue) {
    console.warn("⚠️ Queue not initialized");
    return;
  }

  await messageQueue.add("incoming-message", data, {
    removeOnComplete: true,
    removeOnFail: true,
  });
}

/**
 * Worker
 */
export function startWorker(processFn) {
  if (!redisConnection) {
    console.warn("⚠️ Worker not started (no Redis)");
    return;
  }

  new Worker(
    "messages",
    async (job) => {
      await processFn(job.data);
    },
    {
      connection: redisConnection,
    }
  );

  console.log("✅ BullMQ Worker started");
}
