// queue.js
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

/**
 * اسم الكيو
 */
export const QUEUE_NAME = "incoming-messages";

/**
 * تحقق من وجود REDIS_URL
 */
function assertRedisUrl() {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn("⚠️ REDIS_URL is not defined");
    return null;
  }
  return url;
}

/**
 * بناء اتصال Redis متوافق مع Railway
 */
function buildBullMQConnection(redisUrl) {
  const u = new URL(redisUrl);

  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password || undefined,

    // Railway غالبًا بيستخدم TLS
    tls: u.protocol === "rediss:" ? {} : undefined,

    // BullMQ requirement
    maxRetriesPerRequest: null,

    // حلول مشاكل timeout / DNS
    connectTimeout: 15000,
    family: 0,
  };
}

/**
 * Redis connection (shared)
 */
let redisConnection = null;
function getRedisConnection() {
  if (redisConnection) return redisConnection;

  const redisUrl = assertRedisUrl();
  if (!redisUrl) return null;

  redisConnection = new IORedis(buildBullMQConnection(redisUrl));

  redisConnection.on("connect", () => {
    console.log("✅ Redis connected");
  });

  redisConnection.on("error", (err) => {
    console.error("❌ Redis connection error:", err.message);
  });

  return redisConnection;
}

/**
 * Queue instance
 */
let queueInstance = null;

export function getQueue() {
  if (queueInstance) return queueInstance;

  const redisUrl = assertRedisUrl();
  if (!redisUrl) return null;

  queueInstance = new Queue(QUEUE_NAME, {
    connection: buildBullMQConnection(redisUrl),
  });

  return queueInstance;
}

/**
 * إضافة رسالة للكيو
 */
export async function enqueueIncomingMessage(data) {
  const queue = getQueue();
  if (!queue) {
    console.warn("⚠️ Queue not available – skipping enqueue");
    return null;
  }

  return await queue.add("incoming", data, {
    removeOnComplete: true,
    removeOnFail: 100,
  });
}

/**
 * Worker instance
 */
let workerInstance = null;

/**
 * تشغيل الـ Worker
 */
export function startWorker() {
  if (workerInstance) return workerInstance;

  const redisUrl = assertRedisUrl();
  if (!redisUrl) {
    console.warn("⚠️ Worker disabled (no Redis)");
    return null;
  }

  workerInstance = new Worker(
    QUEUE_NAME,
    async (job) => {
      try {
        // lazy import لتفادي circular deps
        const salesModule = await import("./sales.js");
        const handler =
          salesModule.processIncomingMessage ||
          salesModule.default;

        if (typeof handler !== "function") {
          throw new Error("sales.js must export a function");
        }

        return await handler(job.data);
      } catch (err) {
        console.error("❌ Job processing error:", err.message);
        throw err;
      }
    },
    {
      connection: buildBullMQConnection(redisUrl),
      concurrency: 3,
    }
  );

  workerInstance.on("ready", () => {
    console.log("🚀 Worker started and connected to Redis");
  });

  workerInstance.on("error", (err) => {
    console.error("❌ Worker error:", err.message);
  });

  return workerInstance;
}
