// session.js
import { redis } from "./queue.js";

const TTL_SECONDS = 60 * 60 * 24; // 24h

function key(tenantId, userId) {
  return `sess:${tenantId}:${userId}`;
}

export async function getSession(tenantId, userId) {
  if (!redis) return { step: "START" };

  const raw = await redis.get(key(tenantId, userId));
  if (!raw) return { step: "START" };

  try {
    return JSON.parse(raw);
  } catch {
    return { step: "START" };
  }
}

export async function saveSession(tenantId, userId, session) {
  if (!redis) return;
  await redis.set(key(tenantId, userId), JSON.stringify(session), "EX", TTL_SECONDS);
}

export async function clearSession(tenantId, userId) {
  if (!redis) return;
  await redis.del(key(tenantId, userId));
}
