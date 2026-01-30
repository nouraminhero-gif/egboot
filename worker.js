// worker.js
import express from "express";
import { startWorker } from "./queue.js";

const app = express();

// لازم Railway يشوف Port شغال
const PORT = process.env.PORT || 8080;

// Health endpoints
app.get("/", (req, res) => res.status(200).send("WORKER OK ✅"));
app.get("/health", (req, res) => res.status(200).json({ ok: true, worker: true }));

app.listen(PORT, "0.0.0.0", async () => {
  console.log(`🧠 Worker HTTP running on port ${PORT}`);
  try {
    await startWorker({ pageAccessToken: process.env.PAGE_ACCESS_TOKEN || "" });
    console.log("✅ Worker started");
  } catch (e) {
    console.error("❌ Worker start failed:", e?.message || e);
    process.exit(1);
  }
});
