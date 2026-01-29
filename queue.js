// queue.js (FULL FILE) ✅
// Works on Railway Redis (Public/Private URL) + fixes ETIMEDOUT / Connection is closed issues

import IORedis from "ioredis";

/**
 * Pick the best Redis URL:
 * - Prefer REDIS_PUBLIC_URL if you exposed it (proxy.rlwy.net)
 * - Otherwise use REDIS_URL (internal containers)
 */
const REDIS_URL =
  process.env.REDIS_PUBLIC_URL ||
  process.env.REDIS_URL ||
  process.env.REDIS ||
  "";

// Small helper: parse host safely
function getHostFromRedisUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

const host = getHostFromRedisUrl(REDIS_URL);

/**
 * Railway Redis often needs TLS when using the public proxy (proxy.rlwy.net)
 * Even if the scheme is `redis://` you still might need TLS.
 */
const needsTLS =
  REDIS_URL.startsWith("rediss://") ||
  host.includes("proxy.rlwy.net") ||
  host.includes("railway") ||
  host.includes("rlwy");

const redisOptions = {
  // ✅ Fix: prevents BullMQ/ioredis from throwing "Reached the max retries..."
  maxRetriesPerRequest: null,

  // ✅ Fix: Railway sometimes causes "Connection is closed" with ready check
  enableReadyCheck: false,

  // ✅ Keep timeouts reasonable
  connectTimeout: 20000, // 20s
  lazyConnect: false,

  // ✅ Control reconnection behavior
  retryStrategy(times) {
    // backoff: 0.5s -> 5s
    const delay = Math.min(times * 500, 5000);
    return delay;
  },

  reconnectOnError(err) {
    // Reconnect on common transient errors
    const msg = err?.message || "";
    if (
      msg.includes("READONLY") ||
      msg.includes("ETIMEDOUT") ||
      msg.includes("ECONNRESET") ||
      msg.includes("Connection is closed")
    ) {
      return true;
    }
    return false;
  },
};

// ✅ Apply TLS only when needed
if (needsTLS) {
  redisOptions.tls = {
    // Railway proxy sometimes uses cert chains that fail strict validation
    rejectUnauthorized: false,
  };
}

if (!REDIS_URL) {
  console.warn("⚠️ REDIS_URL/REDIS_PUBLIC_URL is not set!");
}

/**
 * Create ONE shared Redis connection instance
 */
export const redis = new IORedis(REDIS_URL, redisOptions);

/**
 * Helpful logs
 */
redis.on("connect", () => {
  console.log("✅ Redis connected");
  console.log("🔗 Redis host:", host || "unknown");
  console.log("🔐 TLS:", needsTLS ? "enabled" : "disabled");
});

redis.on("ready", () => {
  console.log("🟢 Redis ready to use");
});

redis.on("error", (err) => {
  console.error("❌ Redis error:", err?.message || err);
});

redis.on("close", () => {
  console.warn("⚠️ Redis connection closed");
});

redis.on("reconnecting", (time) => {
  console.warn("🔁 Redis reconnecting... next attempt in", time, "ms");
});

/**
 * Optional: simple helper functions
 * (use these if you want)
 */
export async function redisPing() {
  return await redis.ping();
}

export async function redisSet(key, value, ttlSeconds = 0) {
  if (ttlSeconds > 0) {
    return await redis.set(key, value, "EX", ttlSeconds);
  }
  return await redis.set(key, value);
}

export async function redisGet(key) {
  return await redis.get(key);
}

export async function redisDel(key) {
  return await redis.del(key);
}
