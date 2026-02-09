// apps/worker/worker.js
import dotenv from "dotenv";
dotenv.config();

import { Worker } from "bullmq";
import { connection } from "./queue.js";
import { salesReply } from "./sales.js";

// ================== ENV ==================
const DEFAULT_PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN; // fallback
const BOT_ID = process.env.BOT_ID || "clothes";
const QUEUE_NAME = "messages";

console.log("🟢 Worker starting...");
console.log("📦 Queue:", QUEUE_NAME);

// ================== Helpers ==================
function extractPageId(data) {
  // 1) explicit
  if (data?.pageId) return String(data.pageId);

  // 2) from webhook raw event: recipient.id is Page ID
  const rid = data?.event?.recipient?.id;
  if (rid) return String(rid);

  // 3) sometimes entry has id
  const entryId = data?.event?.entry?.[0]?.id;
  if (entryId) return String(entryId);

  return null;
}

async function getOwnerEmailFromRedis(pageId) {
  if (!pageId) return null;
  const key = `page:${pageId}:owner_email`;
  const email = await connection.get(key);
  return email ? String(email) : null;
}

async function getPageTokenFromRedis({ pageId, ownerEmail }) {
  if (!pageId && !ownerEmail) return null;

  // ✅ Option A: direct page token (لو مخزنها بالشكل ده)
  if (pageId) {
    const direct = await connection.get(`page_token:${pageId}`);
    if (direct) return String(direct);
  }

  // ✅ Option B: SaaS mapping (اللي في auth-facebook.js)
  if (ownerEmail) {
    const byUser = await connection.get(`user:${ownerEmail}:page_token`);
    if (byUser) return String(byUser);
  }

  return null;
}

// ================== Worker ==================
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const data = job.data || {};

    const senderId = data.senderId;
    const text = data.text;
    const mid = data.mid || null;

    const botId = data.botId || BOT_ID;

    // ✅ pageId extraction
    const pageId = extractPageId(data);

    // ✅ owner email (SaaS)
    const ownerEmail = await getOwnerEmailFromRedis(pageId);

    // ✅ page token resolution
    const pageAccessToken =
      data.pageAccessToken ||
      (await getPageTokenFromRedis({ pageId, ownerEmail })) ||
      DEFAULT_PAGE_ACCESS_TOKEN;

    if (!senderId || !text) {
      console.log("⚠️ Job skipped (missing senderId/text)", {
        senderId,
        textPreview: text ? String(text).slice(0, 40) : null,
        pageId,
        ownerEmail,
      });
      return { skipped: true, reason: "missing_sender_or_text" };
    }

    if (!pageAccessToken) {
      console.log("❌ Missing pageAccessToken", { pageId, ownerEmail });
      return { skipped: true, reason: "missing_page_token", pageId, ownerEmail };
    }

    // ✅ OPTIONAL: تخزين chat history per user (لو حابب)
    // if (ownerEmail) {
    //   await connection.rpush(
    //     `chat:${ownerEmail}`,
    //     JSON.stringify({ senderId, text, mid, pageId, t: Date.now() })
    //   );
    // }

    await salesReply({
      botId,
      senderId,
      text,
      mid,
      pageId,
      ownerEmail, // ✅ مهم للسـ SaaS
      pageAccessToken,
      redis: connection,
      rawEvent: data.event || null,
    });

    return { ok: true, pageId, ownerEmail };
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
