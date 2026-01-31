// apps/webhook/queue.js
import "dotenv/config";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL || "";

if (!REDIS_URL) {
  console.warn("⚠️ REDIS_URL is missing. Webhook will NOT enqueue jobs.");
}

// Railway/Upstash friendly Redis connection
export const connection = REDIS_URL
  ? new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy(times) {
        return Math.min(times * 200, 3000);
      },
    })
  : null;

connection?.on("connect", () => console.log("🔌 Redis connected (webhook)"));
connection?.on("ready", () => console.log("✅ Redis ready (webhook)"));
connection?.on("error", (e) =>
  console.error("❌ Redis error (webhook):", e?.message || e)
);
connection?.on("close", () => console.warn("⚠️ Redis closed (webhook)"));

// BullMQ Queue
export const messagesQueue = connection
  ? new Queue("messages", {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { count: 5000 },
        removeOnFail: { count: 2000 },
      },
    })
  : null;

// ✅ SaaS mapping keys
const PAGE_BOT_PREFIX = "egboot:pagebot:"; // egboot:pagebot:<pageId> -> botId

function isEcho(event) {
  return Boolean(event?.message?.is_echo);
}

function extractText(event) {
  return event?.message?.text || "";
}

/**
 * Resolve botId
 * Priority:
 * 1) passed botId argument (from webhook route)
 * 2) Redis mapping by pageId (recipient.id)
 * 3) fallback "clothes"
 */
async function resolveBotId(event, botId) {
  if (botId) return botId;

  const pageId = event?.recipient?.id;
  if (!pageId || !connection) return "clothes";

  try {
    const mapped = await connection.get(PAGE_BOT_PREFIX + pageId);
    return mapped || "clothes";
  } catch (e) {
    console.warn("⚠️ resolveBotId failed:", e?.message || e);
    return "clothes";
  }
}

/**
 * Optional helper: set mapping pageId -> botId
 * Call it once when you onboard a new page into your SaaS
 */
export async function setPageBotMapping(pageId, botId) {
  if (!connection || !pageId || !botId) return false;
  try {
    await connection.set(PAGE_BOT_PREFIX + pageId, botId);
    return true;
  } catch (e) {
    console.warn("⚠️ setPageBotMapping failed:", e?.message || e);
    return false;
  }
}

/**
 * Enqueue Messenger event (job)
 * job.data = { event, botId, createdAt }
 */
export async function enqueueMessage(event, botId) {
  if (!messagesQueue) {
    console.warn("⚠️ enqueue skipped: queue not available");
    return;
  }

  // ❌ متدخلش echo للـ queue (ده بيخلي البوت يبان بيبدأ)
  if (isEcho(event)) return;

  // حاليًا هنركز على text بس
  const text = extractText(event);
  const senderId = event?.sender?.id;
  if (!senderId || !String(text).trim()) return;

  const resolvedBotId = await resolveBotId(event, botId);

  await messagesQueue.add(
    "incoming_message",
    { event, botId: resolvedBotId, createdAt: Date.now() },
    {
      // priority/timing ممكن تضيفه بعدين
    }
  );
}

export async function closeQueueAndRedis() {
  try {
    if (messagesQueue) await messagesQueue.close();
  } catch (e) {
    console.warn("⚠️ queue close failed:", e?.message || e);
  }

  try {
    if (connection) await connection.quit();
  } catch (e) {
    console.warn("⚠️ redis quit failed:", e?.message || e);
    try {
      connection?.disconnect();
    } catch {}
  }
}
