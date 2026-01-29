// server.js (ES Modules)
import express from "express";
import axios from "axios";
import "dotenv/config";
import { askAI } from "./ai.js";

const app = express();

// Facebook sends JSON
app.use(express.json());

// ====== ENV ======
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

if (!PAGE_ACCESS_TOKEN) {
  console.warn("⚠️ Missing PAGE_ACCESS_TOKEN in environment variables.");
}
if (!VERIFY_TOKEN) {
  console.warn("⚠️ Missing VERIFY_TOKEN in environment variables.");
}

// ====== HELPERS ======
async function sendTextMessage(psid, text) {
  if (!PAGE_ACCESS_TOKEN) {
    console.error("❌ Cannot send message: PAGE_ACCESS_TOKEN is missing.");
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
    const fbErr = err?.response?.data;
    console.error("❌ Facebook Send API error:", fbErr || err.message);
  }
}

// ====== ROUTES ======

// Verification (GET)
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

// Receive messages (POST)
app.post("/webhook", (req, res) => {
  // ✅ القاعدة الذهبية: رد فوري قبل أي معالجة
  res.status(200).send("EVENT_RECEIVED");

  const body =
