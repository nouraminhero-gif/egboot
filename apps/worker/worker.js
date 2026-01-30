// apps/worker/worker.js
import "dotenv/config";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { salesReply } from "./sales.js";

const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL || "";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";

if (!REDIS_URL) {
  console.error("❌ Missing REDIS_URL in environment variables");
  process.exit(1);
}

if (!PAGE_ACCESS_TOKEN) {
  console.warn("⚠️ PAGE_ACCESS_TOKEN missing. Worker will process jobs but cannot reply.");
}

console.log("🟡 Worker booting...");

// Railway/Upstash friendly
const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 3000);
    console.log(`🔁 Redis reconnect attempt #${times} in ${delay}ms`);
    return delay;
  },
});

connection.on("connect", () => console.log("🔌 Redis connected (worker)"));
connection.on("ready", () => console.log("✅ Redis ready (worker)"));
connection.on("error", (e) => console.error("❌ Redis error (worker):", e?.message || e));
connection.on("close", () => console.warn("⚠️ Redis connection closed (worker)"));
connection.on("reconnecting", () => console.log("🟠 Redis reconnecting..."));

const concurrency = Number(process.env.WORKER_CONCURRENCY || 3);

const worker = new Worker(
  "messages",
  async (job) => {
    const event = job?.data?.event;

    if (!event) {
      console.warn("⚠️ Job without event:", job?.id);
      return { ok: false, reason: "no_event" };
    }

    // ignore echo/read/delivery
    if (event?.message?.is_echo) return { ok: true, ignored: "echo" };
    if (event?.read || event?.delivery) return { ok: true, ignored: "read/delivery" };

    try {
      // ✅ salesReply(event, pageAccessToken)  (زي ما ملفك الحالي متوقع)
      await salesReply(event, PAGE_ACCESS_TOKEN);
      return { ok: true };
    } catch (e) {
      console.error("❌ salesReply error:", e?.message || e);
      throw e; // يخلي BullMQ يحسبها failed ويعمل retry
    }
  },
  {
    connection,
    concurrency,
  }
);

worker.on("ready", () => console.log("🟢 Worker ready | concurrency =", concurrency));
worker.on("completed", (job, result) => console.log("✅ Job completed:", job.id, result));
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
    await worker.close(); // يخلص اللي شغال ويقفل
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
