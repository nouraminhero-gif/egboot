// worker.js
import "dotenv/config";
import { startWorker } from "./queue.js";

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";

console.log("🧠 Worker booting...");

if (!PAGE_ACCESS_TOKEN) {
  console.warn("⚠️ PAGE_ACCESS_TOKEN is missing");
}

// شغّل الـ worker فقط (من غير express / listen / port)
await startWorker({ pageAccessToken: PAGE_ACCESS_TOKEN });

// خليه عايش
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received. Worker shutting down...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("🛑 SIGINT received. Worker shutting down...");
  process.exit(0);
});
