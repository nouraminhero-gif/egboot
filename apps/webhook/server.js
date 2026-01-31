// apps/webhook/server.js
import "dotenv/config";
import express from "express";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 8080;

// =======================
// Redis / BullMQ connection
// =======================
const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL || "";
if (!REDIS_URL) {
  console.warn("⚠️ REDIS_URL missing in webhook. Enqueue will be disabled.");
}

const connection = REDIS_URL
  ? new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy(times) {
        if (times > 10) return null;
        return Math.min(times * 500, 5000);
      },
    })
  : null;

connection?.on("connect", () => console.log("🔌 Redis connected (webhook)"));
connection?.on("ready", () => console.log("✅ Redis ready (webhook)"));
connection?.on("error", (e) =>
  console.error("❌ Redis error (webhook):", e?.message || e)
);

const queue = connection
  ? new Queue("messages", {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { count: 5000 },
        removeOnFail: { count: 2000 },
      },
    })
  : null;

// =======================
// Health + Root
// =======================
app.get("/health", (req, res) => res.status(200).send("OK"));
app.get("/", (req, res) => res.status(200).send("Egboot webhook running ✅"));

// =======================
// Verify webhook
// =======================
app.get("/webhook", (req, res) => {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
    if (!VERIFY_TOKEN) {
      console.error("❌ Missing VERIFY_TOKEN in env vars");
      return res.sendStatus(500);
    }

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ Webhook verified");
      return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
  } catch (err) {
    console.error("❌ Webhook verify error:", err?.message || err);
    return res.sendStatus(500);
  }
});

// =======================
// Receive messages
// =======================
app.post("/webhook", async (req, res) => {
  // ✅ رد سريع لفيسبوك
  res.sendStatus(200);

  try {
    const body = req.body;

    // ✅ لازم object=page
    if (!body || body.object !== "page") return;

    // ✅ لازم يكون عندنا queue
    if (!queue) {
      console.warn("⚠️ Queue not available (missing REDIS_URL).");
      return;
    }

    const entries = Array.isArray(body.entry) ? body.entry : [];
    for (const entry of entries) {
      const messagingEvents = Array.isArray(entry.messaging)
        ? entry.messaging
        : [];

      for (const event of messagingEvents) {
        const psid = event?.sender?.id;
        if (!psid) continue;

        // ✅ تجاهل echo عشان البوت ميكلمش نفسه
        if (event?.message?.is_echo) continue;

        // ✅ تجاهل delivery/read events
        if (event?.delivery || event?.read) continue;

        const text = event?.message?.text?.trim();
        const quickReplyPayload = event?.message?.quick_reply?.payload;
        const postbackPayload = event?.postback?.payload;

        // ✅ لازم يبقى في input حقيقي من العميل (text أو quickReply أو postback)
        const hasInput = Boolean(text || quickReplyPayload || postbackPayload);
        if (!hasInput) continue;

        // ✅ منع تكرار نفس الرسالة (لو mid موجود)
        const mid = event?.message?.mid || null;
        const jobId = mid ? `mid:${mid}` : undefined;

        await queue.add(
          "incoming_message",
          {
            event,
            receivedAt: Date.now(),
          },
          {
            jobId, // لو موجود يمنع double enqueue لنفس mid
          }
        );
      }
    }
  } catch (err) {
    console.error("❌ Webhook POST error:", err?.message || err);
  }
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Webhook server running on port", PORT);
});

// =======================
// Graceful shutdown
// =======================
async function shutdown(signal) {
  console.log(`🛑 Received ${signal}. Shutting down...`);

  try {
    await queue?.close();
  } catch {}

  try {
    await connection?.quit();
  } catch {}

  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
