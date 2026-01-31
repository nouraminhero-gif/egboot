// apps/worker/brain/logger.js

function safeJson(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    return JSON.stringify({ error: "stringify_failed" });
  }
}

function now() {
  return Date.now();
}

/**
 * حفظ سجل محادثة كامل لكل عميل (timeline)
 * Key: brain:{botId}:user:{senderId}:timeline
 * Value: JSON lines
 */
export async function logTurn({
  redis,
  botId,
  senderId,
  mid,
  question,
  answer,
  meta = {},
}) {
  if (!redis) return;

  const ts = now();

  const row = {
    ts,
    mid: mid || null,
    q: question,
    a: answer,
    meta,
  };

  const timelineKey = `brain:${botId}:user:${senderId}:timeline`;
  const globalKey = `brain:${botId}:global:timeline`;

  // نخزن في timeline المستخدم + global timeline
  await redis.rpush(timelineKey, safeJson(row));
  await redis.rpush(globalKey, safeJson({ senderId, ...row }));

  // (اختياري) نخليهم مايزيدوش عن عدد معين عشان التكلفة
  // غيّر الرقم براحتك
  await redis.ltrim(timelineKey, -5000, -1);
  await redis.ltrim(globalKey, -20000, -1);
}

/**
 * عدّاد للأسئلة المتكررة (FAQ frequency)
 * Key: brain:{botId}:faq:counts  (hash)
 * field: normalized question
 * value: count
 */
export async function bumpFaqCount({ redis, botId, question }) {
  if (!redis || !question) return;

  const q = String(question).trim().toLowerCase();
  if (!q) return;

  const key = `brain:${botId}:faq:counts`;
  await redis.hincrby(key, q, 1);
}
