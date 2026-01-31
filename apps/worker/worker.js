// apps/worker/worker.js
import dotenv from "dotenv";
dotenv.config();

import { Worker } from "bullmq";
import { createClient } from "./queue.js";          // لازم يكون عندك في نفس الفولدر
import { salesReply } from "./sales.js";           // ✅ نفس الفولدر (ده سبب ERR_MODULE_NOT_FOUND)
import axios from "axios";

// ================== ENV ==================
const REDIS_URL = process.env.REDIS_URL;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// لو عندك أكتر من بوت، خليه يقرأ botId من job data
const DEFAULT_BOT_ID = process.env.BOT_ID || "clothes";

// ================== sanity checks ==================
if (!REDIS_URL) console.warn("⚠️ REDIS_URL missing");
if (!PAGE_ACCESS_TOKEN) console.warn("⚠️ PAGE_ACCESS_TOKEN missing");

// ================== Redis connection for BullMQ ==================
const connection = createClient(REDIS_URL);

// ================== Worker ==================
// اسم الكيو لازم يطابق اللي في webhook/server اللي بيضيف الـ jobs
const QUEUE_NAME = process.env.QUEUE_NAME || "egboot:inbox";

console.log("🟢 Starting worker...");
console.log("📌 QUEUE:", QUEUE_NAME);

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    try {
      const data = job.data || {};

      /**
       * expected job.data shape (مثال):
       * {
       *   botId: "clothes",
       *   senderId: "PSID",
       *   text: "رسالة العميل",
       *   mid: "m_xxx",              // Message ID (مهم للـ dedup)
       *   pageAccessToken: "..."     // optional override
       * }
       */

      const botId = data.botId || DEFAULT_BOT_ID;
      const senderId = data.senderId || data.psid || data.sender || null;
      const text = data.text || data.message || "";
      const mid = data.mid || data.messageId || null;

      // لو الـ webhook بيمرر token مع الـ job استخدمه، وإلا خُد من env
      const pageAccessToken = data.pageAccessToken || PAGE_ACCESS_TOKEN;

      if (!senderId || !text?.trim()) {
        console.log("⚠️ Skipping job: missing senderId/text", { senderId, text });
        return { ok: false, reason: "missing_sender_or_text" };
      }

      // ✅ لو عندك redis client عام في queue.js تقدر تبعته هنا
      // معظم الحالات: connection ده هو نفس إعدادات redis اللي BullMQ بيستخدمها
      // بس salesReply محتاج ioredis instance (مش bullmq connection object)
      // فهنحاول نجيب redis client من queue.js (createClient) لو هو ioredis instance.
      const redis = connection;

      await salesReply({
        botId,
        senderId,
        text,
        mid,
        pageAccessToken,
        redis,
      });

      return { ok: true };
    } catch (err) {
      console.error("❌ Worker job failed:", err?.message || err);
      throw err;
    }
  },
  { connection }
);

// ================== events ==================
worker.on("completed", (job, result) => {
  console.log("✅ Job completed:", job.id, result);
});

worker.on("failed", (job, err) => {
  console.error("❌ Job failed:", job?.id, err?.message || err);
});

// ================== health ping (optional) ==================
setInterval(async () => {
  try {
    // Ping Facebook أو Redis أو أي حاجة خفيفة
    if (PAGE_ACCESS_TOKEN) {
      // مجرد call بسيط للتأكد إن التوكن موجود (مش ضروري)
      // await axios.get("https://graph.facebook.com/v18.0/me", {
      //   params: { access_token: PAGE_ACCESS_TOKEN },
      // });
    }
    console.log("💚 Worker alive");
  } catch {
    // تجاهل
  }
}, 60_000);
