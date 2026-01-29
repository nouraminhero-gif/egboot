// queue.js
import Redis from "ioredis";
import { salesReply } from "./sales.js";

// ================== Redis Connection ==================
const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL || "";

if (!REDIS_URL) {
  console.warn("⚠️ REDIS_URL is missing. Queue/Session persistence will be disabled.");
}

export const redis = REDIS_URL
  ? new Redis(REDIS_URL, {
      // Railway/Upstash compatible defaults
      enableReadyCheck: false,
      maxRetriesPerRequest: 1,

      retryStrategy(times) {
        // stop retry after some attempts to avoid hanging forever
        if (times > 10) return null;
        return Math.min(times * 500, 5000);
      },
    })
  : null;

redis?.on("connect", () => console.log("✅ Redis connected"));
redis?.on("ready", () => console.log("✅ Redis ready"));
redis?.on("error", (err) => console.error("❌ Redis error:", err?.message || err));
redis?.on("close", () => console.warn("⚠️ Redis connection closed"));

// ================== Queue ==================
const QUEUE_KEY = "egboot:incoming_messages";
let workerRunning = false;

export async function enqueueIncomingMessage(payload) {
  if (!redis) {
    console.warn("⚠️ enqueue skipped: redis not available");
    return;
  }

  try {
    await redis.rpush(QUEUE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error("❌ enqueue error:", err?.message || err);
  }
}

export async function startWorker({ pageAccessToken }) {
  if (!redis) {
    console.warn("⚠️ Worker not started: redis not available");
    return;
  }
  if (workerRunning) {
    console.log("ℹ️ Worker already running");
    return;
  }

  workerRunning = true;
  console.log("👷 Worker started");

  // Run loop in background (no await) لكن بأمان
  loop(pageAccessToken).catch((err) => {
    // المفروض ده نادر جدًا لأن كل حاجة جوه loop متغلفة try/catch
    console.error("❌ Worker fatal loop error:", err?.message || err);
    workerRunning = false;
  });
}

async function loop(pageAccessToken) {
  while (true) {
    try {
      // BLPOP: returns [key, value] or null on timeout
      const data = await redis.blpop(QUEUE_KEY, 10);
      if (!data) continue;

      const [, raw] = data;

      let job;
      try {
        job = JSON.parse(raw);
      } catch (e) {
        console.error("❌ Bad job JSON, skipping");
        continue;
      }

      await handleJob(job, pageAccessToken);
    } catch (err) {
      console.error("❌ Worker error:", err?.message || err);
      await sleep(1000);
    }
  }
}

async function handleJob(job, pageAccessToken) {
  const event = job?.event;
  if (!event) return;

  // ignore delivery/read echoes
  if (event.message?.is_echo) return;
  if (event.delivery || event.read) return;

  // must have sender
  const senderId = event.sender?.id;
  if (!senderId) return;

  // only handle text messages (لو عندك attachments عايز تتعامل معاها بعدين)
  const text = event.message?.text?.trim() || "";
  if (!text) {
    // ممكن تعمل رد: "ابعت رسالة نصية" لو حابب
    return;
  }

  try {
    // ✅ Compatibility: بعض النسخ كانت بتاخد (event, token)
    // وبعضها بتاخد object
    await callSalesReply({ senderId, text, event, pageAccessToken });
  } catch (err) {
    console.error("❌ salesReply crashed:", err?.message || err);

    // fallback safe reply
    await sendTextMessage(
      senderId,
      "حصل خطأ بسيط 😅 جرّب تاني كمان شوية",
      pageAccessToken
    );
  }
}

async function callSalesReply(payload) {
  // 1) preferred: salesReply({ senderId, text, event, pageAccessToken })
  try {
    return await salesReply(payload);
  } catch (e1) {
    // 2) fallback: salesReply(event, token)
    try {
      return await salesReply(payload.event, payload.pageAccessToken);
    } catch (e2) {
      // throw original for logs clarity
      throw e2 || e1;
    }
  }
}

async function sendTextMessage(psid, text, token) {
  if (!token || !psid) return;

  try {
    const res = await fetch(
      `https://graph.facebook.com/v18.0/me/messages?access_token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: psid },
          message: { text },
        }),
      }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("❌ FB send failed:", res.status, body);
    }
  } catch (err) {
    console.error("❌ Send message error:", err?.message || err);
  }
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}
