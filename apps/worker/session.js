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

// fallback in-memory (لو redis مش موجود)
const mem = new Map();

export function createDefaultSession() {
  return {
    step: "idle",
    order: { product: null, size: null, color: null, phone: null, address: null },
    history: [],
    updatedAt: Date.now(),
  };
}

export async function getSession(psid) {
  if (!psid) return null;

  if (!redis) return mem.get(psid) || null;

  try {
    const raw = await redis.get(KEY_PREFIX + psid);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error("❌ getSession error:", e?.message || e);
    return null;
  }
}

export async function setSession(psid, session) {
  if (!psid) return;

  const s = session || createDefaultSession();
  s.updatedAt = Date.now();

  if (!redis) {
    mem.set(psid, s);
    return;
  }

  try {
    // TTL = 24h (غيّره براحتك)
    await redis.set(KEY_PREFIX + psid, JSON.stringify(s), "EX", 60 * 60 * 24);
  } catch (e) {
    console.error("❌ setSession error:", e?.message || e);
  }
}

export async function clearSession(psid) {
  if (!psid) return;

  if (!redis) {
    mem.delete(psid);
    return;
  }

  try {
    await redis.del(KEY_PREFIX + psid);
  } catch (e) {
    console.error("❌ clearSession error:", e?.message || e);
  }
}
