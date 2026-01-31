// apps/worker/sales.js
import dotenv from "dotenv";
import axios from "axios";
import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";

import {
  getSession as _getSession,
  setSession as _setSession,
  createDefaultSession,
} from "./session.js";

dotenv.config();

/**
 * ================== Catalog (context only) ==================
 */
const DEFAULT_CATALOG = {
  brandName: "Nour Fashion",
  categories: {
    tshirt: {
      name: "تيشيرت",
      price: 299,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أسود", "أبيض", "كحلي", "رمادي", "بيج"],
    },
    hoodie: {
      name: "هودي",
      price: 599,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أسود", "رمادي", "كحلي", "أبيض", "بيج"],
    },
    shirt: {
      name: "قميص",
      price: 499,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أسود", "أبيض", "كحلي", "رمادي", "بيج"],
    },
    pants: {
      name: "بنطلون",
      price: 549,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أسود", "كحلي", "رمادي", "بيج", "زيتي"],
    },
  },
  shipping: { cairoGiza: 70, otherGovernorates: 90 },
};

/**
 * ================== Gemini Setup ==================
 */
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// لو حبيت توقف Gemini من غير ما تمسح keys:
// حط GEMINI_DISABLED=1 في env
const GEMINI_DISABLED = String(process.env.GEMINI_DISABLED || "0") === "1";

let ai = null;
if (GEMINI_API_KEY && !GEMINI_DISABLED) {
  ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  console.log(`🤖 Gemini client ready (model: ${GEMINI_MODEL})`);
} else {
  console.warn("⚠️ Gemini disabled (missing key or GEMINI_DISABLED=1).");
}

/**
 * ================== FB Send ==================
 */
async function sendText(psid, text, token) {
  if (!psid || !token || !text) return;
  try {
    await axios.post(
      "https://graph.facebook.com/v18.0/me/messages",
      {
        recipient: { id: psid },
        messaging_type: "RESPONSE",
        message: { text },
      },
      { params: { access_token: token } }
    );
  } catch (e) {
    console.error("❌ FB send error:", e?.response?.data || e?.message);
  }
}

/**
 * ================== Utils ==================
 */
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
  // شيل الكلمات القصيرة جدًا
  return s.split(" ").filter((w) => w.length >= 2);
}

function safeExtractJSON(text) {
  if (!text) return null;
  const s = String(text).trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  try {
    return JSON.parse(s.slice(first, last + 1));
  } catch {
    return null;
  }
}

/**
 * Similarity: Dice coefficient on word bigrams (بسيطة وسريعة)
 */
function bigramsWords(words) {
  const bg = [];
  for (let i = 0; i < words.length - 1; i++) bg.push(words[i] + "_" + words[i + 1]);
  return bg;
}

function diceSimilarity(aText, bText) {
  const a = tokenize(aText);
  const b = tokenize(bText);
  if (!a.length || !b.length) return 0;

  const A = bigramsWords(a);
  const B = bigramsWords(b);
  if (!A.length || !B.length) return 0;

  const setA = new Map();
  for (const x of A) setA.set(x, (setA.get(x) || 0) + 1);

  let intersect = 0;
  for (const y of B) {
    const c = setA.get(y) || 0;
    if (c > 0) {
      intersect += 1;
      setA.set(y, c - 1);
    }
  }

  return (2 * intersect) / (A.length + B.length);
}

/**
 * ================== Session wrappers ==================
 */
async function getSession(senderId, botId, redis) {
  try {
    return await _getSession(senderId, botId, redis);
  } catch {
    return await _getSession(senderId);
  }
}

async function setSession(senderId, botId, session, redis) {
  try {
    return await _setSession(senderId, botId, session, redis);
  } catch {
    return await _setSession(senderId, session);
  }
}

/**
 * ================== Dedup (avoid repeated replies) ==================
 */
