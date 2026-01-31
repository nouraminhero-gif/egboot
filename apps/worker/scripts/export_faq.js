// apps/worker/scripts/export_faq.js
import fs from "fs";
import dotenv from "dotenv";
import IORedis from "ioredis";

dotenv.config();

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) throw new Error("Missing REDIS_URL");

const botId = process.env.BOT_ID || "clothes";
const redis = new IORedis(REDIS_URL);

const kbKey = `egboot:kb:${botId}`;
const outFile = `kb_${botId}_${Date.now()}.json`;

async function main() {
  const all = await redis.hgetall(kbKey);
  const rows = Object.entries(all).map(([field, value]) => {
    try {
      return { field, ...JSON.parse(value) };
    } catch {
      return { field, raw: value };
    }
  });

  fs.writeFileSync(outFile, JSON.stringify({ botId, rows }, null, 2), "utf8");
  console.log(`✅ Exported ${rows.length} records to ${outFile}`);
  await redis.quit();
}

main().catch(async (e) => {
  console.error("❌ export failed:", e?.message || e);
  await redis.quit();
  process.exit(1);
});
