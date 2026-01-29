import Redis from "ioredis";

let redis;

export function getRedis() {
  if (!redis) {
    if (!process.env.REDIS_PUBLIC_URL) {
      console.log("❌ REDIS_PUBLIC_URL not found");
      return null;
    }

    redis = new Redis(process.env.REDIS_PUBLIC_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy(times) {
        const delay = Math.min(times * 1000, 10000);
        console.log(`🔁 Redis retry in ${delay}ms`);
        return delay;
      }
    });

    redis.on("connect", () => {
      console.log("✅ Redis connected");
    });

    redis.on("error", (err) => {
      console.log("⚠️ Redis error:", err.message);
    });
  }

  return redis;
}
