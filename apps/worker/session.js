// apps/worker/session.js

export function createDefaultSession() {
  return {
    history: [],
    createdAt: Date.now(),
  };
}

function key(botId, senderId) {
  return `egboot:session:${botId}:${senderId}`;
}

export async function getSession(senderId, botId = "clothes", redis) {
  if (!redis) return null;
  try {
    const raw = await redis.get(key(botId, senderId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function setSession(senderId, botId = "clothes", session, redis) {
  if (!redis) return;
  try {
    await redis.set(key(botId, senderId), JSON.stringify(session), "EX", 60 * 60 * 24 * 7);
  } catch {}
}
