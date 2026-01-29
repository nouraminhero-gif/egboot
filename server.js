// queue.js
import Redis from "ioredis";

// ================== Redis Connection ==================
const REDIS_URL =
  process.env.REDIS_PUBLIC_URL ||
  process.env.REDIS_URL ||
  null;

if (!REDIS_URL) {
  console.error("❌ REDIS_PUBLIC_URL not found in environment variables");
}

export const redis = REDIS_URL
  ? new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      retryStrategy(times) {
        if (times > 3) return null; // مهم عشان Railway ما يعملش restart loop
        return Math.min(times * 500, 2000);
      },
    })
  : null;

redis?.on("connect", () => {
  console.log("✅ Redis connected");
});

redis?.on("error", (err) => {
  console.error("❌ Redis error:", err.message);
});

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

        await handleMessage(job, pageAccessToken);
      } catch (err) {
        console.error("❌ Worker error:", err.message);
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
    const senderId = event.sender.id;
    const text = event.message.text;

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
  if (!token) return;

  try {
    await fetch(
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
  } catch (err) {
    console.error("❌ Send message error:", err.message);
  }
}

// ================== Utils ==================
function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}
