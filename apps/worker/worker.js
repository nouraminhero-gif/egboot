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
     * expected job.data:
     * {
     *   botId?: "clothes",
     *   senderId: "PSID",
     *   text: "رسالة العميل",
     *   mid?: "m_xxx",
     *   pageAccessToken?: "..."
     * }
     */

    const botId = data.botId || BOT_ID;
    const senderId = data.senderId;
    const text = data.text;
    const mid = data.mid || null;
    const pageAccessToken = data.pageAccessToken || PAGE_ACCESS_TOKEN;

    if (!senderId || !text) {
      console.log("⚠️ Job skipped (missing senderId/text)", data);
      return { skipped: true };
    }

    // ✅ هنا بننادي salesReply
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
  await worker.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("🛑 SIGINT received, shutting down worker...");
  await worker.close();
  process.exit(0);
});
