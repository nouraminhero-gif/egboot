// queue.js
import Redis from "ioredis";
import { salesReply } from "./sales.js";

// ================== Redis Connection ==================
const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL || null;

if (!REDIS_URL) {
  console.error("❌ REDIS_URL not found in env");
}

export const redis = REDIS_URL
  ? new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      retryStrategy(times) {
        if (times > 3) return null;
        return Math.min(times * 500, 2000);
      },
    })
  : null;

redis?.on("connect", () => console.log("✅ Redis connected"));
redis?.on("error", (err) => console.error("❌ Redis error:", err.message));

// ================== Queue ==================
const QUEUE_KEY = "egboot:incoming_messages";
let workerRunning = false;

export async function enqueueIncomingMessage(payload) {
  if (!redis) return console.warn("⚠️ enqueue skipped: redis not available");
  try {
    await redis.rpush(QUEUE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error("❌ enqueue error:", err.message);
  }
}

export async function startWorker({ pageAccessToken }) {
  if (!redis) return console.warn("⚠️ Worker not started: redis not available");
  if (workerRunning) return console.log("ℹ️ Worker already running");

  workerRunning = true;
  console.log("👷 Worker started");

  (async function loop() {
    while (true) {
      try {
        const data = await redis.blpop(QUEUE_KEY, 10);
        if (!data) continue;

        const [, raw] = data;
        const job = JSON.parse(raw);

        await handleJob(job, pageAccessToken);
      } catch (err) {
        console.error("❌ Worker error:", err.message);
        await sleep(1000);
      }
    }
  })();
}

async function handleJob(job, pageAccessToken) {
  const event = job?.event;
  if (!event) return;

  // ignore delivery/read echoes
  if (event.message?.is_echo) return;
  if (event.delivery || event.read) return;

  try {
    await salesReply(event, pageAccessToken);
  } catch (err) {
    console.error("❌ salesReply crashed:", err?.message || err);
    // fallback safe reply لو كل حاجة وقعت
    const psid = event.sender?.id;
    if (psid) {
      await sendTextMessage(psid, "حصل خطأ بسيط 😅 جرّب تاني كمان شوية", pageAccessToken);
    }
  }
}

async function sendTextMessage(psid, text, token) {
  if (!token || !psid) return;
  try {
    await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: psid }, message: { text } }),
    });
  } catch (err) {
    console.error("❌ Send message error:", err.message);
  }
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}
