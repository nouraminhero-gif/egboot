import IORedis from "ioredis";
import { Queue, Worker } from "bullmq";
import { askAI } from "./ai.js";
import { fbSendText, fbTyping } from "./fb.js";

// ✅ Dedup in-memory (يحمي من تكرار نفس الـ mid)
const processed = new Set();
setInterval(() => processed.clear(), 5 * 60 * 1000);

// Redis connection (Railway)
const REDIS_URL = process.env.REDIS_URL;

// لو مفيش Redis هنشتغل inline (fallback) بدل ما السيستم يقع
const hasRedis = Boolean(REDIS_URL);

let connection = null;
let messageQueue = null;

if (hasRedis) {
  connection = new IORedis(REDIS_URL, {
    // ✅ حل BullMQ على Railway/Upstash
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });

  messageQueue = new Queue("messages", { connection });
} else {
  console.warn("⚠️ Missing REDIS_URL. Falling back to inline processing (no queue).");
}

// Add job
export async function enqueueIncomingMessage({ psid, text, mid, timestamp }) {
  const key = mid || `${psid}|${timestamp}|${text}`;
  if (processed.has(key)) return;
  processed.add(key);

  if (!messageQueue) {
    // fallback inline
    await processMessage({ psid, text });
    return;
  }

  await messageQueue.add(
    "process",
    { psid, text },
    {
      // attempts + backoff عشان لو فيسبوك/AI زعل
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: true,
      removeOnFail: 50
    }
  );
}

// Worker
let workerStarted = false;

export function startWorker() {
  if (workerStarted) return;
  workerStarted = true;

  if (!hasRedis) {
    console.log("✅ Worker not started (no Redis). Inline processing enabled.");
    return;
  }

  const worker = new Worker(
    "messages",
    async (job) => {
      const { psid, text } = job.data;
      await processMessage({ psid, text });
    },
    { connection, concurrency: 5 }
  );

  worker.on("ready", () => console.log("✅ Worker started & ready"));
  worker.on("failed", (job, err) => console.error("❌ Job failed:", job?.id, err?.message));
}

async function processMessage({ psid, text }) {
  const pageToken = process.env.PAGE_ACCESS_TOKEN;
  if (!pageToken) {
    console.warn("⚠️ Missing PAGE_ACCESS_TOKEN. Can't reply.");
    return;
  }

  // typing on
  await fbTyping(pageToken, psid, true);

  // AI reply (مع fallback جوه askAI)
  const reply = await askAI(text);

  // typing off
  await fbTyping(pageToken, psid, false);

  await fbSendText(pageToken, psid, reply);
}
