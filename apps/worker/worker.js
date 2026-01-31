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

// ================== Worker ==================
// 👈 لازم يطابق اسم الكيو في queue.js
const QUEUE_NAME = "messages";

console.log("🟢 Worker starting...");
console.log("📦 Queue:", QUEUE_NAME);

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const data = job.data || {};

    /**
     * We support 2 shapes:
     *
     * A) Direct:
     * {
     *   botId?: "clothes",
     *   senderId: "PSID",
     *   text: "رسالة العميل",
     *   mid?: "m_xxx",
     *   pageAccessToken?: "..."
     * }
     *
     * B) Webhook event (your current server.js):
     * {
     *   event: { sender:{id}, message:{text,mid}, postback:{payload} ... },
     *   receivedAt: ...
     * }
     */

    const botId = data.botId || BOT_ID;
    const pageAccessToken = data.pageAccessToken || PAGE_ACCESS_TOKEN;

    // ✅ Support webhook format
    const event = data.event || {};

    // ✅ senderId from either direct or event
    const senderId =
      data.senderId ||
      event?.sender?.id ||
      null;

    // ✅ text from either direct or event
    const text =
      data.text ||
      event?.message?.text ||
      event?.postback?.payload ||
      null;

    // ✅ mid from either direct or event
    const mid =
      data.mid ||
      event?.message?.mid ||
      null;

    if (!senderId || !text) {
      console.log("⚠️ Job skipped (missing senderId/text)", {
        hasSenderId: Boolean(senderId),
        hasText: Boolean(text),
        keys: Object.keys(data || {}),
        eventKeys: Object.keys(event || {}),
      });
      return { skipped: true };
    }

    // ✅ Call salesReply
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
    concurrency: 5, // عدلها براحتك
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
  try {
    await worker.close();
  } catch {}
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("🛑 SIGINT received, shutting down worker...");
  try {
    await worker.close();
  } catch {}
  process.exit(0);
});
