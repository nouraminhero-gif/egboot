// apps/worker/sales.js
import "dotenv/config";
import crypto from "crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ================== Catalog ==================
const DEFAULT_CATALOG = {
  brandName: "Nour Fashion",
  categories: {
    tshirt: {
      name: "تيشيرت",
      price: 299,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أسود", "أبيض", "كحلي", "رمادي", "بيج"],
      material: "قطن مريح (جودة كويسة للاستخدام اليومي)",
    },
    hoodie: {
      name: "هودي",
      price: 599,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أسود", "رمادي", "كحلي", "أبيض", "بيج"],
      material: "خامة دافية مناسبة للشتا (قماش تقيل نسبيًا)",
    },
    shirt: {
      name: "قميص",
      price: 499,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أسود", "أبيض", "كحلي", "رمادي", "بيج"],
      material: "قماش عملي ومريح (ستايل كاجوال/سمارت)",
    },
    pants: {
      name: "بنطلون",
      price: 549,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أسود", "كحلي", "رمادي", "بيج", "زيتي"],
      material: "خامة عملية مناسبة للخروج والشغل",
    },
  },
  shipping: {
    cairoGiza: 70,
    otherGovernorates: 90,
  },
};

// ================== Gemini ==================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";

let model = null;
if (GEMINI_API_KEY) {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
  console.log(`🤖 Gemini ready (model: ${GEMINI_MODEL})`);
} else {
  console.warn("⚠️ GEMINI_API_KEY missing. Gemini disabled.");
}

// ================== Utils ==================
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

function detectProduct(text) {
  const s = normalizeArabic(text);
  if (s.includes("تيشير") || s.includes("تي شير") || s.includes("tshirt")) return "tshirt";
  if (s.includes("هودي") || s.includes("hoodie")) return "hoodie";
  if (s.includes("قميص") || s.includes("shirt")) return "shirt";
  if (s.includes("بنطلون") || s.includes("pantalon") || s.includes("pants")) return "pants";
  return null;
}

function extractColor(text, catalog) {
  const s = normalizeArabic(text);
  const allColors = new Set();
  Object.values(catalog.categories).forEach((c) => c.colors.forEach((x) => allColors.add(normalizeArabic(x))));
  for (const c of allColors) {
    if (s.includes(c)) return c;
  }
  return null;
}

function extractSize(text) {
  const m = /(^|\s)(2XL|XXL|XL|L|M|S)(\s|$)/i.exec(String(text));
  if (m?.[2]) return m[2].toUpperCase();
  return null;
}

function detectGovernorateBucket(text) {
  const s = normalizeArabic(text);
  if (s.includes("القاهره") || s.includes("الجيزه")) return "cairoGiza";
  if (s.includes("محافظ") || s.includes("اسكندري") || s.includes("المنصوره") || s.includes("طنطا")) return "otherGovernorates";
  return null;
}

// ================== Prompt ==================
function buildPrompt({ catalog, history, userText }) {
  return `
أنت موظف مبيعات مصري شاطر وودود لمتجر ملابس اسمه "${catalog.brandName}".
ممنوع تقول أي حاجة عن إن فيه "بوت" أو "ذكاء صناعي" أو "Gemini" أو "نظام".

قواعد الرد:
- رد مختصر وواضح ومفيد، وبالعامية المصرية.
- لو سؤال عن منتج/مقاس/لون/شحن: جاوب من بيانات الكتالوج.
- لو العميل بيسأل "الشحن كام؟" اسأله محافظة/مدينة لو مش واضحة.
- لو العميل بيقول "عايز أعمل أوردر": قولّه يحدد (المنتج + اللون + المقاس + المحافظة).
- خليك طبيعي جدًا زي موظف حقيقي.

بيانات الكتالوج:
${JSON.stringify(catalog, null, 2)}

سياق آخر رسائل (اختصار):
${JSON.stringify(history.slice(-8), null, 2)}

رسالة العميل:
"${userText}"
`.trim();
}

// ================== Storage (Redis) ==================
async function saveTurn(redis, botId, senderId, userText, replyText, meta) {
  if (!redis) return;

  const key = `egboot:history:${botId}:${senderId}`;
  const item = JSON.stringify({
    t: Date.now(),
    q: userText,
    a: replyText,
    meta: meta || {},
  });

  try {
    await redis.rpush(key, item);
    await redis.ltrim(key, -50, -1); // keep last 50
    await redis.expire(key, 60 * 60 * 24 * 30); // 30 days
  } catch (e) {
    console.error("❌ saveTurn error:", e?.message || e);
  }
}

