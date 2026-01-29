// queue.js
import Redis from "ioredis";

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
        // لو Redis مش راضي يتصل، متعملش crash loop لا نهائي على Railway
        if (times > 3) return null;
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

  (async function loop() {
    while (true) {
      try {
        const data = await redis.blpop(QUEUE_KEY, 5);
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

    // ✨ AI Reply (Gemini)
    const reply = await getAIReply(text);

    // Send back
    await sendTextMessage(senderId, reply, pageAccessToken);
  }

  // Postback
  if (event.postback) {
    console.log("📦 Postback:", event.postback.payload);
  }
}

// ================== Gemini AI ==================
async function getAIReply(userText) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return "GEMINI_API_KEY مش موجود على السيرفر ❌";
  }

  // Prompt بسيط للبيع (تقدر توسّعه)
  const prompt = `
أنت بوت مبيعات مصري اسمه Egboot.
ردودك قصيرة وواضحة وبتقفل بيع بهدوء.
العميل قال: "${userText}"
رد عليه رد مناسب، وفي آخر الرد اسأل سؤال واحد بس.
`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    const data = await res.json();

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    return text || "ممكن توضحلي أكتر؟ 🤔";
  } catch (err) {
    console.error("❌ Gemini error:", err?.message || err);
    return "حصل مشكلة بسيطة.. جرّب تاني 🙏";
  }
}

// ================== Send Message ==================
async function sendTextMessage(psid, text, token) {
  if (!token) {
    console.warn("⚠️ PAGE_ACCESS_TOKEN missing");
    return;
  }

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
    console.error("❌ Send message error:", err?.message || err);
  }
}

// ================== Utils ==================
function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}
