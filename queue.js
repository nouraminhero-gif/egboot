import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { askAI } from "./ai.js";

const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const messageQueue = new Queue("messages", {
  connection,
});

export const startWorker = () => {
  const worker = new Worker(
    "messages",
    async (job) => {
      const { message } = job.data;
      const reply = await askAI(message);
      return reply;
    },
    { connection }
  );

  worker.on("ready", () => {
    console.log("✅ Worker started & ready");
  });

  worker.on("failed", (job, err) => {
    console.error("❌ Job failed:", err.message);
  });
};
