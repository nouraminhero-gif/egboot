// queue.js
import Redis from "ioredis";
import { salesReply } from "./sales.js";

// ================== Redis Connection ==================
const REDIS_URL =
  process.env.REDIS_PUBLIC_URL ||
  process.env.REDIS_URL ||
  null;

if (!REDIS_URL) {
  console.error("❌ REDIS_PUBLIC_URL/REDIS_URL not found in environment variables");
}

export const redis = REDIS_URL
  ? new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      retryStrategy(times) {
        if (times > 3) return null; // يمنع restart loop
        return Math.min(times * 500, 2000);
      },
    })
  : null;

redis?.on("connect", () => console.log("✅ Redis connected"));
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
        const job = JSON.parse(raw);

        await handleJob(job, pageAccessToken);
      } catch (err) {
        console.error("❌ Worker error:", err.message);
        await sleep(1000);
      }
    }
  })();
}

// ================== Job Handler ==================
async function handleJob(job, pageAccessToken) {
  const event = job?.event;
  if (!event) return;

  // Message
  if (event.message?.text) {
    const senderId = event.sender?.id;
    const text = event.message.text;

    if (!senderId) return;

    console.log("📩 Message:", senderId, text);

    // ✅ هنا بقى الرد ييجي من sales.js
    const reply = await salesReply({
      text,
      senderId,
      storeId: "default",
    });

    await sendTextMessage(senderId, reply, pageAccessToken);
    return;
  }

  // Postback
  if (event.postback) {
    console.log("📦 Postback:", event.postback.payload);
  }
}

// ================== Send Message ==================
async function sendTextMessage(psid, text, token) {
  if (!token) {
    console.warn("⚠️ PAGE_ACCESS_TOKEN missing");
    return;
  }

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

    if (!r.ok) {
      const body = await r.text();
      console.error("❌ FB send failed:", r.status, body);
    }
  } catch (err) {
    console.error("❌ Send message error:", err.message);
  }
}

// ================== Utils ==================
function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}
