// apps/worker/sales.js
import dotenv from "dotenv";
import axios from "axios";
import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";

import {
  getSession as _getSession,
  setSession as _setSession,
  createDefaultSession
} from "./session.js";

dotenv.config();

/**
 * ================== Catalog ==================
 */
const DEFAULT_CATALOG = {
  brandName: "Nour Fashion",
  categories: {
    tshirt: {
      name: "تيشيرت",
      price: 299,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أسود", "أبيض", "كحلي", "رمادي", "بيج"],
      material: "قطن مريح (جودة كويسة للاستخدام اليومي)"
    },
    hoodie: {
      name: "هودي",
      price: 599,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أسود", "رمادي", "كحلي", "أبيض", "بيج"],
      material: "خامة دافية مناسبة للشتا (قماش تقيل نسبيًا)"
    },
    shirt: {
      name: "قميص",
      price: 499,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أسود", "أبيض", "كحلي", "رمادي", "بيج"],
      material: "قماش عملي ومريح (ستايل كاجوال/سمارت)"
    },
    pants: {
      name: "بنطلون",
      price: 549,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أسود", "كحلي", "رمادي", "بيج", "زيتي"],
      material: "خامة عملية مناسبة للخروج والشغل"
    }
  },
  shipping: {
    cairoGiza: 70,
    otherGovernorates: 90
  }
};

/**
 * ================== Gemini Setup ==================
 */
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

