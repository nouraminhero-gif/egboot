// apps/webhook/server.js

require("dotenv").config();
const express = require("express");

const app = express();

// مهم: خلي حجم البودي كويس عشان رسائل فيسبوك ممكن تبقى كبيرة
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 8080;

/**
 * ✅ Healthcheck endpoint
 * Railway هينادي عليه لو انت حاطط Healthcheck Path = /health
 */
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

/**
 * ✅ Root endpoint (اختياري بس مفيد للتجربة)
 */
app.get("/", (req, res) => {
  res.status(200).send("Egboot is running ✅");
});

/**
 * ✅ Facebook Messenger Webhook Verification
 * GET /webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
 */
app.get("/webhook", (req, res) => {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
      // لازم يرجّع الـ challenge زي ما هو
      return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
  } catch (err) {
    console.error("Webhook verify error:", err);
    return res.sendStatus(500);
  }
});

/**
 * ✅ Receive messages
 * POST /webhook
 */
app.post("/webhook", async (req, res) => {
  // Facebook لازم ياخد 200 بسرعة وإلا هيعيد الإرسال
  res.sendStatus(200);

  try {
    const body = req.body;

    // تأكد ده event من صفحة فيسبوك
    if (body.object !== "page") {
      console.log("Received non-page webhook:", body.object);
      return;
    }

    // هنا تقدر تبعت للـ worker أو تعالج الرسالة
    // الأفضل: تدفع الرسالة للـ Queue (BullMQ/Redis) بدل ما تعالجها هنا
    // عشان الـ webhook يبقى سريع وثابت

    const entries = body.entry || [];
    for (const entry of entries) {
      const messagingEvents = entry.messaging || [];

      for (const event of messagingEvents) {
        // event.sender.id => PSID
        // event.message.text => text
        // event.postback => postback

        console.log("📩 Incoming event:", JSON.stringify(event));

        // لو عندك function في worker/queue بتحط الشغل في Redis:
        // مثال:
        // await enqueueMessage(event);

        // أو لو عندك fb.js فيه handler جاهز:
        // const { handleWebhookEvent } = require("./fb");
        // await handleWebhookEvent(event);
      }
    }
  } catch (err) {
    console.error("Webhook POST error:", err);
  }
});

/**
 * ✅ مهم جدًا:
 * - مفيش process.on('SIGTERM') هنا
 * - مفيش server.close()
 * - مفيش process.exit()
 * عشان Railway ساعات يبعت SIGTERM مع deploy/scale/health checks
 */

app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Server running on port", PORT);
});
