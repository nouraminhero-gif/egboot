// apps/worker/session.js
import dotenv from "dotenv";
import Redis from "ioredis";

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL || "";

if (!REDIS_URL) {
  console.warn("⚠️ REDIS_URL missing. Sessions/KB will be in-memory only.");
}

export const redis = REDIS_URL
  ? new Redis(REDIS_URL, {
      enableReadyCheck: false,
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        if (times > 10) return null;
        return Math.min(times * 500, 5000);
      },
    })
  : null;

export function isRedisEnabled() {
  return !!redis;
}

// ===================== Sessions =====================
const SESSION_PREFIX = "egboot:session:";

// fallback in-memory
const mem = new Map();

export function createDefaultSession() {
  return {
    step: "idle",
    order: {
      product: null,
      size: null,
      color: null,
      phone: null,
      address: null,
    },
    history: [],
    updatedAt: Date.now(),
  };
}

export async function getSession(psid) {
  if (!psid) return null;

  if (!redis) return mem.get(psid) || null;

  try {
    const raw = await redis.get(SESSION_PREFIX + psid);
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
    // TTL 24h
    await redis.set(SESSION_PREFIX + psid, JSON.stringify(s), "EX", 60 * 60 * 24);
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
    await redis.del(SESSION_PREFIX + psid);
  } catch (e) {
    console.error("❌ clearSession error:", e?.message || e);
  }
}

// ===================== KB (Learning / FAQ Cache) =====================
// تخزين إجابات الأسئلة المتكررة عشان لو عميل تاني سأل نفس السؤال نرد فورًا
const KB_PREFIX = "egboot:kb:clothes:";

/**
 * getKB(key) -> { answer, hits, createdAt, updatedAt } | null
 */
export async function getKB(key) {
  if (!key) return null;

  if (!redis) return null;

  try {
    const raw = await redis.get(KB_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error("❌ getKB error:", e?.message || e);
    return null;
  }
}

/**
 * setKB(key, answer, ttlSec=30d)
 */
export async function setKB(key, answer, ttlSec = 60 * 60 * 24 * 30) {
  if (!key || !answer) return;
  if (!redis) return;

  try {
    const now = Date.now();
    const existing = await getKB(key);
    const payload = existing
      ? { ...existing, answer, updatedAt: now, hits: Number(existing.hits || 0) }
      : { answer, createdAt: now, updatedAt: now, hits: 0 };

    await redis.set(KB_PREFIX + key, JSON.stringify(payload), "EX", ttlSec);
  } catch (e) {
    console.error("❌ setKB error:", e?.message || e);
  }
}

/**
 * bumpKBHit(key)
 */
export async function bumpKBHit(key) {
  if (!key) return;
  if (!redis) return;

  try {
    const item = await getKB(key);
    if (!item) return;
    item.hits = Number(item.hits || 0) + 1;
    item.updatedAt = Date.now();
    await redis.set(KB_PREFIX + key, JSON.stringify(item), "EX", 60 * 60 * 24 * 30);
  } catch (e) {
    console.error("❌ bumpKBHit error:", e?.message || e);
  }
}
