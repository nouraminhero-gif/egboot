// queue.js (ESM)
// Works with/without Redis. If REDIS_URL is missing, it falls back to in-memory queue
// so the bot keeps running and doesn't crash Railway.

import { Worker, Queue } from "bullmq";
import IORedis from "ioredis";

const QUEUE_NAME = "incoming_messages";

// ---------- In-memory fallback ----------
let inMemoryHandler = null;
const inMemoryJobs = [];
let inMemoryRunning = false;

async function runInMemoryLoop() {
  if (inMemoryRunning) return;
  inMemoryRunning = true;

  while (inMemoryJobs.length > 0) {
    const job = inMemoryJobs.shift();
    try {
      if (inMemoryHandler) {
        await inMemoryHandler(job);
      }
    } catch (err) {
      console.error("In-memory job error:", err?.message || err);
    }
  }

  inMemoryRunning = false;
}

// ---------- Redis/BullMQ ----------
function createRedisConnection() {
  const url = process.env.REDIS_URL;

  if (!url) return null;

  // BullMQ requires maxRetriesPerRequest to be null
  return new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // Railway/managed redis sometimes needs TLS (depends on URL)
    // ioredis auto handles rediss:// usually. If your URL is rediss:// you’re good.
  });
}

let redisConn = null;
let bullQueue = null;
let worker = null;

function ensureBullQueue() {
  if (bullQueue) return bullQueue;

  redisConn = createRedisConnection();
  if (!redisConn) return null;

  bullQueue = new Queue(QUEUE_NAME, { connection: redisConn });
  return bullQueue;
}

/**
 * Enqueue a message payload.
 * If Redis isn't available, it falls back to in-memory processing.
 */
export async function enqueueIncomingMessage(payload) {
  const q = ensureBullQueue();

  if (!q) {
    // Fallback: keep app alive
    inMemoryJobs.push(payload);
    // try process ASAP
    await runInMemoryLoop();
    return { ok: true, mode: "memory" };
  }

  await q.add("incoming", payload, {
    removeOnComplete: 200,
    removeOnFail: 200,
  });

  return { ok: true, mode: "redis" };
}

/**
 * Start worker to process queued jobs.
 * handler: async (payload) => void
 */
export function startWorker(handler) {
  const urlExists = Boolean(process.env.REDIS_URL);

  // Always store handler for fallback
  inMemoryHandler = handler;

  if (!urlExists) {
    console.warn("⚠️ Missing REDIS_URL. Worker will run in-memory mode.");
    return { ok: true, mode: "memory" };
  }

  // Init redis + worker
  redisConn = createRedisConnection();
  if (!redisConn) {
    console.warn("⚠️ Could not create Redis connection. Worker in-memory mode.");
    return { ok: true, mode: "memory" };
  }

  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      await handler(job.data);
    },
    {
      connection: redisConn,
      concurrency: 3,
    }
  );

  worker.on("ready", () => console.log("✅ Worker ready (Redis mode)"));
  worker.on("failed", (job, err) =>
    console.error("❌ Job failed:", job?.id, err?.message || err)
  );
  worker.on("error", (err) =>
    console.error("❌ Worker error:", err?.message || err)
  );

  return { ok: true, mode: "redis" };
}
