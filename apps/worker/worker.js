// apps/worker/worker.js
import dotenv from "dotenv";
dotenv.config();

import { Worker } from "bullmq";
import { connection } from "./queue.js"; // ✅ نفس Redis instance
import { salesReply } from "./sales.js";

// ================== ENV ==================
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const BOT_ID = process.env.BOT_ID || "clothes";

// ================== Sanity checks ==================
if (!PAGE_ACCESS_TOKEN) {
  console.warn("⚠️ PAGE_ACCESS_TOKEN missing");
}

// ================== Helpers ==================
function extractMessage(jobData = {}) {
  // jobData ممكن يبقى:
  // 1) الشكل القديم: { senderId, text, mid, botId, pageAccessToken }
  // 2) شكل الويبهوك: { event: { sender:{id}, message:{text, mid} } }
  // 3) أحيانًا jobData نفسه = event

  const event = jobData.event || jobData;

  const senderId =
    jobData.senderId ||
    event?.sender?.id ||
    null;

  const text =
    jobData.text ||
    event?.message?.text ||
    event?.text ||
    null;

  const mid =
    jobData.mid ||
    event?.message?.mid ||
    event?.mid ||
    null;

  const botId =
    jobData.botId ||
    BOT_ID;

  const pageAccessToken =
    jobData.pageAccessToken ||
    PAGE_ACCESS_TOKEN;

  return { botId, senderId, text, mid, pageAccessToken, event };
}

// ================== Worker ==================
// 👈 لازم يطابق اسم الكيو في queue.js
const QUEUE_NAME = "messages";

console.log("🟢 Worker starting...");
console.log("📦 Queue:", QUEUE_NAME);

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const data = job.data || {};

    const { botId, senderId, text, mid, pageAccessToken, event } = extractMessage(data);

    if (!senderId || !text) {
      console.log("⚠️ Job skipped (missing senderId/text)", {
        senderId,
        text,
        preview: {
          hasEvent: Boolean(data?.event),
          sender: event?.sender,
          message: event?.message,
          rawKeys: Object.keys(data || {}),
        },
      });
      return { skipped: true };
    }

    await salesReply({
      botId,
      senderId,
      text,
      mid,
      pageAccessToken,
      redis: connection, // ✅ نفس Redis
    });

    return { ok: true };
  },
  {
    connection,
    concurrency: 5,
  }
);

// ================== Logs ==================
worker.on("completed", (job) => {
  console.log("✅ Job completed:", job.id);
});

worker.on("failed", (job, err) => {
  console.error("❌ Job failed:", job?.id, err?.message || err);
});

// ================== Graceful shutdown ==================
process.on("SIGTERM", async () => {
  console.log("🛑 SIGTERM received, shutting down worker...");
  await worker.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("🛑 SIGINT received, shutting down worker...");
  await worker.close();
  process.exit(0);
});
