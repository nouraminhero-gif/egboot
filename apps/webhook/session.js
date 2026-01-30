// session.js
// Redis-backed sessions (ioredis) ✅
// ENV needed:
//   REDIS_URL=redis://...
// Optional:
//   SESSION_PREFIX=egboot:sess:
//   SESSION_TTL_SECONDS=86400

import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL;
const SESSION_PREFIX = process.env.SESSION_PREFIX || "egboot:sess:";
const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS || 60 * 60 * 24); // 24h default

// Fail fast لو REDIS_URL مش موجود (مهم جدًا عشان نمنع تحذير misleading)
if (!REDIS_URL) {
  throw new Error("❌ REDIS_URL is not defined in environment variables.");
}

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on("connect", () => {
  console.log("✅ Redis client: connected");
});

redis.on("error", (err) => {
  console.error("❌ Redis client error:", err?.message || err);
});

function keyFor(senderId) {
  return `${SESSION_PREFIX}${senderId}`;
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

/**
 * يرجّع Session Object أو null
 */
export async function getSession(senderId) {
  if (!senderId) return null;

  const raw = await redis.get(keyFor(senderId));
  if (!raw) return null;

  return safeJsonParse(raw);
}

/**
 * يحفظ Session Object ويعمل TTL refresh
 */
export async function setSession(senderId, session) {
  if (!senderId) return;

  const payload = JSON.stringify(session ?? {});
  await redis.set(keyFor(senderId), payload, "EX", SESSION_TTL_SECONDS);
}

/**
 * يمسح السيشن تمامًا
 */
export async function clearSession(senderId) {
  if (!senderId) return;
  await redis.del(keyFor(senderId));
}

/**
 * Helper: تحديث جزء من السيشن بسهولة
 * updater(session) => session
 */
export async function updateSession(senderId, updater) {
  const current = (await getSession(senderId)) || {};
  const next = typeof updater === "function" ? updater(current) : current;
  await setSession(senderId, next);
  return next;
}

/**
 * Default session shape (اختياري تستخدمه في sales flow)
 */
export function createDefaultSession() {
  return {
    step: "start",
    order: {
      product: null,
      size: null,
      color: null,
      phone: null,
      address: null,
    },
    meta: {
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  };
}
