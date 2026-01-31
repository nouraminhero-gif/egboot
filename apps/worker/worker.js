// apps/worker/worker.js
import dotenv from "dotenv";
dotenv.config();

import { Worker } from "bullmq";
import { connection } from "./queue.js";
import { salesReply } from "./sales.js";

// ================== ENV ==================
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const BOT_ID = process.env.BOT_ID || "clothes";

if (!PAGE_ACCESS_TOKEN) {
  console.warn("⚠️ PAGE_ACCESS_TOKEN missing");
}

const QUEUE_NAME = "messages";

console.log("🟢 Worker starting...");
console.log("📦 Queue:", QUEUE_NAME);

function extractFromWebhookEvent(event) {
  const senderId = event?.sender?.id || null;

  // رسالة نصية
  const text = event?.message?.text || null;
  const mid = event?.message?.mid || null;

  // postback payload لو موجود
  const payload = event?.postback?.payload || null;

  // لو مفيش text و فيه payload نعتبره text عشان البوت يفهمه
  const finalText = text || payload;

  return { senderId, text: finalText, mid };
}

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const data = job.data || {};

    // ===== Case A: job جايل من webhook بشكل { event } =====
    let senderId = data.senderId;
    let text = data.text;
    let mid = data.mid || null;

    if ((!senderId || !text) && data.event) {
      const extracted = extractFromWebhookEvent(data.event);
      senderId = senderId || extracted.senderId;
      text = text || extracted.text;
      mid = mid || extracted.mid;
    }

    const botId = data.botId || BOT_ID;
    const pageAccessToken = data.pageAccessToken || PAGE_ACCESS_TOKEN;

    if (!senderId || !text) {
      console.log("⚠️ Job skipped (missing senderId/text)", {
        hasEvent: !!data.event,
        senderId,
        textPreview: text ? String(text).slice(0, 40) : null,
      });
      return { skipped: true };
    }

    // ✅ Gemini بيرد كالمعتاد داخل salesReply
    await salesReply({
      botId,
      senderId,
      text,
      mid,
      pageAccessToken,
      redis: connection,
      rawEvent: data.event || null, // مفيد للتسجيل/التحليل لو حبيت
    });

    return { ok: true };
  },
  { connection, concurrency: 5 }
);

worker.on("completed", (job) => console.log("✅ Job completed:", job.id));
worker.on("failed", (job, err) =>
  console.error("❌ Job failed:", job?.id, err?.message || err)
);

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
