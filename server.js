import express from "express";
import axios from "axios";
import "dotenv/config";
import { askAI } from "./ai.js";

const app = express();
app.use(express.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// ===== helper =====
async function sendTextMessage(psid, text) {
  if (!PAGE_ACCESS_TOKEN) return;

  try {
    await axios.post(
      "https://graph.facebook.com/v19.0/me/messages",
      {
        recipient: { id: psid },
        message: { text },
      },
      {
        params: { access_token: PAGE_ACCESS_TOKEN },
      }
    );
  } catch (err) {
    console.error(err?.response?.data || err.message);
  }
}

// ===== verify =====
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// ===== webhook =====
app.post("/webhook", (req, res) => {
  res.status(200).send("EVENT_RECEIVED");

  const body = req.body;
  if (body.object !== "page") return;

  for (const entry of body.entry || []) {
    for (const event of entry.messaging || []) {
      if (!event.sender?.id) continue;
      if (event.message?.is_echo) continue;

      const text = event.message?.text;
      if (!text) continue;

      (async () => {
        try {
          const reply = await askAI(text);
          await sendTextMessage(
            event.sender.id,
            reply || "ثواني براجع السيستم 🤍"
          );
        } catch {
          await sendTextMessage(
            event.sender.id,
            "ثواني براجع السيستم 🤍"
          );
        }
      })();
    }
  }
});

// ===== health =====
app.get("/", (req, res) => {
  res.send("Egboot running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on", PORT);
});
