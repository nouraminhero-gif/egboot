// worker.js
import "dotenv/config";
import { startWorker } from "./queue.js";

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";

process.on("unhandledRejection", (reason) => {
  console.error("❌ UNHANDLED_REJECTION:", reason?.message || reason);
});
process.on("uncaughtException", (err) => {
  console.error("❌ UNCAUGHT_EXCEPTION:", err?.message || err);
});

async function main() {
  if (!PAGE_ACCESS_TOKEN) {
    console.warn("⚠️ PAGE_ACCESS_TOKEN is missing (worker will still run but can't reply).");
  }

  console.log("🧠 Worker booting...");
  await startWorker({ pageAccessToken: PAGE_ACCESS_TOKEN });

  // مهم: ما تعملش exit — سيبه شغال
  console.log("✅ Worker is running");
}

main().catch((e) => {
  console.error("❌ Worker failed to start:", e?.message || e);
  process.exit(1);
});
