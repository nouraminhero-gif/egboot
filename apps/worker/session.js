// apps/worker/session.js
import dotenv from "dotenv";
import Redis from "ioredis";

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL || "";

const redis = REDIS_URL
  ? new Redis(REDIS_URL, {
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
      retryStrategy(times) {
        if (times > 10) return null;
        return Math.min(times * 500, 5000);
      },
    })
  : null;

if (!REDIS_URL) {
  console.warn("⚠️ REDIS_URL missing. Sessions will be disabled.");
}

const PREFIX = "egboot:session:";

export function createDefaultSession() {
  return {
    step: "idle",
    history: [],
    order: {
      product: null,
      size: null,
      color: null,
      phone: null,
      address: null,
    },
    updatedAt: Date.now(),
  };
}

function makeKey(pageId, psid) {
  return `${PREFIX}${pageId || "nopage"}:${psid}`;
}

export async function getSession(pageId, psid) {
  if (!psid) return null;
  if (!redis) return null;

  try {
    const raw = await redis.get(makeKey(pageId, psid));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error("❌ getSession error:", e?.message || e);
    return null;
  }
}

export async function setSession(pageId, psid, session) {
  if (!psid) return;
  if (!redis) return;

  const s = session || createDefaultSession();
  s.updatedAt = Date.now();
  s.history = Array.isArray(s.history) ? s.history : [];

  try {
    // TTL = 24h
    await redis.set(makeKey(pageId, psid), JSON.stringify(s), "EX", 60 * 60 * 24);
  } catch (e) {
    console.error("❌ setSession error:", e?.message || e);
  }
}

export async function clearSession(pageId, psid) {
  if (!psid) return;
  if (!redis) return;

  try {
    await redis.del(makeKey(pageId, psid));
  } catch (e) {
    console.error("❌ clearSession error:", e?.message || e);
  }
}
