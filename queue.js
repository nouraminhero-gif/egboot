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

/**
 * Railway private networking + ioredis/bullmq notes:
 * - On Railway you should use family: 0 (dual stack IPv4/IPv6)
 * - BullMQ requires maxRetriesPerRequest to be null in many setups
 * See Railway docs: ioredis/bullmq config.  1
 */
function buildBullMQConnection(redisUrl) {
  const u = new URL(redisUrl);

  // NOTE: BullMQ expects port as number
  const port = u.port ? Number(u.port) : 6379;

  return {
    host: u.hostname,
    port,
    username: u.username || undefined,
    password: u.password || undefined,

    // ✅ Railway: support IPv4 + IPv6 endpoints
    family: 0,

    // ✅ BullMQ recommendation/requirement in many cases
    // (prevents "Your redis options maxRetriesPerRequest must be null.")
    maxRetriesPerRequest: null,
  };
}

let queueSingleton = null;
function getQueue() {
  if (queueSingleton) return queueSingleton;

  const redisUrl = assertRedisUrl();
  if (!redisUrl) return null;

  queueSingleton = new Queue(QUEUE_NAME, {
    connection: buildBullMQConnection(redisUrl),
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: 50,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    },
  });

  queueSingleton.on("error", (err) => {
    console.error("❌ Queue error:", err?.message || err);
  });

  return queueSingleton;
}

/**
 * Enqueue an incoming message/event to be processed async by the worker.
 * @param {object} payload - any JSON serializable object
 */
export async function enqueueIncomingMessage(payload) {
  const q = getQueue();
  if (!q) {
    // fallback: no redis -> run sync
    return { queued: false, reason: "REDIS_URL missing" };
  }

  await q.add("incoming_message", payload);
  return { queued: true };
}

let workerSingleton = null;

/**
 * Starts the BullMQ worker. Safe to call multiple times.
 * It will look for a handler function inside ./sales.js:
 * - processIncomingMessage
 * - handleIncomingMessage
 * - default export function
 */
export function startWorker() {
  if (workerSingleton) return workerSingleton;

  const redisUrl = assertRedisUrl();
  if (!redisUrl) return null;

  workerSingleton =
