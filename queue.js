// queue.js
import Redis from "ioredis";

// ================== Redis Connection ==================
const REDIS_URL =
  process.env.REDIS_URL ||
  process.env.REDIS_PUBLIC_URL ||
  null;

if (!REDIS_URL) {
  console.error("❌ No Redis URL found. Set REDIS_URL (recommended) or REDIS_PUBLIC_URL.");
}

export const redis = REDIS_URL
  ? new Redis(REDIS_URL, {
      // مهم جدًا: خليه null عشان ioredis ما يطلعش "Reached max retries..."
      maxRetriesPerRequest: null,

      // Railway أحيانًا يبقى جاهز قبل Redis أو العكس، فبنسهّل الاتصال
      enableReadyCheck: false,
      lazyConnect: true,
      connectTimeout: 10_000,
      retryStrategy(times) {
        if (times > 10) return null; // بعد محاولات كتير ابطل محاولات عشان ما نعملش loop مجنون
        return Math.min(times * 500, 3000);
      },
    })
  : null;

async function ensureRedisConnected() {
  if (!redis) return false;
  try {
    if (redis.status === "ready") return true;
    if (redis.status === "connecting") return true;
    await redis.connect();
    return true;
  } catch (e) {
    console.error("❌ Redis connect failed:", e?.message || e);
    return false;
  }
}

redis?.on("connect", () => console.log("✅ Redis connected"));
redis?.on("ready", () => console.log("🟢 Redis ready"));
redis?.on("error", (err) => console.error("❌ Redis error:", err?.message || err));
redis?.on("end", () => console.warn("⚠️ Redis connection ended"));

// ================== Queue Config ==================
const QUEUE_KEY = "egboot:incoming_messages";
let workerRunning = false;

// ================== Enqueue ==================
export async function enqueueIncomingMessage(payload) {
  const ok = await ensureRedisConnected();
  if (!ok) {
    console.warn("⚠️ enqueue skipped: redis not available");
    return;
  }

  try {
    await redis.rpush(QUEUE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error("❌ enqueue error:", err?.message || err);
  }
}

// ================== Worker ==================
export async function startWorker({ pageAccessToken }) {
  const ok = await ensureRedisConnected();
  if (!ok) {
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
        const data = await redis.blpop(QUEUE_KEY, 10);
        if (!data) continue;

        const [, raw] = data;
        const job = JSON.parse(raw);

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

  // Message
  if (event.message?.text) {
    const senderId = event.sender?.id;
    const text = event.message.text;
    if (!senderId) return;

    console.log("📩 Message:", senderId, text);

    // هنا بعدين هنركب AI / Sales Logic
    await sendTextMessage(senderId, "تم استلام رسالتك ✅", pageAccessToken);
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
    const resp = await fetch(
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

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error("❌ FB send failed:", resp.status, body);
    }
  } catch (err) {
    console.error("❌ Send message error:", err?.message || err);
  }
}

// ================== Utils ==================
function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}
