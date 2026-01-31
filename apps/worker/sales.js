// apps/worker/sales.js
import dotenv from "dotenv";
import axios from "axios";
import crypto from "crypto";

import { getSession as _getSession, setSession as _setSession, createDefaultSession } from "./session.js";

// ✅ NEW SDK (recommended by official docs)
import { GoogleGenAI } from "@google/genai";

dotenv.config();

/**
 * ================== Catalog (clothes bot) ==================
 */
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

/**
 * ================== Gemini Setup (v1) ==================
 * Docs show usage via @google/genai and model like gemini-2.5-flash 1
 */
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

let ai = null;
if (GEMINI_API_KEY) {
  ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  console.log(`🤖 Gemini client ready (model default: ${GEMINI_MODEL})`);
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

function looksLikeGreeting(t) {
  const s = normalizeArabic(t);
  return s.includes("السلام عليكم") || s === "سلام" || s.includes("اهلا") || s.includes("هاي") || s.includes("hi");
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
    if (s.includes(c)) return c; // normalized
  }
  return null;
}

function extractSize(text) {
  const s = normalizeArabic(text).toUpperCase();
  // size patterns
  const m = /(^|\s)(2XL|XXL|XL|L|M|S)(\s|$)/i.exec(text);
  if (m?.[2]) return m[2].toUpperCase();
  return null;
}

function detectGovernorateBucket(text) {
  const s = normalizeArabic(text);
  if (s.includes("القاهره") || s.includes("الجيزه")) return "cairoGiza";
  return "otherGovernorates";
}

function extractPhone(text) {
  const digits = String(text).replace(/[^\d]/g, "");
  // Egypt-like 11 digits, or any 10-15 digits
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
 * ================== FAQ Cache (learn from answers) ==================
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
 * ================== “Smart flow” logic ==================
 * stage:
 * - ai: Gemini opens/handles conversation + fills slots
 * - checkout: deterministic bot collects customer data & confirms order
 */
function ensureSessionShape(session) {
  session.history = session.history || [];
  session.stage = session.stage || "ai";
  session.slots = session.slots || {
    product: null,
    color: null, // normalized
    size: null,
    cityBucket: null,
    customerName: null,
    phone: null,
    address: null,
  };
  return session;
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
    size,
  };
}

/**
 * ================== Gemini prompt (returns STRICT JSON) ==================
 */
