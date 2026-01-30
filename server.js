// server.js
import express from "express";

const app = express();
app.use(express.json());

// ================== ENV ==================
const PORT = process.env.PORT || 8080;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "";

// ================== Safety ==================
process.on("unhandledRejection", (reason) => {
  console.error("❌ UNHANDLED_REJECTION:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("❌ UNCAUGHT_EXCEPTION:", err);
});

// ================== Health ==================
app.get("/", (req, res) => {
  res.status(200).send("OK");
});

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

// ================== Facebook Webhook Verify ==================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified");
    return res.status(200).send(challenge);
  }

  console.warn("❌ Webhook verify failed");
  return res.sendStatus(403);
});

// ================== Facebook Webhook Events ==================
app.post("/webhook", async (req, res) => {
  // لازم نرد 200 فورًا
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body?.object !== "page") return;

    // Import هنا عشان نتأكد إن السيرفر مايعتمدش على worker
    const { enqueueIncomingMessage } = await import("./queue.js");

    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        enqueueIncomingMessage({ event }).catch((err) => {
          console.error("❌ enqueue failed:", err);
        });
      }
    }
  } catch (err) {
    console.error("❌ webhook error:", err);
  }
});

// ================== Start Server ==================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);

  if (!VERIFY_TOKEN) {
    console.warn("⚠️ VERIFY_TOKEN is missing");
  }
});
