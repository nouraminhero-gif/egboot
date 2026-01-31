// apps/worker/worker.js
import "dotenv/config";

import { Worker } from "bullmq";
import { connection } from "./queue.js"; // نفس Redis instance
import { salesReply } from "./sales.js";

// ================== ENV ==================
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";
const BOT_ID = process.env.BOT_ID || "clothes";

// ================== Worker ==================
const QUEUE_NAME = "messages";

console.log("🟢 Worker starting...");
console.log("📦 Queue:", QUEUE_NAME);

function extractFromEvent(event) {
  if (!event) return {};

  const senderId = event?.sender?.id || null;

  // رسالة نصية
  const text = event?.message?.text || null;

  // postback payload (زي أزرار)
  const postbackPayload = event?.postback?.payload || null;

  const finalText = text || postbackPayload || null;

  const mid = event?.message?.mid || null;

  // تجاهل echo
  const isEcho = Boolean(event?.message?.is_echo);

  return { senderId, text: finalText, mid, isEcho };
}

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const data = job.data || {};

    /**
     * ممكن يبقى job.data واحد من دول:
     * 1) { senderId, text, mid, botId, pageAccessToken }
     * 2) { event, receivedAt, botId, pageAccessToken }
     */

    const botId = data.botId || BOT_ID;
    const pageAccessToken = data.pageAccessToken || PAGE_ACCESS_TOKEN;

    let senderId = data.senderId || null;
    let text = data.text || null;
    let mid = data.mid || null;

    // ✅ لو جاي event من webhook
    if ((!senderId || !text) && data.event) {
      const extracted = extractFromEvent(data.event);

      if (extracted.isEcho) {
        console.log("↩️ Echo ignored");
        return { ignored: "echo" };
      }

      senderId = senderId || extracted.senderId;
      text = text || extracted.text;
      mid = mid || extracted.mid;
    }

    if (!senderId || !text) {
      console.log("⚠️ Job skipped (missing senderId/text)", {
        hasEvent: Boolean(data.event),
        senderId,
        textPreview: String(text || "").slice(0, 50),
      });
      return { skipped: true };
    }

    // ✅ الرد + التعلم
    await salesReply({
      botId,
      senderId,
      text,
      mid,
      pageAccessToken,
      redis: connection,
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
async function shutdown(signal) {
  console.log(`🛑 ${signal} received, shutting down worker...`);
  try {
    await worker.close();
  } catch {}
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