function buildGeminiPrompt({ catalog, session, userText }) {
  // NOTE: Gemini هنا “بيبدأ الديل” من ناحية أسلوب الكلام، بس الرد بيطلع بعد رسالة العميل (Messenger rules)
  return `
أنت موظف مبيعات مصري شاطر وودود لمتجر ملابس اسمه "${catalog.brandName}".

هدفك:
1) ترد على رسالة العميل رد طبيعي ولطيف.
2) تستخرج من كلام العميل إن أمكن:
- product: (tshirt|hoodie|shirt|pants|null)
- color: لون عربي موجود في الكتالوج أو null
- size: (M|L|XL|2XL|null)
- cityBucket: (cairoGiza|otherGovernorates|null) لو العميل ذكر محافظة/قاهرة/جيزة

مهم جدًا:
- متكتبش غير JSON فقط (بدون أي نص خارجه).
- JSON بالشكل ده بالظبط:
{
  "reply": "string",
  "slots": { "product": "...", "color": "...", "size": "...", "cityBucket": "..." }
}

بيانات الكتالوج:
${JSON.stringify(catalog, null, 2)}

سياق سابق مختصر:
${JSON.stringify(session.history.slice(-6), null, 2)}

رسالة العميل:
"${userText}"
`;
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
 * ================== deterministic slot filling (pre-gemini) ==================
 * عشان نحسن “قميص اسود” وما يلفّش في دايرة
 */
function fillSlotsFromText(session, text, catalog) {
  const prod = detectProduct(text);
  const colorNorm = extractColor(text, catalog);
  const size = extractSize(text);

  if (prod && !session.slots.product) session.slots.product = prod;
  if (colorNorm && !session.slots.color) session.slots.color = colorNorm;
  if (size && !session.slots.size) session.slots.size = size;

  // city bucket
  const s = normalizeArabic(text);
  if ((s.includes("القاهره") || s.includes("الجيزه") || s.includes("محافظ")) && !session.slots.cityBucket) {
    session.slots.cityBucket = detectGovernorateBucket(text);
  }

  // phone
  const phone = extractPhone(text);
  if (phone && !session.slots.phone) session.slots.phone = phone;
}

function slotsReadyForCheckout(session) {
  const { product, color, size } = session.slots;
  return Boolean(product && color && size);
}

function nextQuestionForSlots(session, catalog) {
  const { product, color, size } = session.slots;

  if (!product) return `تحب تشوف إيه من المتاح؟ (تيشيرت/هودي/قميص/بنطلون) 😊`;

  const p = catalog.categories[product];

  if (!color) return `تمام 😊 تحب أنهي لون في ${p.name}؟ المتاح: ${p.colors.join("، ")}`;

  if (!size) return `جميل 😊 تحب أنهي مقاس؟ المتاح: ${p.sizes.join(" / ")}`;

  return null;
}

async function handleCheckout(session, text, catalog) {
  // collect name/address/phone
  const s = normalizeArabic(text);

  if (!session.slots.customerName && (s.includes("اسمي") || s.includes("انا") || text.trim().length <= 25)) {
    // محاولة بسيطة: خزن الاسم لو الرسالة قصيرة وغالبًا اسم
    // (تقدر تطورها بعدين)
    if (text.trim().length >= 3 && text.trim().length <= 30) session.slots.customerName = text.trim();
  }

  if (!session.slots.address && (s.includes("عنوان") || s.includes("شارع") || s.includes("ميدان") || text.trim().length > 25)) {
    session.slots.address = text.trim();
  }

  const phone = extractPhone(text);
  if (phone && !session.slots.phone) session.slots.phone = phone;

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
 * ================== Main Entry ==================
 */
export async function salesReply({ botId = "clothes", senderId, text, pageAccessToken, redis, mid }) {
  if (!senderId || !text?.trim()) return;

  const already = await dedupCheck(redis, botId, mid);
  if (already) return;

  const catalog = DEFAULT_CATALOG;

  let session = ensureSessionShape((await getSession(senderId, botId, redis)) || createDefaultSession());
  fillSlotsFromText(session, text, catalog);

  // ✅ FAQ first
  const cached = await getCachedFAQ(redis, botId, text);
  if (cached) {
    session.history.push({ user: text, bot: cached });
    await setSession(senderId, botId, session, redis);
    await sendText(senderId, cached, pageAccessToken);
    return;
  }

  // ✅ If greeting: Gemini-style greeting (بس رد على رسالة العميل)
  if (looksLikeGreeting(text)) {
    // نخليها بسيطة جدًا
    const reply = `وعليكم السلام 😊 أهلًا بيك في ${catalog.brandName} 👋 تحب تدور على إيه النهارده؟`;
    session.history.push({ user: text, bot: reply });
    await setSession(senderId, botId, session, redis);
    await sendText(senderId, reply, pageAccessToken);
    await saveFAQ(redis, botId, text, reply);
    return;
  }

  // ✅ Switch to checkout once slots complete
  if (slotsReadyForCheckout(session)) session.stage = "checkout";

  // ✅ Checkout stage (deterministic)
  if (session.stage === "checkout") {
    const reply = await handleCheckout(session, text, catalog);
    session.history.push({ user: text, bot: reply });
    await setSession(senderId, botId, session, redis);
    await sendText(senderId, reply, pageAccessToken);
    await saveFAQ(redis, botId, text, reply);
    return;
  }

  // ✅ AI stage: Gemini handles “opening the deal” + we still push slot questions smartly
  // لو لسه ناقص slots، اسأل سؤال واحد واضح بدل التكرار الغبي
  const slotQuestion = nextQuestionForSlots(session, catalog);

  // Gemini attempt (best)
  let replyText = null;
  if (ai) {
    try {
      const prompt = buildGeminiPrompt({ catalog, session, userText: text });
      const resp = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
      });

      const raw = resp?.text || "";
      const parsed = safeExtractJSON(raw);

      if (parsed?.reply) replyText = parsed.reply;

      // update slots from Gemini
      const gs = parsed?.slots || {};
      if (gs.product && !session.slots.product) session.slots.product = gs.product;
      if (gs.color && !session.slots.color) session.slots.color = normalizeArabic(gs.color);
      if (gs.size && !session.slots.size) session.slots.size = String(gs.size).toUpperCase();
      if (gs.cityBucket && !session.slots.cityBucket) session.slots.cityBucket = gs.cityBucket;

      // لو بعد Gemini اكتملت slots → checkout
      if (slotsReadyForCheckout(session)) {
        session.stage = "checkout";
        const sum = checkoutSummary(session, catalog);
        replyText =
          replyText ||
          `تمام ✅ اخترت ${sum.productName} (${sum.colorLabel}) مقاس ${sum.size}. ابعتلي الاسم + رقم الموبايل + العنوان عشان أكد الأوردر 😊`;
      }
    } catch (e) {
      console.error("⚠️ Gemini failed:", e?.message || e);
      replyText = null;
    }
  }

  // ✅ If Gemini not available / failed: ask next slot question (smart)
  if (!replyText) {
    replyText = slotQuestion || `تمام 😊 قولي تحب تيشيرت ولا هودي ولا قميص ولا بنطلون؟`;
  }

  session.history.push({ user: text, bot: replyText });
  await setSession(senderId, botId, session, redis);
  await sendText(senderId, replyText, pageAccessToken);

  // ✅ learn
  await saveFAQ(redis, botId, text, replyText);
}
