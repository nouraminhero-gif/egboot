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

async function getPageTokenFromRedis(pageId) {
  if (!pageId) return null;
  // ✅ هنخزن التوكن كده: page_token:<PAGE_ID>
  const key = `page_token:${pageId}`;
  const token = await connection.get(key);
  return token || null;
}

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const data = job.data || {};

    const senderId = data.senderId;
    const text = data.text;
    const mid = data.mid || null;

    const botId = data.botId || BOT_ID;

    // ✅ هنا السحر: نحدد توكن الصفحة
    const pageId = data.pageId || null;

    let pageAccessToken =
      data.pageAccessToken ||
      (await getPageTokenFromRedis(pageId)) ||
      DEFAULT_PAGE_ACCESS_TOKEN;

    if (!senderId || !text) {
      console.log("⚠️ Job skipped (missing senderId/text)", {
        senderId,
        textPreview: text ? String(text).slice(0, 40) : null,
      });
      return { skipped: true };
    }

    if (!pageAccessToken) {
      console.log("❌ Missing pageAccessToken for pageId:", pageId);
      return { skipped: true, reason: "missing_page_token", pageId };
    }

    await salesReply({
      botId,
      senderId,
      text,
      mid,
      pageAccessToken,
      redis: connection,
      rawEvent: data.event || null,
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