let ai = null;
if (GEMINI_API_KEY) {
  ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  console.log(`🤖 Gemini client ready (model: ${GEMINI_MODEL})`);
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
        message: { text }
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

function looksLikeGreeting(t) {
  const s = normalizeArabic(t);
  return (
    s.includes("السلام عليكم") ||
    s.includes("سلام عليكم") ||
    s === "سلام" ||
    s.includes("اهلا") ||
    s.includes("هاي") ||
    s.includes("hi")
  );
}

function detectProduct(text) {
  const s = normalizeArabic(text);
  if (s.includes("تيشير") || s.includes("تي شير") || s.includes("tshirt")) return "tshirt";
  if (s.includes("هودي") || s.includes("hoodie")) return "hoodie";
  if (s.includes("قميص") || s.includes("shirt")) return "shirt";
  if (s.includes("بنطلون") || s.includes("pantalon") || s.includes("pants")) return "pants";
  return null;
}

function extractSize(text) {
  const m = /(^|\s)(2XL|XXL|XL|L|M|S)(\s|$)/i.exec(text);
  return m?.[2] ? m[2].toUpperCase() : null;
}

function extractColor(text, catalog) {
  const s = normalizeArabic(text);
  const all = [];
  Object.values(catalog.categories).forEach((c) => c.colors.forEach((x) => all.push(x)));
  for (const c of all) {
    const cn = normalizeArabic(c);
    if (cn && s.includes(cn)) return cn; // normalized
  }
  return null;
}

function detectGovernorateBucket(text) {
  const s = normalizeArabic(text);
  if (s.includes("القاهره") || s.includes("القاهرة") || s.includes("الجيزه") || s.includes("الجيزة")) return "cairoGiza";
  if (s.includes("محافظ")) return "otherGovernorates";
  return null;
}

function extractPhone(text) {
  const digits = String(text).replace(/[^\d]/g, "");
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return null;
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
 * ================== Dedup ==================
 */
async function dedupCheck(redis, botId, mid) {
  if (!redis || !mid) return false;
  const key = `egboot:dedup:${botId}:${mid}`;
  try {
    const res = await redis.set(key, "1", "NX", "EX", 90);
    return res !== "OK";
  } catch (e) {
    console.error("❌ dedup redis error:", e?.message || e);
    return false;
  }
}

/**
 * ================== FAQ Cache ==================
 */
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

async function saveFAQ(redis, botId, userText, answerText) {
  if (!redis) return;
  const nq = normalizeArabic(userText);
  if (!nq) return;

  const key = `egboot:faq:${botId}`;
  const field = sha1(nq);

  try {
    await redis.hset(key, field, answerText);
    await redis.expire(key, 60 * 60 * 24 * 30);
  } catch (e) {
    console.error("❌ FAQ hset error:", e?.message || e);
  }
}

/**
 * ================== Smart flow ==================
 */
function ensureSessionShape(session) {
  session.history = session.history || [];
  session.stage = session.stage || "ai";
  session.slots = session.slots || {
    product: null,
    color: null,
    size: null,
    cityBucket: null,
    customerName: null,
    phone: null,
    address: null
  };
  return session;
}

function fillSlotsFromText(session, text, catalog) {
  const prod = detectProduct(text);
  const colorNorm = extractColor(text, catalog);
  const size = extractSize(text);
  const city = detectGovernorateBucket(text);
  const phone = extractPhone(text);

  if (prod) session.slots.product = prod;
  if (colorNorm) session.slots.color = colorNorm;
  if (size) session.slots.size = size;
  if (city) session.slots.cityBucket = city;
  if (phone) session.slots.phone = phone;
}

function slotsReadyForCheckout(session) {
  const { product, color, size } = session.slots;
  return Boolean(product && color && size);
}

function formatColorForCatalog(normalizedColor, productKey, catalog) {
  if (!normalizedColor) return null;
  const colors = catalog.categories[productKey]?.colors || [];
  const found = colors.find((c) => normalizeArabic(c) === normalizedColor);
  return found || null;
}

function checkoutSummary(session, catalog) {
  const { product, color, size, cityBucket } = session.slots;
  const p = catalog.categories[product];
  const shipping = cityBucket === "cairoGiza" ? catalog.shipping.cairoGiza : catalog.shipping.otherGovernorates;
  const total = p.price + shipping;

  return {
    shipping,
    total,
    productName: p.name,
    price: p.price,
    colorLabel: formatColorForCatalog(color, product, catalog),
    size
  };
}

async function handleCheckout(session, text, catalog) {
  const s = normalizeArabic(text);

  // name
  if (!session.slots.customerName) {
    if (s.startsWith("اسمي") || (text.trim().length >= 3 && text.trim().length <= 30 && !extractPhone(text))) {
      session.slots.customerName = text.trim().replace(/^اسمي\s*/i, "");
    }
  }

  // address
  if (!session.slots.address) {
    if (s.includes("عنوان") || s.includes("شارع") || s.includes("عماره") || text.trim().length > 25) {
      session.slots.address = text.trim();
    }
  }

  // phone
  const phone = extractPhone(text);
  if (phone) session.slots.phone = phone;

  const missing = [];
  if (!session.slots.customerName) missing.push("الاسم");
  if (!session.slots.phone) missing.push("رقم الموبايل");
  if (!session.slots.address) missing.push("العنوان");

  if (missing.length) {
    return `تمام 😊 ابعتلي ${missing.join(" + ")} عشان أكدلك الأوردر.`;
  }

  const sum = checkoutSummary(session, catalog);
  return `تمام ✅ أوردر: ${sum.productName} (${sum.colorLabel}) مقاس ${sum.size}\nالسعر ${sum.price} + شحن ${sum.shipping} = الإجمالي ${sum.total} جنيه.\nتأكيد؟ (نعم/لا) 😊`;
}

/**
 * ================== Gemini prompt (STRICT JSON) ==================
 */
function buildGeminiPrompt({ catalog, session, userText }) {
  return `
اكتب JSON فقط بدون أي كلام خارج JSON.

المطلوب:
- reply: رد مصري لطيف (سطرين-3)
- slots: استخرج لو تقدر:
  product: tshirt|hoodie|shirt|pants|null
  color: لون عربي من الموجود في الكتالوج أو null
  size: M|L|XL|2XL|null
  cityBucket: cairoGiza|otherGovernorates|null

شكل JSON:
{
  "reply": "string",
  "slots": { "product": null, "color": null, "size": null, "cityBucket": null }
}

الكتالوج:
${JSON.stringify(catalog, null, 2)}

آخر 6 رسائل:
${JSON.stringify(session.history.slice(-6), null, 2)}

رسالة العميل:
"${userText}"
`.trim();
}

function safeExtractJSON(text) {
  if (!text) return null;
  const s = String(text).trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  const candidate = s.slice(first, last + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

/**
 * ================== Main ==================
 */
export async function salesReply({ botId = "clothes", senderId, text, pageAccessToken, redis, mid }) {
  if (!senderId || !text?.trim()) return;

  const already = await dedupCheck(redis, botId, mid);
  if (already) return;

  const catalog = DEFAULT_CATALOG;

  let session = ensureSessionShape((await getSession(senderId, botId, redis)) || createDefaultSession());
  fillSlotsFromText(session, text, catalog);

  // FAQ first (اختياري)
  const cached = await getCachedFAQ(redis, botId, text);
  if (cached) {
    session.history.push({ user: text, bot: cached });
    await setSession(senderId, botId, session, redis);
    await sendText(senderId, cached, pageAccessToken);
    return;
  }

  // greeting
  if (looksLikeGreeting(text)) {
    const reply = `وعليكم السلام 😊 أهلًا بيك في ${catalog.brandName} 👋 تحب تشوف إيه النهارده؟`;
    session.history.push({ user: text, bot: reply });
    await setSession(senderId, botId, session, redis);
    await sendText(senderId, reply, pageAccessToken);
    await saveFAQ(redis, botId, text, reply);
    return;
  }

  // once slots complete -> checkout stage
  if (slotsReadyForCheckout(session)) session.stage = "checkout";

  // checkout stage
  if (session.stage === "checkout") {
    const reply = await handleCheckout(session, text, catalog);
    session.history.push({ user: text, bot: reply });
    await setSession(senderId, botId, session, redis);
    await sendText(senderId, reply, pageAccessToken);
    await saveFAQ(redis, botId, text, reply);
    return;
  }

  // AI stage (Gemini handles the “deal”)
  let replyText = null;

  if (ai) {
    try {
      const prompt = buildGeminiPrompt({ catalog, session, userText: text });
      const resp = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt
      });

      const raw = resp?.text || "";
      const parsed = safeExtractJSON(raw);

      if (parsed?.reply) replyText = parsed.reply;

      const gs = parsed?.slots || {};
      if (gs.product) session.slots.product = gs.product;
      if (gs.color) session.slots.color = normalizeArabic(gs.color);
      if (gs.size) session.slots.size = String(gs.size).toUpperCase();
      if (gs.cityBucket) session.slots.cityBucket = gs.cityBucket;

      if (slotsReadyForCheckout(session)) {
        session.stage = "checkout";
        const sum = checkoutSummary(session, catalog);
        replyText =
          replyText ||
          `تمام ✅ اخترنا ${sum.productName} (${sum.colorLabel}) مقاس ${sum.size}. ابعتلي الاسم + رقم الموبايل + العنوان عشان أكد الأوردر 😊`;
      }
    } catch (e) {
      console.error("⚠️ Gemini failed:", e?.message || e);
      replyText = null;
    }
  }

  if (!replyText) {
    // fallback ذكي: سؤال واحد حسب الناقص
    const p = session.slots.product ? catalog.categories[session.slots.product] : null;

    if (!session.slots.product) replyText = `تحب تشوف إيه من المتاح؟ (تيشيرت/هودي/قميص/بنطلون) 😊`;
    else if (!session.slots.color) replyText = `تمام 😊 تحب أنهي لون في ${p.name}؟ المتاح: ${p.colors.join("، ")}`;
    else if (!session.slots.size) replyText = `جميل 😊 تحب أنهي مقاس؟ المتاح: ${p.sizes.join(" / ")}`;
    else replyText = `تمام 😊`;
  }

  session.history.push({ user: text, bot: replyText });
  await setSession(senderId, botId, session, redis);
  await sendText(senderId, replyText, pageAccessToken);
  await saveFAQ(redis, botId, text, replyText);
}
