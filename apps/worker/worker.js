// worker.js
import dotenv from "dotenv";
import { Worker } from "bullmq";
import IORedis from "ioredis";

import { salesReply } from "./apps/worker/sales.js";

dotenv.config();

const REDIS_URL = process.env.REDIS_URL;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

if (!REDIS_URL) throw new Error("Missing REDIS_URL");
if (!PAGE_ACCESS_TOKEN) throw new Error("Missing PAGE_ACCESS_TOKEN");

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

/**
 * Queue name should match your producer (webhook server)
 * لو اسم الـ queue عندك مختلف غيره هنا
 */
const QUEUE_NAME = process.env.QUEUE_NAME || "egboot";

/**
 * Job shape expected:
 * {
 *   botId: "clothes",
 *   senderId: "PSID",
 *   text: "message text",
 *   mid: "message id"
 * }
 */
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { botId = "clothes", senderId, text, mid } = job.data || {};
    if (!senderId || !text) return;

    await salesReply({
      botId,
      senderId,
      text,
      pageAccessToken: PAGE_ACCESS_TOKEN,
      redis: connection,
      mid, // ✅ مهم
    });
  },
  { connection }
);

worker.on("completed", (job) => {
  // optional log
  // console.log("✅ job done", job.id);
});

worker.on("failed", (job, err) => {
  console.error("❌ job failed", job?.id, err?.message || err);
});

console.log(`👷 Worker started on queue: ${QUEUE_NAME}`);
