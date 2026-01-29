import express from "express";
import axios from "axios";
import "dotenv/config";
import { askAI } from "./ai.js";

const app = express();
app.use(express.json());

// ================= ENV =================
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// ================= Deduplication (منع التكرار) =================
// بنخزن message ids اللي اتعالجت (mid) عشان لو فيسبوك كرر نفس الحدث مانردش تاني
const processedMessages = new Set();

// تنظيف دوري للكاش عشان مايكبرش
setInterval(() => {
  processedMessages.clear();
}, 5 * 60 * 1000); // كل 5 دقايق

// ================= HELPERS =================
async function sendTextMessage(psid, text) {
  if (!PAGE_ACCESS_TOKEN) {
    console.error("❌ PAGE_ACCESS_TOKEN missing");
    return;
  }

  try {
    await axios.post(
      "https://graph.facebook.com/v19.0/me/messages",
      {
        recipient: { id: psid },
        message: { text },
      },
      {
        params: { access_token: PAGE_ACCESS_TOKEN },
        timeout: 8000,
      }
    );
  } catch (err) {
    console.error(
      "❌ Facebook Send API error:",
      err?.response?.data || err.message
    );
  }
}

// ================= ROUTES =================

// Verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified");
    return res.status(200).send(challenge);
  }

  console.log("❌ Webhook verification failed");
  return res.sendStatus(403);
});

// Webhook receiver
app.post("/webhook", (req, res) => {
  // ✅ القاعدة الذهبية: رد فوري قبل أي معالجة
  res.status(200).send("EVENT_RECEIVED");

  const body = req.body;
  if (body.object !== "page") return;

  try {
    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        if (!senderId) continue;

        // تجاهل رسائل الصفحة نفسها
        if (event.message?.is_echo) continue;

        // ====== Deduplication ======
        const mid = event.message?.mid;
        if (mid) {
          if (processedMessages.has(mid)) {
            // نفس الرسالة اتبعتت تاني من فيسبوك → تجاهل
            continue;
          }
          processedMessages.add(mid);
        }

        const userText = event.message?.text?.trim();

        if (!userText) {
          // لو المستخدم بعت attachment أو حاجة غير نص
          sendTextMessage(senderId, "ابعتلي سؤالك كتابة كده يا بطل 😄");
          continue;
        }

        // Async processing (بعد الرد الفوري)
        (async () => {
          try {
            const reply = await askAI(userText);

            await sendTextMessage(
              senderId,
              reply?.trim() || "ثواني براجع السيستم 🤍"
            );
          } catch (err) {
            console.error("❌ AI error:", err?.message || err);

            // ✅ Graceful fallback
            await sendTextMessage(senderId, "ثواني براجع السيستم 🤍");
          }
        })();
      }
    }
  } catch (err) {
    console.error("❌ Webhook handling error:", err?.message || err);
  }
});

// Health check
app.get("/", (req, res) => {
  res.status(200).send("✅ Egboot bot is running");
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});
