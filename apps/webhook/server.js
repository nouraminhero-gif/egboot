// apps/webhook/server.js

import "dotenv/config";
import express from "express";

import { fbSendText, fbTyping } from "./fb.js";

const app = express();

// ✅ Body parsers
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 8080;

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
      console.error("Missing VERIFY_TOKEN in env vars");
      return res.sendStatus(500);
    }

    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
  } catch (err) {
    console.error("Webhook verify error:", err);
    return res.sendStatus(500);
  }
});

// ✅ Receive messages (Facebook لازم ياخد 200 بسرعة)
app.post("/webhook", async (req, res) => {
  // رد سريع لفيسبوك
  res.sendStatus(200);

  const token = process.env.PAGE_ACCESS_TOKEN;
  if (!token) {
    console.error("Missing PAGE_ACCESS_TOKEN in env vars");
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

        // ✅ typing on
        await fbTyping(token, psid, true);

        try {
          // ✅ رد تجريبي
          let reply = "";

          if (text) {
            reply = `وصلتني رسالتك: "${text}" ✅`;
          } else if (postbackPayload) {
            reply = `Postback: ${postbackPayload} ✅`;
          }

          await fbSendText(token, psid, reply);
        } finally {
          // ✅ typing off حتى لو حصل error
          await fbTyping(token, psid, false);
        }
      }
    }
  } catch (err) {
    console.error("Webhook POST error:", err?.response?.data || err?.message || err);
  }
});

// ✅ Start server
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Webhook server running on port", PORT);
});

// ✅ مهم جدًا على Railway: التعامل مع SIGTERM (بيحصل عند redeploy)
function shutdown(signal) {
  console.log(`🛑 Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    console.log("✅ Server closed.");
    process.exit(0);
  });

  // لو قفل اتأخر قوي
  setTimeout(() => {
    console.log("⏳ Force exiting...");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