async function loadHistory(redis, botId, senderId) {
  if (!redis) return [];
  const key = `egboot:history:${botId}:${senderId}`;
  try {
    const items = await redis.lrange(key, -20, -1);
    return items
      .map((x) => {
        try { return JSON.parse(x); } catch { return null; }
      })
      .filter(Boolean)
      .map((x) => ({ user: x.q, bot: x.a }));
  } catch {
    return [];
  }
}

async function saveFAQ(redis, botId, userText, answerText) {
  if (!redis) return;
  const nq = normalizeArabic(userText);
  if (!nq) return;

  const key = `egboot:faq:${botId}`;
  const field = sha1(nq);

  try {
    await redis.hset(key, field, answerText);
    await redis.expire(key, 60 * 60 * 24 * 90); // 90 days
  } catch (e) {
    console.error("❌ FAQ hset error:", e?.message || e);
  }
}

// ✅ عدّاد للأسئلة المتكررة (مفيد بعد شهر)
async function bumpFaqCount(redis, botId, userText) {
  if (!redis) return;
  const nq = normalizeArabic(userText);
  if (!nq) return;
  try {
    await redis.hincrby(`egboot:faq_count:${botId}`, sha1(nq), 1);
    await redis.expire(`egboot:faq_count:${botId}`, 60 * 60 * 24 * 120); // 120 days
  } catch {}
}

// ✅ منع تكرار الرد (مهم جدًا مع retries)
async function shouldProcessMid(redis, botId, mid) {
  if (!redis || !mid) return true;
  const key = `egboot:mid:${botId}:${mid}`;
  try {
    // SETNX
    const ok = await redis.set(key, "1", "NX", "EX", 60 * 60 * 24 * 7); // 7 days
    return !!ok;
  } catch {
    return true;
  }
}

// ================== Facebook Send ==================
async function sendFacebookText({ pageAccessToken, senderId, text }) {
  if (!pageAccessToken) {
    console.warn("⚠️ Missing PAGE_ACCESS_TOKEN, cannot send message.");
    return;
  }

  const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${encodeURIComponent(
    pageAccessToken
  )}`;

  const payload = {
    recipient: { id: senderId },
    messaging_type: "RESPONSE",
    message: { text },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("❌ FB send failed:", res.status, body);
  }
}

// ================== Public API ==================
export async function geminiGenerateReply({ botId, senderId, userText, redis }) {
  const catalog = DEFAULT_CATALOG;

  const history = await loadHistory(redis, botId, senderId);

  const meta = {
    slots: {
      product: detectProduct(userText),
      color: extractColor(userText, catalog),
      size: extractSize(userText),
      cityBucket: detectGovernorateBucket(userText),
    },
  };

  if (!model) {
    const fallback = "أهلًا بيك 😊 قولي تحب تيشيرت ولا هودي ولا قميص ولا بنطلون؟";
    return { replyText: fallback, meta };
  }

  try {
    const prompt = buildPrompt({ catalog, history, userText });
    const result = await model.generateContent(prompt);
    const replyText =
      result?.response?.text()?.trim() || "تمام 😊 ممكن توضحلي قصدك أكتر؟";
    return { replyText, meta };
  } catch (e) {
    console.error("⚠️ Gemini failed:", e?.message || e);
    return { replyText: "معلش حصل لخبطة بسيطة 😅 ممكن تعيد رسالتك تاني؟", meta };
  }
}

export async function observeAndLearn({ botId, senderId, userText, replyText, mid, redis, meta }) {
  await saveTurn(redis, botId, senderId, userText, replyText, { ...meta, mid });
  await saveFAQ(redis, botId, userText, replyText);
  await bumpFaqCount(redis, botId, userText);
}

// ================== The Missing Piece: salesReply ==================
// ✅ ده اللي worker.js بيناديه
export async function salesReply({
  botId,
  senderId,
  text,
  mid,
  pageAccessToken,
  redis,
}) {
  // ✅ منع duplicate reply لو BullMQ عمل retry
  const okToProcess = await shouldProcessMid(redis, botId, mid);
  if (!okToProcess) {
    console.log("♻️ Duplicate mid skipped:", mid);
    return { ok: true, duplicate: true };
  }

  // 1) Gemini يطلع الرد
  const { replyText, meta } = await geminiGenerateReply({
    botId,
    senderId,
    userText: text,
    redis,
  });

  // 2) إرسال الرد للعميل (Gemini هو اللي بيرد فعليًا)
  await sendFacebookText({
    pageAccessToken,
    senderId,
    text: replyText,
  });

  // 3) البوت “يراقب ويتعلم” فقط (تسجيل Q/A)
  await observeAndLearn({
    botId,
    senderId,
    userText: text,
    replyText,
    mid,
    redis,
    meta,
  });

  return { ok: true };
}
