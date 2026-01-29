// queue.js
import { Queue, Worker } from "bullmq";

const QUEUE_NAME = "incoming_messages";

function assertRedisUrl() {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn("⚠️ REDIS_URL is missing. Queue/Worker will not run.");
    return null;
  }
  return url;
}

function buildBullMQConnection(redisUrl) {
  const u = new URL(redisUrl);

  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    username: u.username || undefined,
    password: u.password || undefined,

    // Railway networking
    family: 0,

    // BullMQ requirement
    maxRetriesPerRequest: null,
  };
}

let queueInstance = null;

function getQueue() {
  if (queueInstance) return queueInstance;

  const redisUrl = assertRedisUrl();
  if (!redisUrl) return null;

  queueInstance = new Queue(QUEUE_NAME, {
    connection: buildBullMQConnection(redisUrl),
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: 50,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2000,
      },
    },
  });

  queueInstance.on("error", (err) => {
    console.error("❌ Queue error:", err);
  });

  return queueInstance;
}

export async function enqueueIncomingMessage(payload) {
  const queue = getQueue();
  if (!queue) {
    return { queued: false, reason: "REDIS_URL missing" };
  }

  await queue.add("incoming_message", payload);
  return { queued: true };
}

let workerInstance = null;

export function startWorker() {
  if (workerInstance) return workerInstance;

  const redisUrl = assertRedisUrl();
  if (!redisUrl) return null;

  workerInstance = new Worker(
    QUEUE_NAME,
    async (job) => {
      const data = job.data;

      const salesModule = await import("./sales.js");
      const handler =
        salesModule.processIncomingMessage ||
        salesModule.handleIncomingMessage ||
        salesModule.default;

      if (typeof handler !== "function") {
        throw new Error(
          "sales.js must export a function (processIncomingMessage / default)"
        );
      }

      return await handler(data);
    },
    {
      connection: buildBullMQConnection(redisUrl),
      concurrency: 5,
    }
  );

  workerInstance.on("ready", () => {
    console.log("✅ Worker started");
  });

  workerInstance.on("failed", (job, err) => {
    console.error("❌ Job failed:", err);
  });

  workerInstance.on("error", (err) => {
    console.error("❌ Worker error:", err);
  });

  return workerInstance;
}
