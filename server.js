// server.js
import express from "express";
import bodyParser from "body-parser";
import crypto from "crypto";

import { enqueueIncomingMessage, startWorker } from "./queue.js";

const app = express();
const PORT = process.env.PORT || 8080;

// لازم Raw Body عشان verify بتاع Meta
app.use(
  bodyParser.json({
    verify: (req, res, buf) => {
      req.rawBody = buf?.toString("utf8") || "";
    },
  })
);

// ====== ENV ======
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";
const APP_SECRET = process.env.APP_SECRET || ""; // اختياري لو هتعمل signature verify
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || "/webhook";

// ====== Helpers ======
function timingSafeEquals(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// تحقق اختياري لتوقيع Meta (X-Hub-Signature-256)
function verifyMetaSignature(req) {
  if (!APP_SECRET) return true; // لو مش حاطط APP_SECRET، بنعدّي
  const signature = req.get("x-hub-signature-256");
  if (!signature) return false;

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", APP_SECRET).update(req.rawBody || "").digest("hex");

  return timingSafeEquals(signature, expected);
}

// ====== Health ======
app.get("/", (req, res) => {
  res.status(200).send("✅ egboot is running");
});

// ====== Webhook Verify (GET) ======
app.get(WEBHOOK_PATH, (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ====== Webhook Receive (POST) ======
app.post(WEBHOOK_PATH, async (req, res) => {
  try {
    // Signature verify (اختياري)
    if (!verifyMetaSignature(req)) {
      return res.sendStatus(403);
    }

    const body = req.body;

    // Meta بيبعت object = "page" في رسائل فيسبوك
    if (body?.object !== "page") {
      return res.sendStatus(404);
    }

    // ✅ لازم نرد بسرعة 200 عشان Meta ما تعيدش الإرسال
    res.sendStatus(200);

    // بعد الرد، نعالج في الخلفية (enqueue)
    const entries = body.entry || [];
    for (const entry of entries) {
      const messaging = entry.messaging || [];
      for (const event of messaging) {
        // event ممكن يبقى message أو postback
        await enqueueIncomingMessage({
          entryId: entry.id,
          time: entry.time,
          event,
        });
      }
    }
  } catch (err) {
    // لو حصل خطأ قبل ما نرد 200
    try {
      res.sendStatus(500);
    } catch {}
    console.error("Webhook error:", err?.message || err);
  }
});

// ====== Start Worker + Server ======
(async () => {
  try {
    console.log("🔧 Starting worker...");
    await startWorker({
      pageAccessToken: PAGE_ACCESS_TOKEN,
    });

    app.listen(PORT, () => {
      console.log(`🚀 Server running on ${PORT}`);
      console.log(`🔗 Webhook path: ${WEBHOOK_PATH}`);
      console.log(`🔐 VERIFY_TOKEN exists? ${!!VERIFY_TOKEN}`);
      console.log(`🔑 PAGE_ACCESS_TOKEN exists? ${!!PAGE_ACCESS_TOKEN}`);
      console.log(`🧩 APP_SECRET exists? ${!!APP_SECRET}`);
    });
  } catch (err) {
    // مهم: ما تقفلش السيرفر بسبب Redis أو Worker failures
    // خلي Railway ما يعملش Crash loop
    console.error("⚠️ Failed to start worker:", err?.message || err);

    // شغّل السيرفر حتى لو الووركر فشل (مهم لتجنب restart loops)
    app.listen(PORT, () => {
      console.log(`🚀 Server running on ${PORT} (worker failed to start)`);
      console.log(`🔗 Webhook path: ${WEBHOOK_PATH}`);
    });
  }
})();
