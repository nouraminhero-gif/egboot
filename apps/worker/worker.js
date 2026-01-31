// apps/worker/worker.js
import "dotenv/config";
import { Worker } from "bullmq";
import axios from "axios";

import { connection } from "./queue.js"; // نفس Redis instance
import { geminiGenerateReply, observeAndLearn } from "./sales.js";

// ================== ENV ==================
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";
const BOT_ID = process.env.BOT_ID || "clothes";
const QUEUE_NAME = "messages";

// ================== FB Send ==================
async function sendText(psid, text, token) {
  if (!psid || !token || !text) return;
  try {
    await axios.post(
      "https://graph.facebook.com/v18.0/me/messages",
      {
        recipient: { id: psid },
        messaging_type: "RESPONSE",
        message: { text },
      },
      { params: { access_token: token } }
    );
  } catch (e) {
    console.error("❌ FB send error:", e?.response?.data || e?.message);
  }
}

// ================== Helpers ==================
function extractTextFromEvent(event) {
  // message text
  const text = event?.message?.text;
  if (text && String(text).trim()) return String(text).trim();

  // postback payload (زرار)
  const payload = event?.postback?.payload;
  if (payload && String(payload).trim()) return String(payload).trim();

  return null;
}

function extractMidFromEvent(event) {
  return event?.message?.mid || event?.postback?.mid || null;
}

function extractSenderIdFromEvent(event) {
  return event?.sender?.id || null;
}

// ================== Worker ==================
console.log("🟢 Worker starting...");
console.log("📦 Queue:", QUEUE_NAME);

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const data = job.data || {};

    /**
     * webhook بيبعت:
     * {
     *   event: {...facebook event...},
     *   receivedAt: <timestamp>
     * }
     */
    const event = data.event || null;
    if (!event) {
      console.log("⚠️ Job skipped (missing event)", data);
      return { skipped: true };
    }

    // تجاهل echo
    if (event?.message?.is_echo) return { skipped: true, echo: true };

    const senderId = extractSenderIdFromEvent(event);
    const text = extractTextFromEvent(event);
    const mid = extractMidFromEvent(event);

    if (!senderId || !text) {
      console.log("⚠️ Job skipped (missing senderId/text)", {
        senderId,
        text,
        mid,
      });
      return { skipped: true };
    }

    // ✅ Gemini only mode:
    // - Gemini يرد
    // - البوت يسجل ويتعلم فقط

    const botId = BOT_ID;
    const pageAccessToken = PAGE_ACCESS_TOKEN;

    if (!pageAccessToken) {
      console.warn("⚠️ PAGE_ACCESS_TOKEN missing (cannot reply to FB).");
      // حتى لو مش هنعرف نرد، نسجل برضه
    }

    // 1) Gemini reply
    const { replyText, meta } = await geminiGenerateReply({
      botId,
      senderId,
      userText: text,
      redis: connection,
    });

    // 2) send reply (Gemini reply)
    if (replyText && pageAccessToken) {
      await sendText(senderId, replyText, pageAccessToken);
    }

    // 3) observe + learn (save Q/A + slots + history)
    await observeAndLearn({
      botId,
      senderId,
      userText: text,
      replyText: replyText || "",
      mid,
      redis: connection,
      meta,
    });

    return { ok: true };
  },
  { connection, concurrency: 5 }
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
