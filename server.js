import "dotenv/config";
import express from "express";
import { enqueueIncomingMessage, startWorker } from "./queue.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// Health
app.get("/", (req, res) => res.status(200).send("✅ Egboot Messenger Bot running"));

// Webhook verify (Facebook)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Webhook receive (Facebook)
app.post("/webhook", (req, res) => {
  // ✅ الرد الفوري قبل أي معالجة
  res.status(200).send("EVENT_RECEIVED");

  const body = req.body;
  if (body.object !== "page") return;

  for (const entry of body.entry || []) {
    for (const event of entry.messaging || []) {
      // تجاهل echo
      if (event?.message?.is_echo) continue;

      const psid = event.sender?.id;
      const text = event?.message?.text?.trim();
      if (!psid || !text) continue;

      const mid = event?.message?.mid || null;
      const timestamp = event?.timestamp || Date.now();

      // حط الرسالة في Queue
      enqueueIncomingMessage({ psid, text, mid, timestamp }).catch((e) => {
        console.error("Enqueue error:", e?.message);
      });
    }
  }
});

// Start worker once
startWorker();

app.listen(PORT, () => console.log("🚀 Server running on", PORT)); 
