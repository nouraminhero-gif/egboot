// apps/worker/sales.js
import dotenv from "dotenv";
import axios from "axios";
import crypto from "crypto";

import { getSession as _getSession, setSession as _setSession, createDefaultSession } from "./session.js";

// ✅ Using installed package in your package.json:
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

/**
 * ================== Catalog / Business Context ==================
 */
const DEFAULT_CATALOG = {
  brandName: "Nour Fashion",
  categories: {
    tshirt: { name: "تيشيرت", price: 299, sizes: ["M","L","XL","2XL"], colors: ["أسود","أبيض","كحلي","رمادي","بيج"] },
    hoodie: { name: "هودي", price: 599, sizes: ["M","L","XL","2XL"], colors: ["أسود","رمادي","كحلي","أبيض","بيج"] },
    shirt:  { name: "قميص",  price: 499, sizes: ["M","L","XL","2XL"], colors: ["أسود","أبيض","كحلي","رمادي","بيج"] },
    pants:  { name: "بنطلون", price: 549, sizes: ["M","L","XL","2XL"], colors: ["أسود","كحلي","رمادي","بيج","زيتي"] },
  },
  shipping: { cairoGiza: 70, otherGovernorates: 90 },
  policies: {
    tone: "مصري ودود وسريع",
    goal: "بيع + مساعدة العميل يختار + إغلاق الأوردر بسلاسة",
  }
};

/**
 * ================== Gemini Setup ==================
 */
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

let model = null;
if (GEMINI_API_KEY) {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
  console.log(`🤖 Gemini ready (model: ${GEMINI_MODEL})`);
} else {
  console.warn("⚠️ GEMINI_API_KEY missing. Gemini disabled.");
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

/**
 * ================== Session wrappers ==================
 */
async function getSession(senderId, botId, redis) {
  try { return await _getSession(senderId, botId, redis); }
  catch { return await _getSession(senderId); }
}
async function setSession(senderId, botId, session, redis) {
  try { return await _setSession(senderId, botId, session, redis); }
  catch { return await _setSession(senderId, session); }
}

function ensureSessionShape(session) {
  session.history = session.history || []; // [{user, gemini}]
  session.profile = session.profile || { notes: "" };
  return session;
}

/**
 * ================== BOT "Brain" (Learning) ==================
 * We store:
 * - FAQ: normalized question hash -> Gemini answer
 * - Conversation log: last N turns
 * - Slots/Meta extraction (optional lightweight)
 */

// Save FAQ (Q -> A)
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

// Get exact cached FAQ (only exact normalized hash)
async function getCachedFAQ(redis, botId, userText) {
  if (!redis) return null;
  const nq = normalizeArabic(userText);
  if (!nq) return null;
  const key = `egboot:faq:${botId}`;
  const field = sha1(nq);
  try {
    return (await redis.hget(key, field)) || null;
  } catch (e) {
    console.error("❌ FAQ hget error:", e?.message || e);
    return null;
  }
}

// Store conversation turns (for dynamic context)
async function pushConversation(redis, botId, senderId, turn) {
  if (!redis) return;
  const key = `egboot:conv:${botId}:${senderId}`;
  try {
    await redis.lpush(key, JSON.stringify(turn));
    await redis.ltrim(key, 0, 30); // keep last 30 turns
    await redis.expire(key, 60 * 60 * 24 * 30);
  } catch (e) {
    console.error("❌ conv lpush error:", e?.message || e);
  }
}

async function getRecentConversation(redis, botId, senderId, n = 8) {
  if (!redis) return [];
  const key = `egboot:conv:${botId}:${senderId}`;
  try {
    const items = await redis.lrange(key, 0, Math.max(0, n - 1));
    return items.map((x) => {
      try { return JSON.parse(x); } catch { return null; }
    }).filter(Boolean);
  } catch (e) {
    console.error("❌ conv lrange error:", e?.message || e);
    return [];
  }
}

/**
 * ================== Build Gemini Prompt ==================
 * Gemini replies naturally (ONLY message sent to customer).
 * Bot adds context:
 * - business info (catalog/shipping)
 * - last conversation turns
 * - (optional) exact FAQ hit
 */
function buildGeminiPrompt({ catalog, recentTurns, userText, faqHit }) {
  const system = `
أنت موظف مبيعات مصري شاطر وودود لمتجر ملابس اسمه "${catalog.brandName}".
ممنوع تسأل أسئلة كتير في نفس الرسالة. اسأل سؤال واحد واضح فقط لو محتاج.
لو العميل بيسأل عن الشحن/السعر/الألوان/المقاسات: رد بدقة من الداتا.
لو العميل عايز يطلب: وجّهه خطوة بخطوة بسلاسة (اسم/موبايل/عنوان/تأكيد).
خليك طبيعي مش روبوت.
`;

  const business = `
بيانات المتجر (مصدر الحقيقة):
${JSON.stringify(catalog, null, 2)}
`;

  const memory = `
آخر محادثات مع العميل (مختصر):
${JSON.stringify(recentTurns.slice(0, 8), null, 2)}
`;

  const faq = faqHit
    ? `\nمعلومة متعلمة سابقًا (FAQ مطابق للسؤال):\n${faqHit}\n`
    : "";

  const user = `رسالة العميل الآن:\n"${userText}"`;

  return `${system}\n${business}\n${memory}\n${faq}\n${user}`;
}

/**
 * ================== Dedup ==================
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
 * ================== Main (Gemini-only Reply) ==================
 */
export async function salesReply({ botId = "clothes", senderId, text, pageAccessToken, redis, mid }) {
  if (!senderId || !text?.trim()) return;

  const already = await dedupCheck(redis, botId, mid);
  if (already) return;

  const catalog = DEFAULT_CATALOG;

  let session = ensureSessionShape((await getSession(senderId, botId, redis)) || createDefaultSession());

  // 1) Load dynamic context
  const recentTurns = await getRecentConversation(redis, botId, senderId, 8);

  // 2) FAQ exact hit (optional)
  const faqHit = await getCachedFAQ(redis, botId, text);

  // 3) Gemini must reply
  let replyText = null;

  if (!model) {
    replyText = `أنا شغال دلوقتي بدون Gemini. ابعتلي تفاصيل أكتر عن اللي محتاجه 😊`;
  } else {
    try {
      const prompt = buildGeminiPrompt({ catalog, recentTurns, userText: text, faqHit });

      const resp = await model.generateContent(prompt);
      replyText = resp?.response?.text?.() || resp?.response?.text || "";

      replyText = String(replyText).trim();
      if (!replyText) replyText = "تمام 😊 ممكن توضحلي قصدك أكتر؟";
    } catch (e) {
      console.error("⚠️ Gemini failed:", e?.message || e);
      replyText = "حصل عطل بسيط 😅 ممكن تبعت رسالتك تاني؟";
    }
  }

  // 4) Send ONLY Gemini reply
  await sendText(senderId, replyText, pageAccessToken);

  // 5) Bot learns silently
  session.history.push({ user: text, gemini: replyText });
  await setSession(senderId, botId, session, redis);

  await pushConversation(redis, botId, senderId, { user: text, gemini: replyText, ts: Date.now() });
  await saveFAQ(redis, botId, text, replyText);
}
