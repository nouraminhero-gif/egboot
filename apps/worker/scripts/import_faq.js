// apps/worker/scripts/import_faq.js
import fs from "fs";
import dotenv from "dotenv";
import crypto from "crypto";
import IORedis from "ioredis";

dotenv.config();

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) throw new Error("Missing REDIS_URL");

const filePath = process.env.KB_FILE; // مثال: KB_FILE=kb_clothes_123.json
if (!filePath) throw new Error("Missing KB_FILE env var");

const redis = new IORedis(REDIS_URL);

function normalizeArabic(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/[إأآا]/g, "ا")
    .replace(/[ى]/g, "ي")
    .replace(/[ؤ]/g, "و")
    .replace(/[ئ]/g, "ي")
    .replace(/[ة]/g, "ه")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sha1(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

function tokenize(text) {
  const s = normalizeArabic(text);
  if (!s) return [];
  return s.split(" ").filter((w) => w.length >= 2);
}

async function main() {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);

  const botId = parsed.botId || "clothes";
  const rows = parsed.rows || [];

  const kbKey = `egboot:kb:${botId}`;
  const kbTextKey = `egboot:kb_text:${botId}`;

  let ok = 0;

  for (const r of rows) {
    const qNorm = r.qNorm || normalizeArabic(r.q || "");
    if (!qNorm) continue;

    const field = r.field || sha1(qNorm);

    const payload = {
      q: r.q || "",
      qNorm,
      a: r.a || "",
      tags: r.tags || {},
      ts: r.ts || Date.now(),
      hits: r.hits || 0
    };

    await redis.hset(kbKey, field, JSON.stringify(payload));
    await redis.hset(kbTextKey, qNorm, field);

    // rebuild index
    const toks = tokenize(qNorm);
    for (const t of toks) {
      const idxKey = `egboot:kb_idx:${botId}:${t}`;
      await redis.sadd(idxKey, field);
      await redis.expire(idxKey, 60 * 60 * 24 * 60);
    }

    ok++;
  }

  await redis.expire(kbKey, 60 * 60 * 24 * 90);
  await redis.expire(kbTextKey, 60 * 60 * 24 * 90);

  console.log(`✅ Imported ${ok}/${rows.length} records for botId=${botId}`);
  await redis.quit();
}

main().catch(async (e) => {
  console.error("❌ import failed:", e?.message || e);
  await redis.quit();
  process.exit(1);
});