async function dedupCheck(redis, botId, mid) {
  if (!redis || !mid) return false;
  const key = `egboot:dedup:${botId}:${mid}`;
  try {
    const res = await redis.set(key, "1", "NX", "EX", 60);
    return res !== "OK";
  } catch (e) {
    console.error("❌ dedup redis error:", e?.message || e);
    return false;
  }
}

/**
 * ================== Knowledge Base (VERY IMPORTANT) ==================
 * 1) FAQ Hash:     egboot:kb:<botId>           field=sha1(qNorm) value=JSON
 * 2) Text Hash:    egboot:kb_text:<botId>      field=qNorm       value=sha1(qNorm)
 * 3) Index Sets:   egboot:kb_idx:<botId>:<tok> => Set of field hashes
 *
 * ليه؟ عشان البحث يبقى سريع ونحافظ على الداتا
 */
async function kbSave(redis, botId, userText, replyText, tags) {
  if (!redis) return;

  const qNorm = normalizeArabic(userText);
  if (!qNorm) return;

  const field = sha1(qNorm);

  const kbKey = `egboot:kb:${botId}`;
  const kbTextKey = `egboot:kb_text:${botId}`;

  const payload = {
    q: userText,
    qNorm,
    a: replyText,
    tags: tags || {},
    ts: Date.now(),
    hits: 0,
  };

  try {
    // حفظ الإجابة (من أول مرة)
    await redis.hset(kbKey, field, JSON.stringify(payload));

    // خريطة النص -> field (للـ exact match السريع)
    await redis.hset(kbTextKey, qNorm, field);

    // بناء index بالكلمات
    const toks = tokenize(qNorm);
    for (const t of toks) {
      const idxKey = `egboot:kb_idx:${botId}:${t}`;
      await redis.sadd(idxKey, field);
      // نخلي الـ index يعيش شهرين مثلًا
      await redis.expire(idxKey, 60 * 60 * 24 * 60);
    }

    // TTL للـ KB نفسه (اختياري)
    await redis.expire(kbKey, 60 * 60 * 24 * 90);
    await redis.expire(kbTextKey, 60 * 60 * 24 * 90);
  } catch (e) {
    console.error("❌ kbSave redis error:", e?.message || e);
  }
}

async function kbGetExact(redis, botId, userText) {
  if (!redis) return null;
  const qNorm = normalizeArabic(userText);
  if (!qNorm) return null;

  const kbKey = `egboot:kb:${botId}`;
  const kbTextKey = `egboot:kb_text:${botId}`;

  try {
    const field = await redis.hget(kbTextKey, qNorm);
    if (!field) return null;

    const raw = await redis.hget(kbKey, field);
    if (!raw) return null;

    const data = JSON.parse(raw);
    return { field, data };
  } catch {
    return null;
  }
}

async function kbRetrieve(redis, botId, userText) {
  if (!redis) return null;

  // 1) exact
  const exact = await kbGetExact(redis, botId, userText);
  if (exact?.data?.a) return { answer: exact.data.a, score: 1.0 };

  // 2) indexed candidates
  const qNorm = normalizeArabic(userText);
  const toks = tokenize(qNorm);
  if (!toks.length) return null;

  // اجمع مرشحين من أول 5 كلمات (كفاية)
  const topToks = toks.slice(0, 5);
  const keys = topToks.map((t) => `egboot:kb_idx:${botId}:${t}`);

  let candidateFields = [];
  try {
    // SUNION
    const union = await redis.sunion(keys);
    candidateFields = union || [];
  } catch (e) {
    console.error("❌ kbRetrieve sunion error:", e?.message || e);
    return null;
  }

  if (!candidateFields.length) return null;

  // اسحب بيانات المرشحين (حد أقصى 30)
  const kbKey = `egboot:kb:${botId}`;
  const sample = candidateFields.slice(0, 30);

  let best = { score: 0, answer: null };

  try {
    const raws = await redis.hmget(kbKey, ...sample);
    for (const raw of raws) {
      if (!raw) continue;
      const data = JSON.parse(raw);
      const score = diceSimilarity(qNorm, data.qNorm);
      if (score > best.score) {
        best.score = score;
        best.answer = data.a;
      }
    }
  } catch (e) {
    console.error("❌ kbRetrieve hmget error:", e?.message || e);
    return null;
  }

  // threshold: لو أقل من 0.45 غالبًا مش قريب
  if (best.answer && best.score >= 0.45) {
    return { answer: best.answer, score: best.score };
  }

  return null;
}

