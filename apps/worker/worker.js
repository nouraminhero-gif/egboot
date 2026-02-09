// apps/worker/worker.js
import dotenv from "dotenv";
dotenv.config();

import { Worker } from "bullmq";
import { connection } from "./queue.js";
import { salesReply } from "./sales.js";

const QUEUE_NAME = "messages";

const DEFAULT_PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN; // fallback
const BOT_ID = process.env.BOT_ID || "clothes";

console.log("🟢 Worker starting...");
console.log("📦 Queue:", QUEUE_NAME);

async function getPageTokenFromRedis(pageId) {
  if (!pageId) return null;

  // ✅ auth-facebook.js بيخزن:
  // user:<email>:page_token
  // وكمان: page:<pageId>:owner_email
  // إحنا هنخزن كمان: page:<pageId>:page_token (لو موجود عندك بالفعل)
  // بس عشان نمشي مع الكود اللي انت بعته في auth-facebook.js اللي بيحط:
  // await redis.set(`user:${email}:page_token`, token)
  // فهنا هنجيب owner_email الأول، وبعدين نجيب توكن المستخدم.

  const ownerEmail = await connection.get(`page:${pageId}:owner_email`);
  if (!ownerEmail) return null;

  const token = await connection.get(`user:${ownerEmail}:page_token`);
  return token || null;
}

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const data = job.data || {};

    const senderId = data.senderId || null;
    const text = data.text || null;
    const mid = data.mid || null;

    const pageId = data.pageId || null;

    // botId عندنا = email (من السيرفر) أو fallback
    const botId = data.botId || BOT_ID;

    if (!senderId || !text) {
      console.log("⚠️ Job skipped (missing senderId/text)", {
        senderId,
        textPreview: text ? String(text).slice(0, 60) : null,
      });
      return { skipped: true };
    }

    // ✅ Token selection (Multi-page)
    const pageAccessToken =
      data.pageAccessToken ||
      (await getPageTokenFromRedis(pageId)) ||
      DEFAULT_PAGE_ACCESS_TOKEN;

    if (!pageAccessToken) {
      console.log("❌ Missing pageAccessToken for pageId:", pageId);
      return { skipped: true, reason: "missing_page_token", pageId };
    }

    // ✅ ثبت profile للمستخدم على ريديس (عشان يبقى لكل user داتا لوحده)
    // tenant = botId (email)
    const profileKey = `user:${botId}:sender:${senderId}:profile`;
    try {
      await connection.hset(profileKey, {
        botId,
        pageId: pageId || "",
        senderId,
        lastMid: mid || "",
        updatedAt: String(Date.now()),
      });
      await connection.expire(profileKey, 60 * 60 * 24 * 30); // 30 يوم
    } catch (e) {
      console.log("⚠️ Redis profile save failed:", e?.message || e);
    }

    // ✅ نمرر كل حاجة للـ salesReply
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

async function shutdown(signal) {
  console.log(`🛑 ${signal} received, shutting down worker...`);
  try { await worker.close(); } catch {}
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
