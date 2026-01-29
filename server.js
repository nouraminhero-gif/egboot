import express from "express";
import bodyParser from "body-parser";

import { enqueueIncomingMessage, startWorker } from "./queue.js";

const app = express();
app.use(bodyParser.json());

/* =========================
   Health Check
========================= */
app.get("/", (req, res) => {
  res.status(200).json({ ok: true, service: "egboot" });
});

/* =========================
   Webhook Example (Messenger)
   - enqueue payload to Redis
========================= */
app.post("/webhook", async (req, res) => {
  try {
    await enqueueIncomingMessage(req.body);
    return res.sendStatus(200);
  } catch (e) {
    console.error("❌ Webhook error:", e.message);
    return res.sendStatus(500);
  }
});

/* =========================
   Worker Handler
   - هنا بتحط منطق معالجة الرسائل
========================= */
async function handleJob(job) {
  // مثال بسيط:
  console.log("📩 Job received:", JSON.stringify(job).slice(0, 500));

  // TODO: call your bot logic here
  // مثال:
  // await processIncomingMessage(job);
}

/* =========================
   Start Worker + Server
========================= */
startWorker(handleJob);

const PORT = process.env.PORT || 8080;

console.log("REDIS_PUBLIC_URL exists?", !!process.env.REDIS_PUBLIC_URL);

app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});
