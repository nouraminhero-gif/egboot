// apps/worker/worker.js

import dotenv from "dotenv";
import { Worker } from "bullmq";
import IORedis from "ioredis";

// ✅ لو عندك salesReply فعلاً في worker/sales.js شغّله
// لو الملف مش موجود أو فيه مشكلة import: مش هنوقع الـ worker
let salesReply = null;
try {
  const mod = await import("./sales.js");
  salesReply = mod?.salesReply || mod?.default || null;
  if (salesReply) console.log("✅ salesReply loaded");
  else console.log("⚠️ salesReply not found in ./sales.js");
} catch (e) {
  console.log("⚠️ salesReply import skipped:", e?.message || e);
}

dotenv.config();

// ✅ تأكيد وجود REDIS_URL
const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  console.error("❌ Missing REDIS_URL in environment variables");
  process.exit(1);
}

console.log("🟡 Worker booting...");

// ✅ Redis connection (Railway-friendly)
const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy: (times) => {
    const delay = Math.min(times * 200, 3000);
    console.log(`🔁 Redis reconnect attempt #${times} in ${delay}ms`);
    return delay;
  },
});

connection.on("connect", () => console.log("🔌 Redis connected"));
connection.on("ready", () => console.log("✅ Redis ready"));
connection.on("error", (e) => console.error("❌ Redis error:", e?.message || e));
connection.on("close", () => console.log("⚠️ Redis connection closed"));
connection.on("reconnecting", () => console.log("🟠 Redis reconnecting..."));

// ✅ Helper: safe string
function safeText(x) {
  if (typeof x !== "string") return "";
  return x.trim();
}

// ✅ Extract message data from multiple shapes
function extractFromJob(jobData) {
  // Shape A: { senderId, text, pageAccessToken, ... }
  const senderId = jobData?.senderId || jobData?.psid || jobData?.sender?.id;
  const text = safeText(jobData?.text);

  // Shape B: { event, pageAccessToken }
  const event = jobData?.event;

  if (event) {
    // ignore delivery/read echoes
    if (event?.message?.is_echo) return { skip: true, reason: "echo" };
    if (event?.delivery || event?.read) return { skip: true, reason: "delivery/read" };

    const sId = event?.sender?.id || senderId;
    const t = safeText(event?.message?.text) || text;
    const postback = event?.postback?.payload;

    return {
      skip: false,
      senderId: sId,
      text: t,
      postback,
      event,
      pageAccessToken: jobData?.pageAccessToken,
    };
  }

  return {
    skip: false,
    senderId,
    text,
    postback: jobData?.postbackPayload,
    event: null,
    pageAccessToken: jobData?.pageAccessToken,
  };
}

// ✅ Optional: Facebook send (لو عايز worker يبعت بنفسه)
// لو مش عايزه دلوقتي سيبه، مش هيستخدم إلا لو salesReply رجّعت replyText
async function sendTextMessage(psid, text, token) {
  if (!token) {
    console.warn("⚠️ sendTextMessage skipped: PAGE_ACCESS_TOKEN missing");
    return;
  }
  if (!psid || !text) return;

  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/me/messages?access_token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: psid },
          messaging_type: "RESPONSE",
          message: { text },
        }),
      }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("❌ FB send failed:", res.status, body);
    }
  } catch (err) {
    console.error("❌ FB send error:", err?.message || err);
  }
}

// ✅ BullMQ Worker
const worker = new Worker(
  "messages",
  async (job) => {
    const data = job?.data || {};
    const parsed = extractFromJob(data);

    console.log("📨 Job received:", job.id, {
      hasEvent: !!data?.event,
      senderId: parsed?.senderId,
      hasText: !!parsed?.text,
      hasPostback: !!parsed?.postback,
    });

    if (parsed?.skip) {
      console.log("⏭️ Job skipped:", job.id, parsed.reason);
      return { skipped: true, reason: parsed.reason };
    }

    const senderId = parsed?.senderId;
    const text = parsed?.text;
    const postback = parsed?.postback;

    if (!senderId) {
      console.log("⏭️ Missing senderId, skipping job:", job.id);
      return { skipped: true, reason: "missing_senderId" };
    }

    if (!text && !postback) {
      console.log("⏭️ No text/postback, skipping job:", job.id);
      return { skipped: true, reason: "no_text_or_postback" };
    }

    // ✅ هنا شغلك الحقيقي
    // لو salesReply موجودة هنستخدمها
    // لو مش موجودة هنرد رد تجريبي (علشان تتأكد الدنيا ماشية)
    let replyText = "";

    try {
      if (salesReply) {
        // شكل موحّد لـ salesReply
        const out = await salesReply({
          senderId,
          text,
          postbackPayload: postback,
          event: parsed.event,
          pageAccessToken: parsed.pageAccessToken || process.env.PAGE_ACCESS_TOKEN,
        });

        // salesReply ممكن ترجع:
        // - string
        // - { replyText: "..." }
        // - أو ترجع nothing لو هي بتبعت بنفسها
        if (typeof out === "string") replyText = out;
        else if (out && typeof out === "object" && typeof out.replyText === "string")
          replyText = out.replyText;
        else replyText = ""; // غالبًا salesReply بعتت لوحدها
      } else {
        // رد تجريبي مؤقت
        replyText = text
          ? `✅ Worker شاف رسالتك: "${text}"`
          : `✅ Worker شاف Postback: ${postback}`;
      }
    } catch (err) {
      console.error("❌ Processing error:", err?.message || err);
      replyText = "حصل خطأ بسيط 😅 جرّب تاني بعد شوية";
    }

    // ✅ لو عندنا replyText هنبعته (لو salesReply مش بتبعت بنفسها)
    if (replyText) {
      const token =
        parsed.pageAccessToken || process.env.PAGE_ACCESS_TOKEN || "";
      await sendTextMessage(senderId, replyText, token);
    }

    console.log("✅ Job done:", job.id);
    return { ok: true, replied: !!replyText };
  },
  {
    connection,
    concurrency: Number(process.env.WORKER_CONCURRENCY || 3),
  }
);

// ✅ Worker events
worker.on("ready", () => console.log("🟢 Worker ready"));
worker.on("completed", (job, result) =>
  console.log("🎉 Job completed:", job.id, result)
);
worker.on("failed", (job, err) => {
  console.error("❌ Job failed:", job?.id, err?.message || err);
});
worker.on("error", (err) => {
  console.error("🔥 Worker error:", err?.message || err);
});
worker.on("stalled", (jobId) => {
  console.warn("⏳ Job stalled:", jobId);
});

// ✅ Graceful shutdown (Railway بيرسل SIGTERM)
let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`🛑 ${signal} received, stopping worker...`);
  try {
    await worker.close(); // يخلص اللي شغال ويقفل
  } catch (e) {
    console.error("⚠️ Error while closing worker:", e?.message || e);
  }

  try {
    await connection.quit();
  } catch (e) {
    console.error("⚠️ Error while quitting Redis:", e?.message || e);
    try {
      connection.disconnect();
    } catch {}
  }

  console.log("✅ Worker stopped");
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  console.error("💥 uncaughtException:", err);
  shutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  console.error("💥 unhandledRejection:", reason);
  shutdown("unhandledRejection");
});
