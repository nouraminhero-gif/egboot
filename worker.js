// worker.js
import "dotenv/config";
import { startWorker } from "./queue.js";

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

if (!PAGE_ACCESS_TOKEN) {
  console.error("❌ PAGE_ACCESS_TOKEN missing");
  process.exit(1);
}

console.log("👷 Worker booting...");

await startWorker({
  pageAccessToken: PAGE_ACCESS_TOKEN,
});

// مهم جدًا: مفيش express
// مفيش app.listen
// مفيش PORT
// مفيش server
