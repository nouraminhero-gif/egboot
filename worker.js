// worker.js
import dotenv from "dotenv";
import { startWorker, stopWorker, closeRedis } from "./queue.js";

dotenv.config();

process.on("unhandledRejection", (reason) => {
  console.error("❌ UNHANDLED_REJECTION:", reason?.message || reason);
});

process.on("uncaughtException", (err) => {
  console.error("❌ UNCAUGHT_EXCEPTION:", err?.message || err);
});

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";

async function main() {
  console.log("🧠 Worker booting...");
  await startWorker({ pageAccessToken: PAGE_ACCESS_TOKEN });
  console.log("✅ Worker is running");
}

async function shutdown(signal) {
  console.log(`🛑 ${signal} received. Stopping worker...`);
  await stopWorker();
  await closeRedis();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

main().catch((e) => {
  console.error("❌ Worker failed to start:", e?.message || e);
  process.exit(1);
});
