// apps/webhook/server.js
import "dotenv/config";
import express from "express";
import { enqueueMessage, closeQueueAndRedis } from "./queue.js";

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 8080;

// ✅ Healthcheck
app.get("/health", (req, res) => res.status(200).send("OK"));
app.get("/", (req, res) => res.status(200).send("Egboot webhook running ✅"));

// ✅ Verify webhook
app.get("/webhook", (req, res) => {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (!process.env.VERIFY_TOKEN) {
      console.error("❌ Missing VERIFY_TOKEN in env vars");
      return res.sendStatus(500);
    }

    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
      console.log("✅ Webhook verified");
      return res.status(200).send(challenge);
    }

    console.warn("❌ Webhook verify failed");
    return res.sendStatus(403);
  } catch (err) {
    console.error("Webhook verify error:", err?.message || err);
    return res.sendStatus(500);
  }
});

// ✅ Receive events -> enqueue to BullMQ
app.post("/webhook", (req, res) => {
  // ✅ مهم جدًا: رد سريع لفيسبوك
  res.sendStatus(200);

  try {
    const body = req.body;
    if (!body || body.object !== "page") return;

    const entries = Array.isArray(body.entry) ? body.entry : [];
    for (const entry of entries) {
      const messagingEvents = Array.isArray(entry.messaging) ? entry.messaging : [];

      for (const event of messagingEvents) {
        // تجاهل echo/read/delivery
        if (event?.message?.is_echo) continue;
        if (event?.read || event?.delivery) continue;

        // لازم sender id
        const psid = event?.sender?.id;
        if (!psid) continue;

        // ✅ enqueue (بدون await عشان مايبطّأش)
        enqueueMessage(event).catch((e) => {
          console.error("❌ enqueueMessage failed:", e?.message || e);
        });
      }
    }
  } catch (err) {
    console.error("Webhook POST error:", err?.message || err);
  }
});

// ✅ Safety logs
process.on("unhandledRejection", (reason) => {
  console.error("💥 unhandledRejection:", reason?.message || reason);
});
process.on("uncaughtException", (err) => {
  console.error("💥 uncaughtException:", err?.message || err);
});

// ✅ Start
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Webhook server running on port", PORT);

  if (!process.env.VERIFY_TOKEN) console.warn("⚠️ VERIFY_TOKEN is missing");
  if (!process.env.REDIS_URL && !process.env.REDIS_PUBLIC_URL) console.warn("⚠️ REDIS_URL is missing");
});

// ✅ Graceful shutdown
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`🛑 ${signal} received. Shutting down webhook...`);

  server.close(async () => {
    try {
      await closeQueueAndRedis();
    } catch (e) {
      console.warn("⚠️ closeQueueAndRedis error:", e?.message || e);
    }
    console.log("✅ Webhook stopped");
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
