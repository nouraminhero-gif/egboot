// apps/webhook/server.js

import "dotenv/config";
import express from "express";
import { fbSendText, fbTyping } from "./fb.js";

const app = express();

// ✅ Body parsers
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 8080;

// --- simple logger ---
const log = (...args) => console.log(new Date().toISOString(), ...args);

// ✅ Healthcheck (Railway بيستخدمه)
app.get("/health", (req, res) => res.status(200).send("OK"));

// ✅ Root (علشان لما تفتح الدومين ما يطلعش Cannot GET /)
app.get("/", (req, res) => res.status(200).send("Egboot webhook running ✅"));

// ✅ Verify webhook (Facebook verification)
app.get("/webhook", (req, res) => {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (!process.env.VERIFY_TOKEN) {
      log("❌ Missing VERIFY_TOKEN in env vars");
      return res.sendStatus(500);
    }

    // لازم challenge موجود علشان verification
    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN && challenge) {
      log("✅ Webhook verified");
      return res.status(200).send(challenge);
    }

    log("❌ Webhook verify failed");
    return res.sendStatus(403);
  } catch (err) {
    log("❌ Webhook verify error:", err?.message || err);
    return res.sendStatus(500);
  }
});

// ✅ Receive messages (Facebook لازم ياخد 200 بسرعة)
app.post("/webhook", async (req, res) => {
  // رد سريع لفيسبوك
  res.sendStatus(200);

  const pageToken = process.env.PAGE_ACCESS_TOKEN;
  if (!pageToken) {
    log("❌ Missing PAGE_ACCESS_TOKEN in env vars");
    return;
  }

  try {
    const body = req.body;

    // لازم يكون page
    if (!body || body.object !== "page") return;

    const entries = Array.isArray(body.entry) ? body.entry : [];

    for (const entry of entries) {
      const messagingEvents = Array.isArray(entry.messaging) ? entry.messaging : [];

      for (const event of messagingEvents) {
        const psid = event?.sender?.id;
        if (!psid) continue;

        // تجاهل Echo بتاع الصفحة نفسها
        if (event?.message?.is_echo) continue;

        const text = event?.message?.text?.trim();
        const postbackPayload = event?.postback?.payload;

        // لو مفيش حاجة مفهومة تجاهل
        if (!text && !postbackPayload) continue;

        // ✅ typing on (مش مشكلة لو فشل)
        await fbTyping(pageToken, psid, true);

        try {
          let reply = "";

          if (text) {
            reply = `وصلتني رسالتك: "${text}" ✅`;
          } else {
            reply = `Postback: ${postbackPayload} ✅`;
          }

          // لو reply فاضي لأي سبب، تجاهل
          if (!reply) continue;

          await fbSendText(pageToken, psid, reply);
        } catch (err) {
          log("❌ Send reply error:", err?.response?.data || err?.message || err);
        } finally {
          // ✅ typing off حتى لو حصل error
          await fbTyping(pageToken, psid, false);
        }
      }
    }
  } catch (err) {
    log("❌ Webhook POST error:", err?.response?.data || err?.message || err);
  }
});

// ✅ 404 لأي route غلط (اختياري)
app.use((req, res) => res.status(404).send("Not Found"));

// ✅ Start server
const server = app.listen(PORT, "0.0.0.0", () => {
  log("🚀 Webhook server running on port", PORT);
});

// ✅ مهم جدًا على Railway: التعامل مع SIGTERM (بيحصل عند redeploy)
function shutdown(signal) {
  log(`🛑 Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    log("✅ Server closed.");
    process.exit(0);
  });

  // لو قفل اتأخر قوي
  setTimeout(() => {
    log("⏳ Force exiting...");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
