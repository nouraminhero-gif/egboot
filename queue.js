// queue.js
import Redis from "ioredis";

// ================== Redis Connection ==================
const REDIS_URL =
  process.env.REDIS_PUBLIC_URL ||
  process.env.REDIS_URL ||
  null;

if (!REDIS_URL) {
  console.error("❌ REDIS_PUBLIC_URL / REDIS_URL not found in environment variables");
}

export const redis = REDIS_URL
  ? new Redis(REDIS_URL, {
      // خفّض retries عشان ما تعملش ضغط كبير
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,

      // مهم: لو Redis مش متاح، ما تدخلش في loop لا نهائي
      retryStrategy(times) {
        if (times > 3) return null; // stop retrying
        return Math.min(times * 500, 2000);
      },
    })
  : null;

redis?.on("connect", () => {
  console.log("✅ Redis connected");
});

redis?.on("ready", () => {
  console.log("✅ Redis ready");
});

redis?.on("error", (err) => {
  console.error("❌ Redis error:", err?.message || err);
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
    console.error("❌ enqueue error:", err?.message || err);
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

  // ✅ Loop ذكي بدل while(true):
  // - BLPOP بtimeout طويل (مثلا 30 ثانية)
  // - لو مفيش شغل، نعمل backoff بسيط
  // - لو حصل error، نهدّي ثانية ونكمل
  const BLOCK_SECONDS = 30;

  async function loop() {
    if (!workerRunning) return;

    try {
      const data = await redis.blpop(QUEUE_KEY, BLOCK_SECONDS);

      // لو مفيش شغل خلال الـ timeout
      if (!data) {
        // backoff خفيف عشان Railway ما يشوفش tight loop
        setTimeout(loop, 250);
        return;
      }

      const [, raw] = data;
      let job = null;

      try {
        job = JSON.parse(raw);
      } catch (e) {
        console.error("❌ Bad job JSON:", e?.message || e);
        // كمل على اللي بعده فورًا
        setImmediate(loop);
        return;
      }

      await handleMessage(job, pageAccessToken);

      // كمل فورًا
      setImmediate(loop);
    } catch (err) {
      console.error("❌ Worker error:", err?.message || err);

      // لو Redis اتقفل/اتقطع، ندي وقت ونحاول تاني
      setTimeout(loop, 1000);
    }
  }

  loop();
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
    console.log("📦 Postback:", event.postback?.payload);
  }
}

// ================== Send Message ==================
async function sendTextMessage(psid, text, token) {
  if (!token) return;

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
      console.error("❌ Send message failed:", resp.status, body);
    }
  } catch (err) {
    console.error("❌ Send message error:", err?.message || err);
  }
}
