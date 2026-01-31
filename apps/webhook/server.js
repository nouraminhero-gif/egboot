// apps/webhook/server.js

import "dotenv/config";
import express from "express";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 8080;

// ================= Redis / Queue =================
const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL;

if (!REDIS_URL) {
  console.warn("⚠️ REDIS_URL missing. Webhook will NOT enqueue jobs.");
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
        removeOnComplete: 1000,
        removeOnFail: 2000,
      },
    })
  : null;

// ================= Routes =================

// healthcheck
app.get("/health", (req, res) => res.status(200).send("OK"));

// root
app.get("/", (req, res) =>
  res.status(200).send("Egboot webhook running ✅")
);

// verify webhook
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (!process.env.VERIFY_TOKEN) {
    console.error("❌ VERIFY_TOKEN missing");
    return res.sendStatus(500);
  }

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// receive messages
app.post("/webhook", async (req, res) => {
  // Facebook لازم ياخد رد فورًا
  res.sendStatus(200);

  try {
    if (!queue) return;

    const body = req.body;
    if (!body || body.object !== "page") return;

    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        const psid = event?.sender?.id;
        if (!psid) continue;

        // تجاهل echo
        if (event?.message?.is_echo) continue;

        const text = event?.message?.text;
        const payload = event?.postback?.payload;

        if (!text && !payload) continue;

        const mid = event?.message?.mid;

        // ❌ ممنوع :
        const jobId = mid ? `mid_${mid}` : undefined;

        await queue.add(
          "incoming_message",
          {
            event,
            receivedAt: Date.now(),
          },
          {
            jobId,
          }
        );
      }
    }
  } catch (err) {
    console.error("❌ Webhook POST error:", err?.message || err);
  }
});

// ================= Server =================
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Webhook server running on port", PORT);
});

// graceful shutdown
async function shutdown(signal) {
  console.log(`🛑 ${signal} received. Shutting down...`);
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
