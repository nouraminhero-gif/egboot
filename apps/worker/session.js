// apps/worker/session.js

/**
 * Session shape:
 * {
 *   history: [{ user: string, bot: string, ts?: number }],
 *   stage: "ai" | "checkout",
 *   slots: {
 *     product: "tshirt"|"hoodie"|"shirt"|"pants"|null,
 *     color: string|null,         // normalized Arabic
 *     size: "M"|"L"|"XL"|"2XL"|null,
 *     cityBucket: "cairoGiza"|"otherGovernorates"|null,
 *     customerName: string|null,
 *     phone: string|null,
 *     address: string|null
 *   }
 * }
 */

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function sessionKey(senderId, botId = "clothes") {
  return `egboot:sess:${botId}:${senderId}`;
}

export function createDefaultSession() {
  return {
    history: [],
    stage: "ai",
    slots: {
      product: null,
      color: null,
      size: null,
      cityBucket: null,
      customerName: null,
      phone: null,
      address: null,
    },
  };
}

/**
 * Get session from Redis (preferred) or return null.
 */
export async function getSession(senderId, botId = "clothes", redis = null) {
  if (!senderId) return null;

  // ✅ Redis path
  if (redis) {
    const key = sessionKey(senderId, botId);
    try {
      const raw = await redis.get(key);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      return parsed;
    } catch (e) {
      console.error("❌ getSession redis error:", e?.message || e);
      return null;
    }
  }

  // ✅ No redis fallback
  return null;
}

/**
 * Save session to Redis
 */
export async function setSession(senderId, botId = "clothes", session, redis = null) {
  if (!senderId || !session) return;

  if (!redis) return;

  const key = sessionKey(senderId, botId);

  try {
    await redis.set(key, JSON.stringify(session), "EX", SESSION_TTL_SECONDS);
  } catch (e) {
    console.error("❌ setSession redis error:", e?.message || e);
  }
}

/**
 * Optional helper: delete session (لو حبيت تعمل reset)
 */
export async function clearSession(senderId, botId = "clothes", redis = null) {
  if (!senderId || !redis) return;

  const key = sessionKey(senderId, botId);

  try {
    await redis.del(key);
  } catch (e) {
    console.error("❌ clearSession redis error:", e?.message || e);
  }
}
