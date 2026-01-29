// server.js
import express from "express";
import { enqueueIncomingMessage, startWorker } from "./queue.js";

const app = express();
app.use(express.json());

// ================== ENV ==================
const PORT = process.env.PORT || 8080;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";

// ================== Safety (prevents crash loops) ==================
process.on("unhandledRejection", (reason) => {
  console.error("❌ UNHANDLED_REJECTION:", reason?.message || reason);
});

process.on("uncaughtException", (err) => {
  console.error("❌ UNCAUGHT_EXCEPTION:", err?.message || err);
});

// ================== Health ==================
app.get("/", (req, res) => res.status(200).send("OK ✅"));
app.get("/health", (req, res) => res.status(200).json({ ok: true }));

// ================== Facebook Webhook Verify (GET) ==================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified");
    return res.status(200).send(challenge);
  }

  console.warn("❌ Webhook verify failed");
  return res.sendStatus(403);
});

// ================== Facebook Webhook Events (POST) ==================
app.post("/webhook", (req, res) => {
  // لازم نرد 200 بسرعة عشان FB ما يعيدش الارسال
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body?.object !== "page") return;

    const entries = body.entry || [];
    for (const entry of entries) {
      const events = entry.messaging || [];
      for (const event of events) {
        enqueueIncomingMessage({ event }).catch((err) => {
          console.error("❌ enqueue failed:", err?.message || err);
        });
      }
    }
  } catch (err) {
    console.error("❌ webhook post error:", err?.message || err);
  }
});

// ================== Worker Safe Start ==================
let workerStarted = false;

async function safeStartWorker() {
  if (workerStarted) return;
  workerStarted = true;

  const retryMs = 5000;

  const boot = async () => {
    try {
      console.log("🧠 Worker starting...");
      await startWorker({ pageAccessToken: PAGE_ACCESS_TOKEN });
      console.log("✅ Worker started");
    } catch (err) {
      console.error("❌ Worker crashed:", err?.message || err);
      console.log(`🔁 Restarting worker in ${retryMs / 1000}s...`);
      setTimeout(boot, retryMs);
    }
  };

  boot();
}

// ================== Graceful shutdown ==================
function shutdown(signal) {
  console.log(`🛑 ${signal} received. Shutting down...`);
  // لو عندك close للـ redis أو حاجة في queue.js ابعتها هنا
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ================== Start Server ==================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);

  if (!VERIFY_TOKEN) console.warn("⚠️ VERIFY_TOKEN is missing");
  if (!PAGE_ACCESS_TOKEN) console.warn("⚠️ PAGE_ACCESS_TOKEN is missing");

  // ✅ Start worker safely (won't kill server)
  safeStartWorker();
});
