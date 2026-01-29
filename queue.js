// queue.js
import Redis from "ioredis";
import { salesReply } from "./sales.js";

// ================== Redis Connection ==================
const REDIS_URL =
  process.env.REDIS_PUBLIC_URL ||
  process.env.REDIS_URL ||
  null;

if (!REDIS_URL) {
  console.error("❌ REDIS_URL / REDIS_PUBLIC_URL not found in env");
}

export const redis = REDIS_URL
  ? new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      retryStrategy(times) {
        // مهم عشان Railway ما يعملش restart loop
        if (times > 3) return null;
        return Math.min(times * 500, 2000);
      },
    })
  : null;

redis?.on("connect", () => console.log("✅ Redis connected"));
redis?.on("ready", () => console.log("✅ Redis ready"));
redis?.on("error", (err) => console.error("❌ Redis error:", err.message));

// ================== Queue Config ==================
const QUEUE_KEY = "egboot:incoming_messages";
let workerRunning = false;

// ================== Enqueue ==================
export async function enqueueIncomingMessage(payload) {
  if (!redis) {
    console.warn("⚠️ enqueue skipped: redis not available");
    return;
  }

  try {
    await redis.rpush(QUEUE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error("❌ enqueue error:", err.message);
  }
}

// ================== Worker ==================
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

  (async function loop() {
    while (true) {
      try {
        const data = await redis.blpop(QUEUE_KEY, 5);
        if (!data) continue;

        const [, raw] = data;
        const job = safeJsonParse(raw);
        if (!job) continue;

        await handleMessage(job, pageAccessToken);
      } catch (err) {
        console.error("❌ Worker error:", err?.message || err);
        await sleep(1000);
      }
    }
  })();
}

// ================== Message Handler ==================
async function handleMessage(job, pageAccessToken) {
  const event = job?.event;
  if (!event) return;

  // (اختياري) منع تكرار نفس الرسالة لو في retries من FB
  // بيعتمد على message.mid
  const mid = event?.message?.mid;
  if (mid) {
    const seen = await markIfSeen(mid);
    if (seen) {
      console.log("🔁 Duplicate message skipped:", mid);
      return;
    }
  }

  // Message Text
  if (event.message?.text) {
    const senderId = event.sender?.id;
    const text = event.message.text;

    if (!senderId) return;

    console.log("📩 Message:", senderId, text);

    // ✅ رد بيعي (مرحلة A)
    const reply = await salesReply(text, senderId);

    await sendTextMessage(senderId, reply, pageAccessToken);
    return;
  }

  // Postback
  if (event.postback) {
    console.log("📦 Postback:", event.postback?.payload || "");
  }
}

// ================== Dedupe (optional) ==================
async function markIfSeen(mid) {
  if (!redis) return false;

  const key = `seen:${mid}`;

  // SET key "1" NX EX 600  => 10 دقائق
  // لو اتعمل set لأول مرة => return false (مش مكرر)
  // لو كان موجود => return true (مكرر)
  try {
    const res = await redis.set(key, "1", "NX", "EX", 600);
    return res !== "OK";
  } catch (e) {
    // لو حصل أي مشكلة في الديدوب، ما نكسرش السيستم
    return false;
  }
}

// ================== Send Message ==================
async function sendTextMessage(psid, text, token) {
  if (!token) {
    console.warn("⚠️ PAGE_ACCESS_TOKEN missing");
    return;
  }

  // Node 22 فيه fetch built-in، فمش محتاج node-fetch
  try {
    const r = await fetch(
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

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("❌ FB send error:", r.status, data);
    }
  } catch (err) {
    console.error("❌ Send message error:", err?.message || err);
  }
}

// ================== Utils ==================
function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    console.error("❌ Bad JSON job:", str?.slice?.(0, 200));
    return null;
  }
}