/**
 * ================== Gemini Prompt (STRICT JSON) ==================
 * Gemini بيرد + يطلع tags (intent/product) عشان KB تبقى “منظمة”
 */
function buildGeminiPrompt({ catalog, history, userText }) {
  return `
أنت موظف مبيعات مصري شاطر وودود لمتجر ملابس اسمه "${catalog.brandName}".
ردّ على رسالة العميل رد طبيعي مختصر (سطرين-3) وبإيموجي خفيفة 😊.

مهم جدًا:
- اكتب JSON فقط بدون أي كلام خارج JSON.
- الشكل الإجباري:
{
  "reply": "string",
  "tags": {
    "intent": "ask_shipping|ask_price|ask_sizes|ask_colors|ask_available|smalltalk|order_interest|other",
    "product": "tshirt|hoodie|shirt|pants|null"
  }
}

بيانات المتجر:
${JSON.stringify(catalog, null, 2)}

آخر 6 رسائل (سياق):
${JSON.stringify(history.slice(-6), null, 2)}

رسالة العميل:
"${userText}"
`;
}

/**
 * ================== Main Entry ==================
 * - Gemini ON: يرد + نسجل من أول مرة
 * - Gemini OFF: نرد من KB (retrieval) كأنه Gemini
 */
export async function salesReply({
  botId = "clothes",
  senderId,
  text,
  pageAccessToken,
  redis,
  mid,
}) {
  if (!senderId || !text?.trim()) return;

  const already = await dedupCheck(redis, botId, mid);
  if (already) return;

  const catalog = DEFAULT_CATALOG;

  let session =
    (await getSession(senderId, botId, redis)) || createDefaultSession();
  session.history = session.history || [];

  // ================== OFFLINE MODE (No Gemini) ==================
  if (!ai) {
    const got = await kbRetrieve(redis, botId, text);
    const reply =
      got?.answer ||
      `أهلًا بيك 😊 تحب تشوف المتاح ولا عندك منتج معين؟`;

    session.history.push({ user: text, bot: reply });
    await setSession(senderId, botId, session, redis);
    await sendText(senderId, reply, pageAccessToken);

    // حتى في offline: نسجل لو الرد fallback (عشان نعرف الأسئلة الناقصة)
    await kbSave(redis, botId, text, reply, { intent: "other", product: null });
    return;
  }

  // ================== ONLINE MODE (Gemini) ==================
  let replyText = null;
  let tags = { intent: "other", product: null };

  try {
    const prompt = buildGeminiPrompt({
      catalog,
      history: session.history,
      userText: text,
    });

    const resp = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
    });

    const raw = resp?.text || "";
    const parsed = safeExtractJSON(raw);

    if (parsed?.reply) replyText = String(parsed.reply).trim();
    if (parsed?.tags) tags = parsed.tags;
  } catch (e) {
    console.error("⚠️ Gemini failed:", e?.message || e);
    replyText = null;
  }

  if (!replyText) {
    // لو Gemini وقع… جرب KB فورًا
    const got = await kbRetrieve(redis, botId, text);
    replyText =
      got?.answer ||
      `تمام 😊 تحب تشوف تيشيرت ولا هودي ولا قميص ولا بنطلون؟`;
  }

  // send + session
  session.history.push({ user: text, bot: replyText });
  await setSession(senderId, botId, session, redis);
  await sendText(senderId, replyText, pageAccessToken);

  // ✅ تسجيل من أول مرة (الأهم)
  await kbSave(redis, botId, text, replyText, tags);
}
