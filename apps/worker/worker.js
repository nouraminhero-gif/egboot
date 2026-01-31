// apps/worker/worker.js

import dotenv from "dotenv";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { salesReply } from "./sales.js";

dotenv.config();

// ================== Redis ==================
const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL;
if (!REDIS_URL) {
  console.error("❌ Missing REDIS_URL in environment variables");
  process.exit(1);
}

console.log("🟡 Worker booting...");

const redis = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times) {
    return Math.min(times * 300, 3000);
  },
});

redis.on("connect", () => console.log("🔌 Redis connected"));
redis.on("ready", () => console.log("✅ Redis ready"));
redis.on("error", (e) => console.error("❌ Redis error:", e?.message || e));
redis.on("reconnecting", () => console.log("🟠 Redis reconnecting"));
redis.on("close", () => console.log("⚠️ Redis connection closed"));

// ================== SaaS helpers ==================
const PAGE_BOT_PREFIX = "egboot:pagebot:"; 
// egboot:pagebot:<pageId> => botId

async function resolveBotId(jobData, event) {
  if (jobData?.botId) return jobData.botId;

  const pageId = event?.recipient?.id;
  if (!pageId) return null;

  try {
    return await redis.get(PAGE_BOT_PREFIX + pageId);
  } catch (e) {
    console.error("❌ resolveBotId error:", e?.message || e);
    return null;
  }
}

function extractText(event) {
  return (
    event?.message?.text ||
    event?.postback?.payload ||
    event?.postback?.title ||
    ""
  );
}

function isEcho(event) {
  return Boolean(event?.message?.is_echo);
}

// ================== Worker ==================
const worker = new Worker(
  "messages",
  async (job) => {
    const event = job?.data?.event;
    if (!event) {
      console.warn("⚠️ Job missing event");
      return { ok: false };
    }

    // تجاهل echo
    if (isEcho(event)) {
      return { ok: true, skipped: "echo" };
    }

    const senderId = event?.sender?.id;
    const text = extractText(event).trim();

    // تجاهل أي رسالة فاضية أو غير نصية
    if (!senderId || !text) {
      return { ok: true, skipped: "no-text" };
    }

    // botId (SaaS)
    let botId = await resolveBotId(job.data, event);
    if (!botId) {
      botId = "clothes"; // default مؤقت
      console.warn("⚠️ botId missing, using default:", botId);
    }

    const pageAccessToken = process.env.PAGE_ACCESS_TOKEN || "";
    if (!pageAccessToken) {
      console.warn("⚠️ PAGE_ACCESS_TOKEN missing");
    }

    await salesReply({
      botId,
      senderId,
      text,
      pageAccessToken,
      redis,
    });

    return { ok: true };
  },
  {
    connection: redis,
    concurrency: Number(process.env.WORKER_CONCURRENCY || 3),
  }
);

// ================== Events ==================
worker.on("ready", () => console.log("🟢 Worker ready"));
worker.on("completed", (job) =>
  console.log("🎉 Job completed:", job.id)
);
worker.on("failed", (job, err) =>
  console.error("❌ Job failed:", job?.id, err?.message || err)
);
worker.on("stalled", (jobId) =>
  console.warn("⏳ Job stalled:", jobId)
);
worker.on("error", (err) =>
  console.error("🔥 Worker error:", err?.message || err)
);

// ================== Graceful shutdown ==================
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`🛑 ${signal} received, shutting down worker...`);

  try {
    await worker.close();
  } catch (e) {
    console.error("⚠️ Worker close error:", e?.message || e);
  }

  try {
    await redis.quit();
  } catch (e) {
    console.error("⚠️ Redis quit error:", e?.message || e);
  }

  console.log("✅ Worker stopped");
  process.exit(0);
}

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
