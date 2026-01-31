// apps/worker/worker.js
import dotenv from "dotenv";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { salesReply } from "./sales.js";

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL;
if (!REDIS_URL) {
  console.error("❌ Missing REDIS_URL in environment variables");
  process.exit(1);
}

console.log("🟡 Worker booting...");

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy: (times) => {
    const delay = Math.min(times * 200, 3000);
    console.log(`🔁 Redis reconnect attempt #${times} in ${delay}ms`);
    return delay;
  },
});

connection.on("connect", () => console.log("🔌 Redis connected"));
connection.on("ready", () => console.log("✅ Redis ready"));
connection.on("error", (e) => console.error("❌ Redis error:", e?.message || e));
connection.on("close", () => console.log("⚠️ Redis connection closed"));
connection.on("reconnecting", () => console.log("🟠 Redis reconnecting..."));

// ---- SaaS helpers ----
const PAGE_BOT_PREFIX = "egboot:pagebot:"; // key: egboot:pagebot:<pageId> -> botId

async function resolveBotId(jobData, event) {
  // 1) لو webhook باعت botId جاهز
  if (jobData?.botId) return jobData.botId;

  // 2) لو لأ، نستنتج من pageId ونقرأ mapping من Redis
  const pageId = event?.recipient?.id;
  if (!pageId) return null;

  try {
    const botId = await connection.get(PAGE_BOT_PREFIX + pageId);
    return botId || null;
  } catch (e) {
    console.error("❌ resolveBotId Redis error:", e?.message || e);
    return null;
  }
}

function extractText(event) {
  // Messenger text message
  return event?.message?.text || "";
}

function isEcho(event) {
  // Meta sends echo when the PAGE itself sends a message
  return Boolean(event?.message?.is_echo);
}

// ✅ BullMQ Worker (Queue name MUST match webhook: "messages")
const worker = new Worker(
  "messages",
  async (job) => {
    const event = job?.data?.event;
    if (!event) {
      console.warn("⚠️ Job missing event:", job?.id);
      return { ok: false, reason: "missing event" };
    }

    // ❌ ممنوع نرد على echo
    if (isEcho(event)) {
      return { ok: true, skipped: "echo" };
    }

    const senderId = event?.sender?.id;
    const text = extractText(event);

    // لو الرسالة مش نص (صورة/صوت) سيبها لمرحلة بعدين
    if (!senderId || !text?.trim()) {
      return { ok: true, skipped: "no-text" };
    }

    // ✅ botId (SaaS)
    const botId = await resolveBotId(job?.data, event);
    if (!botId) {
      // مؤقتاً: نستخدم default bot لو مفيش mapping
      // (تقدر تخليه يرفض بدل default لو تحب)
      console.warn("⚠️ botId missing, using default: clothes");
    }

    // ✅ token (ممكن يبقى per bot later)
    const pageAccessToken = process.env.PAGE_ACCESS_TOKEN || "";
    if (!pageAccessToken) {
      console.warn("⚠️ PAGE_ACCESS_TOKEN missing in worker env. Replies may fail.");
    }

    await salesReply({
      botId: botId || "clothes",
      senderId,
      text,
      pageAccessToken,
      redis: connection, // نبعته عشان FAQ cache + config
    });

    return { ok: true };
  },
  {
    connection,
    concurrency: Number(process.env.WORKER_CONCURRENCY || 3),
  }
);

worker.on("ready", () => console.log("🟢 Worker ready"));
worker.on("completed", (job, result) => console.log("🎉 Job completed:", job.id, result));
worker.on("failed", (job, err) => console.error("❌ Job failed:", job?.id, err?.message || err));
worker.on("error", (err) => console.error("🔥 Worker error:", err?.message || err));
worker.on("stalled", (jobId) => console.warn("⏳ Job stalled:", jobId));

// ✅ Graceful shutdown
let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`🛑 ${signal} received, stopping worker...`);
  try {
    await worker.close();
  } catch (e) {
    console.error("⚠️ Error while closing worker:", e?.message || e);
  }

  try {
    await connection.quit();
  } catch (e) {
    console.error("⚠️ Error while quitting Redis:", e?.message || e);
  }

  console.log("✅ Worker stopped");
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  console.error("💥 uncaughtException:", err);
  shutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  console.error("💥 unhandledRejection:", reason);
  shutdown("unhandledRejection");
});
