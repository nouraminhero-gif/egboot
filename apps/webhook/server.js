// apps/webhook/server.js
import "dotenv/config";
import express from "express";
import { Queue } from "bullmq";
import IORedis from "ioredis";

// ✅ Facebook OAuth
import { registerFacebookAuthRoutes } from "./auth-facebook.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 8080;

// ================= Redis =================
const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL;

if (!REDIS_URL) {
  console.error("❌ REDIS_URL missing");
  process.exit(1);
}

const redis = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redis.on("connect", () => console.log("🔌 Redis connected (webhook)"));
redis.on("ready", () => console.log("✅ Redis ready (webhook)"));
redis.on("error", (e) =>
  console.error("❌ Redis error (webhook):", e?.message || e)
);

// نخلي Redis متاح لباقي الملفات (auth-facebook.js)
app.locals.redis = redis;

// ================= Queue =================
const queue = new Queue("messages", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 500,
    removeOnFail: 500,
  },
});

// ================= Routes =================
app.get("/", (req, res) => res.send("Egboot webhook running ✅"));
app.get("/health", (req, res) => res.send("OK"));

// ✅ Facebook OAuth Routes:
// /connect?email=someone@gmail.com
// /auth/facebook/callback
registerFacebookAuthRoutes(app);

// ================= Webhook Verify =================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ================= Webhook Receive =================
app.post("/webhook", async (req, res) => {
  // لازم نرد بسرعة
  res.sendStatus(200);

  const body = req.body;
  if (body?.object !== "page") return;

  for (const entry of body.entry || []) {
    const pageId = entry?.id || null;

    for (const event of entry.messaging || []) {
      if (event?.message?.is_echo) continue;

      const senderId = event?.sender?.id || null;
      const text = event?.message?.text || null;
      const mid = event?.message?.mid || null;

      if (!senderId || !text) continue;

      // ✅ نحدد tenant/botId عن طريق صاحب الصفحة
      // auth-facebook.js بيحط: page:<pageId>:owner_email = email
      let botId = process.env.BOT_ID || "clothes";

      try {
        if (pageId) {
          const ownerEmail = await redis.get(`page:${pageId}:owner_email`);
          if (ownerEmail) botId = ownerEmail; // نخليه botId = email (Multi-tenant)
        }

        await queue.add(
          "incoming_message",
          {
            botId,
            pageId,          // ✅ مهم
            senderId,
            text,
            mid,
            event,           // optional raw event
          },
          {
            jobId: mid ? `mid_${mid}` : undefined,
          }
        );
      } catch (err) {
        console.error("❌ Queue add error:", err?.message || err);
      }
    }
  }
});

// ================= Start =================
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Webhook running on port ${PORT}`);
});

// ================= Graceful Shutdown =================
async function shutdown(signal) {
  console.log(`🛑 ${signal} received`);

  try { await queue.close(); } catch {}
  try { await redis.quit(); }
  catch { try { redis.disconnect(); } catch {} }

  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
