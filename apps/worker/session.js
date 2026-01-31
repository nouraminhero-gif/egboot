// apps/worker/session.js
import crypto from "crypto";

const PREFIX = "egboot:session:";

function key(senderId, botId = "clothes") {
  return `${PREFIX}${botId}:${senderId}`;
}

export function createDefaultSession() {
  return {
    stage: "ai", // "ai" then "checkout"
    slots: {
      product: null,
      color: null, // normalized
      size: null,
      cityBucket: null,
      customerName: null,
      phone: null,
      address: null,
    },
    history: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export async function getSession(senderId, botId = "clothes", redis) {
  if (!redis) return null;
  try {
    const val = await redis.get(key(senderId, botId));
    return val ? JSON.parse(val) : null;
  } catch {
    return null;
  }
}

export async function setSession(senderId, botId = "clothes", session, redis) {
  if (!redis) return;
  try {
    session.updatedAt = Date.now();
    await redis.set(key(senderId, botId), JSON.stringify(session), "EX", 60 * 60 * 24 * 7); // 7 days
  } catch {
    // ignore
  }
}
