// apps/worker/worker.js

import dotenv from "dotenv";
import { Worker } from "bullmq";
import IORedis from "ioredis";

dotenv.config();

// ✅ تأكيد وجود REDIS_URL
const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  console.error("❌ Missing REDIS_URL in environment variables");
  process.exit(1);
}

console.log("🟡 Worker booting...");

// ✅ Redis connection (Railway-friendly)
const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false, // مهم أحيانًا على managed redis
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

// ✅ BullMQ Worker
const worker = new Worker(
  "messages",
  async (job) => {
    console.log("📨 Job received:", job.id, job.data);

    // ✅ هنا شغلك الحقيقي (مؤقتًا)
    await new Promise((res) => setTimeout(res, 1000));

    console.log("✅ Job done:", job.id);
    return { ok: true };
  },
  {
    connection,
    concurrency: Number(process.env.WORKER_CONCURRENCY || 3),
    // لو عندك Jobs تقيلة زوّد lockDuration
    // lockDuration: 30000,
  }
);

// ✅ Worker events
worker.on("ready", () => console.log("🟢 Worker ready"));
worker.on("completed", (job, result) =>
  console.log("🎉 Job completed:", job.id, result)
);
worker.on("failed", (job, err) => {
  console.error("❌ Job failed:", job?.id, err?.message || err);
});
worker.on("error", (err) => {
  console.error("🔥 Worker error:", err?.message || err);
});
worker.on("stalled", (jobId) => {
  console.warn("⏳ Job stalled:", jobId);
});

// ✅ Graceful shutdown (Railway بيرسل SIGTERM)
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
