// apps/webhook/server.js

import "dotenv/config";
import express from "express";

import { fbSendText, fbTyping } from "./fb.js";

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 8080;

// ✅ Healthcheck
app.get("/health", (req, res) => res.status(200).send("OK"));

// ✅ Root (اختياري)
app.get("/", (req, res) => res.status(200).send("Egboot webhook running ✅"));

// ✅ Verify webhook
app.get("/webhook", (req, res) => {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
  } catch (err) {
    console.error("Webhook verify error:", err);
    return res.sendStatus(500);
  }
});

// ✅ Receive messages
app.post("/webhook", async (req, res) => {
  // Facebook لازم ياخد 200 بسرعة
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body.object !== "page") return;

    const token = process.env.PAGE_ACCESS_TOKEN;
    if (!token) {
      console.error("Missing PAGE_ACCESS_TOKEN in env vars");
      return;
    }

    const entries = body.entry || [];

    for (const entry of entries) {
      const messagingEvents = entry.messaging || [];

      for (const event of messagingEvents) {
        const psid = event?.sender?.id;

        // تجاهل أي حدث بدون sender
        if (!psid) continue;

        // ✅ رسالة نصية
        const text = event?.message?.text;

        // ✅ Postback (زرار)
        const postbackPayload = event?.postback?.payload;

        // تجاهل Echo بتاع الصفحة نفسها
        if (event?.message?.is_echo) continue;

        // لو مفيش نص ولا postback، تجاهل
        if (!text && !postbackPayload) continue;

        // typing on
        await fbTyping(token, psid, true);

        // ✅ رد تجريبي (غيره براحتك)
        let reply = "";

        if (text) {
          reply = `وصلتني رسالتك: "${text}" ✅`;
        } else if (postbackPayload) {
          reply = `Postback: ${postbackPayload} ✅`;
        }

        await fbSendText(token, psid, reply);

        // typing off
        await fbTyping(token, psid, false);
      }
    }
  } catch (err) {
    console.error("Webhook POST error:", err);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Webhook server running on port", PORT);
});
