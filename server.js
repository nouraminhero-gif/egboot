// server.js
import express from "express";
import axios from "axios";
import "dotenv/config";
import { askAI } from "./ai.js";

const app = express();
app.use(express.json());

// ================= ENV =================
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

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
  const
