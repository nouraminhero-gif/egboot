import dotenv from "dotenv";
import { Worker } from "bullmq";
import IORedis from "ioredis";

dotenv.config();

const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

console.log("🟡 Worker booting...");

const worker = new Worker(
  "messages",
  async (job) => {
    console.log("📨 Job received:", job.data);

    // هنا شغلك الحقيقي
    await new Promise((res) => setTimeout(res, 1000));

    console.log("✅ Job done");
  },
  { connection }
);

worker.on("ready", () => {
  console.log("🟢 Worker ready");
});

worker.on("failed", (job, err) => {
  console.error("❌ Job failed", err);
});

// Graceful shutdown
const shutdown = async () => {
  console.log("🛑 SIGTERM received, stopping worker...");
  await worker.close();
  await connection.quit();
  console.log("✅ Worker stopped");
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
