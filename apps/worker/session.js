// apps/worker/session.js
import dotenv from "dotenv";
import Redis from "ioredis";

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL || "";

if (!REDIS_URL) {
  console.warn("⚠️ REDIS_URL missing. Sessions will be in-memory only.");
}

const redis = REDIS_URL
  ? new Redis(REDIS_URL, {
      enableReadyCheck: false,
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        if (times > 10) return null;
        return Math.min(times * 500, 5000);
      },
    })
  : null;

const KEY_PREFIX = "egboot:session:";

// fallback in-memory
const mem = new Map();

export function createDefaultSession() {
  return {
    step: "idle",
    order: {
      category: null,
      product: null,
      size: null,
      color: null,
      phone: null,
      address: null,
      governorate: null,
    },
    history: [],
    firstMessageSeen: false,
    updatedAt: Date.now(),
  };
}

function key(botId, psid) {
  return `${KEY_PREFIX}${botId}:${psid}`;
}

export async function getSession(botId, psid) {
  if (!psid) return null;
  const k = key(botId || "clothes", psid);

  if (!redis) return mem.get(k) || null;

  try {
    const raw = await redis.get(k);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error("❌ getSession error:", e?.message || e);
    return null;
  }
}

export async function setSession(botId, psid, session) {
  if (!psid) return;

  const s = session || createDefaultSession();
  s.updatedAt = Date.now();

  const k = key(botId || "clothes", psid);

  if (!redis) {
    mem.set(k, s);
    return;
  }

  try {
    // TTL = 24h
    await redis.set(k, JSON.stringify(s), "EX", 60 * 60 * 24);
  } catch (e) {
    console.error("❌ setSession error:", e?.message || e);
  }
}

export async function clearSession(botId, psid) {
  if (!psid) return;
  const k = key(botId || "clothes", psid);

  if (!redis) {
    mem.delete(k);
    return;
  }

  try {
    await redis.del(k);
  } catch (e) {
    console.error("❌ clearSession error:", e?.message || e);
  }
}
