import Redis from "ioredis";

/* ================= Redis ================= */
const REDIS_URL =
  process.env.REDIS_PUBLIC_URL ||
  process.env.REDIS_URL;

if (!REDIS_URL) {
  console.error("❌ REDIS URL missing");
}

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 1,
  enableReadyCheck: false,
});

redis.on("connect", () => {
  console.log("✅ Redis connected");
});

redis.on("error", (err) => {
  console.error("❌ Redis error:", err.message);
});

/* ================= Queue ================= */
const QUEUE_KEY = "egboot:queue";
let workerStarted = false;

/* ✅ لازم الاسم ده بالظبط */
export async function enqueueIncomingMessage(data) {
  try {
    await redis.rpush(QUEUE_KEY, JSON.stringify(data));
  } catch (err) {
    console.error("enqueue error:", err.message);
  }
}

export function startWorker({ pageAccessToken }) {
  if (workerStarted) return;
  workerStarted = true;

  console.log("👷 Worker started");

  (async function loop() {
    while (true) {
      try {
        const result = await redis.blpop(QUEUE_KEY, 5);
        if (!result) continue;

        const payload = JSON.parse(result[1]);
        await handleMessage(payload, pageAccessToken);
      } catch (err) {
        console.error("Worker error:", err.message);
      }
    }
  })();
}

/* ================= Handler ================= */
async function handleMessage(job, token) {
  const event = job.event;
  if (!event?.message?.text) return;

  console.log("📩 Message:", event.message.text);
}

/* ================= Export Check ================= */
console.log("📦 queue.js loaded with exports");
