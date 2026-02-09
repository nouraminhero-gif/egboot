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
  console.error("❌ REDIS_URL missing (set REDIS_URL or REDIS_PUBLIC_URL)");
  process.exit(1);
}

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

connection.on("connect", () => console.log("🔌 Redis connected (webhook)"));
connection.on("ready", () => console.log("✅ Redis ready (webhook)"));
connection.on("error", (e) =>
  console.error("❌ Redis error (webhook):", e?.message || e)
);

// ✅ مهم: نخلي Redis متاح جوّه auth-facebook.js
app.locals.redis = connection;

// ================= Queue =================
const queue = new Queue("messages", {
  connection,
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

// ✅ Facebook OAuth Routes
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
  // ✅ لازم نرد بسرعة لفيسبوك
  res.sendStatus(200);

  const body = req.body;
  if (body?.object !== "page") return;

  for (const entry of body.entry || []) {
    for (const event of entry.messaging || []) {
      if (event?.message?.is_echo) continue;

      const senderId = event?.sender?.id;
      const text = event?.message?.text;
      const mid = event?.message?.mid;
      const pageId = event?.recipient?.id; // ✅ ده Page ID اللي الرسالة جات عليه

      if (!senderId || !text) continue;

      await queue.add(
        "incoming_message",
        {
          botId: process.env.BOT_ID || "clothes",
          pageId,       // ✅ مهم للـ SaaS (نعرف البوت تبع مين)
          senderId,
          text,
          mid,
        },
        {
          jobId: mid ? `mid_${mid}` : undefined,
        }
      );
    }
  }
});

// ================= Start =================
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Webhook running on port", PORT);
});

// ================= Shutdown =================
async function shutdown(signal) {
  console.log(`🛑 ${signal} received`);
  try { await queue.close(); } catch {}
  try { await connection.quit(); } catch {
    try { connection.disconnect(); } catch {}
  }
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
