import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL;

// Redis client (lazy init)
let redis = null;
let messageQueue = null;
let worker = null;

function getRedis() {
  if (!REDIS_URL) return null;
  if (redis) return redis;

  // IMPORTANT: BullMQ recommends maxRetriesPerRequest = null
  redis = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  redis.on("connect", () => console.log("✅ Redis connected"));
  redis.on("error", (err) => console.error("❌ Redis error:", err?.message || err));

  return redis;
}

function getQueue() {
  const r = getRedis();
  if (!r) return null;

  if (!messageQueue) {
    messageQueue = new Queue("messages", {
      connection: r,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
  }

  return messageQueue;
}

/**
 * server.js expects: enqueueIncomingMessage
 */
export async function enqueueIncomingMessage(payload) {
  const q = getQueue();

  // لو Redis مش موجود/مش مربوط… منوقعش السيرفر
  if (!q) {
    console.warn("⚠️ REDIS_URL missing -> queue skipped");
    return { skipped: true };
  }

  const job = await q.add("incoming_message", payload);
  return { jobId: job.id };
}

/**
 * server.js expects: startWorker
 */
export function startWorker(handler) {
  const r = getRedis();

  if (!r) {
    console.warn("⚠️ REDIS_URL missing -> worker not started");
    return null;
  }

  if (worker) return worker;

  worker = new Worker(
    "messages",
    async (job) => {
      if (typeof handler === "function") {
        return await handler(job.data);
      }
      console.log("📩 Job received:", job.data);
      return true;
    },
    { connection: r }
  );

  worker.on("completed", (job) => console.log(`✅ Job ${job.id} completed`));
  worker.on("failed", (job, err) =>
    console.error(`❌ Job ${job?.id} failed:`, err?.message || err)
  );

  console.log("🚀 Worker started");
  return worker;
}
