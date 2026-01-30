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
      // مهم جدًا للـ blocking commands زي BLPOP
      enableReadyCheck: false,
      maxRetriesPerRequest: null, // ✅ لازم null عشان BLPOP ما يضربش

      // خليه يتصل لما نحتاجه (مفيد في web service)
      lazyConnect: true,
      connectTimeout: 10000,

      retryStrategy(times) {
        // stop retry after some attempts to avoid hanging forever
        if (times > 20) return null;
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
let stopRequested = false;
let signalsHooked = false;

function hookSignalsOnce() {
  if (signalsHooked) return;
  signalsHooked = true;

  const shutdown = async (sig) => {
    console.log(`🛑 ${sig} received. Stopping worker...`);
    stopRequested = true;

    // فك الـ BLPOP لو كان واقف (اختياري)
    try {
      // ping غالبًا بيفك تعليق الشبكة
      await redis?.ping?.();
    } catch {}

    // اقفل redis
    try {
      await redis?.quit?.();
    } catch {
      try {
        redis?.disconnect?.();
      } catch {}
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

async function ensureRedis() {
  if (!redis) return null;
  try {
    if (redis.status === "wait") {
      await redis.connect();
    }
    return redis;
  } catch (e) {
    console.error("❌ Redis connect failed:", e?.message || e);
    return null;
  }
}

export async function enqueueIncomingMessage(payload) {
  const r = await ensureRedis();
  if (!r) {
    console.warn("⚠️ enqueue skipped: redis not available");
    return;
  }

  try {
    await r.rpush(QUEUE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error("❌ enqueue error:", err?.message || err);
  }
}

export async function startWorker({ pageAccessToken }) {
  hookSignalsOnce();

  const r = await ensureRedis();
  if (!r) {
    console.warn("⚠️ Worker not started: redis not available");
    return;
  }
  if (workerRunning) {
    console.log("ℹ️ Worker already running");
    return;
  }

  workerRunning = true;
  stopRequested = false;

  console.log("👷 Worker started");

  // Run loop in background (no await) لكن بأمان
  loop(pageAccessToken).catch((err) => {
    console.error("❌ Worker fatal loop error:", err?.message || err);
    workerRunning = false;
  });
}

async function loop(pageAccessToken) {
  while (!stopRequested) {
    try {
      const r = await ensureRedis();
      if (!r) {
        await sleep(1500);
        continue;
      }

      // BLPOP: returns [key, value] or null on timeout
      const data = await r.blpop(QUEUE_KEY, 10);
      if (stopRequested) break;
      if (!data) continue;

      const [, raw] = data;

      let job;
      try {
        job = JSON.parse(raw);
      } catch {
        console.error("❌ Bad job JSON, skipping");
        continue;
      }

      await handleJob(job, pageAccessToken);
    } catch (err) {
      if (stopRequested) break;
      console.error("❌ Worker error:", err?.message || err);
      await sleep(1000);
    }
  }

  workerRunning = false;
  console.log("✅ Worker stopped");
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

  // only handle text messages
  const text = event.message?.text?.trim() || "";
  if (!text) return;

  try {
    // ✅ Compatibility: بعض النسخ كانت بتاخد (event, token)
    // وبعضها بتاخد object
    await callSalesReply({ senderId, text, event, pageAccessToken });
  } catch (err) {
    console.error("❌ salesReply crashed:", err?.message || err);

    // fallback safe reply
    await sendTextMessage(senderId, "حصل خطأ بسيط 😅 جرّب تاني كمان شوية", pageAccessToken);
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
      throw e2 || e1;
    }
  }
}

async function sendTextMessage(psid, text, token) {
  if (!token || !psid) return;

  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: psid },
        message: { text },
      }),
    });

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
