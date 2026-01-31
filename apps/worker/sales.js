// apps/worker/sales.js
import dotenv from "dotenv";
import axios from "axios";
import crypto from "crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";

import { getSession, setSession, createDefaultSession } from "./session.js";

dotenv.config();

/**
 * ================== Catalog (clothes bot) ==================
 * تقدر بعدين تخليه per-bot من Redis.
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
  notes: [
    "الأسعار بالجنيه المصري.",
    "لو محتاج مساعدة في المقاس: قولي وزنك وطولك وعايزه واسع ولا مظبوط.",
  ],
};

/**
 * ================== Gemini Setup ==================
 * مهم: استخدم موديل حديث. (مثال رسمي: gemini-2.5-flash)  1
 */
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

let model = null;

if (GEMINI_API_KEY) {
  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    console.log(`🤖 Gemini ready: ${GEMINI_MODEL}`);
  } catch (e) {
    console.error("❌ Gemini init failed:", e?.message || e);
  }
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
 * ================== Small utils ==================
 */
function normalizeArabic(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/[إأآا]/g, "ا")
    .replace(/[ى]/g, "ي")
    .replace(/[ؤ]/g, "و")
    .replace(/[ئ]/g, "ي")
    .replace(/[ة]/g, "ه")
    .replace(/[ًٌٍَُِّْـ]/g, "") // تشكيل
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
    s.includes("أهلا") ||
    s.includes("هاي") ||
    s.includes("hi")
  );
}

function isFAQishQuestion(t) {
  const s = normalizeArabic(t);
  // أسئلة متكررة غالبًا
  const keys = [
    "سعر",
    "بكام",
    "الشحن",
    "توصيل",
    "المحافظات",
    "القاهره",
    "الجيزه",
    "الالوان",
    "اللون",
    "المقاس",
    "مقاسات",
    "خامه",
    "خامة",
    "متاح",
    "موجود",
  ];
  return keys.some((k) => s.includes(normalizeArabic(k)));
}

function detectProduct(text) {
  const s = normalizeArabic(text);
  if (s.includes("تيشير") || s.includes("تي شير") || s.includes("tshirt")) return "tshirt";
  if (s.includes("هودي") || s.includes("hoodie")) return "hoodie";
  if (s.includes("قميص") || s.includes("shirt")) return "shirt";
  if (s.includes("بنطلون") || s.includes("pantalon") || s.includes("pants")) return "pants";
  return null;
}

function detectGovernorateBucket(text) {
  const s = normalizeArabic(text);
  if (s.includes("القاهره") || s.includes("القاهرة") || s.includes("الجيزه") || s.includes("الجيزة")) {
    return "cairoGiza";
  }
  // لو قال "محافظات" أو "اسيوط" الخ… اعتبرها محافظات
  if (s.includes("محافظ") || s.includes("اسيوط") || s.includes("أسيوط")) return "otherGovernorates";
  return null;
}

/**
 * ================== FAQ Cache (Redis) ==================
 * key: egboot:faq:<botId>  (HASH)
 * field: sha1(normalizedQuestion)
 * value: answerText
 */
async function getCachedFAQ(redis, botId, userText) {
  if (!redis) return null;
  const nq = normalizeArabic(userText);
  if (!nq) return null;

  const key = `egboot:faq:${botId}`;
  const field = sha1(nq);
  try {
    const val = await redis.hget(key, field);
    return val || null;
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
    // optional: expire بعد 30 يوم
    await redis.expire(key, 60 * 60 * 24 * 30);
  } catch (e) {
    console.error("❌ FAQ hset error:", e?.message || e);
  }
}

/**
 * ================== Prompt ==================
 * شخصية ألطف + ما تفرضش
 */
function buildPrompt({ brandName, text, session, catalog }) {
  return `
أنت موظف مبيعات شاطر ولطيف في متجر ملابس اسمه "${brandName}".
بتتكلم "عربي مصري" بطريقة مهذبة ومريحة، وتستخدم إيموجي بسيطة 😊 (بدون مبالغة).

قواعد مهمة جدًا:
- ما تبدأش كلام من نفسك. ردّ فقط على رسالة العميل الحالية.
- لو العميل قال "السلام عليكم" أو تحية: رد بتحية لطيفة الأول.
- ما تفرضش على العميل قرارات (ممنوع: "لازم تختار المقاس دلوقتي").
- خليك مساعد: قدّم اختيارات + سؤال واحد بسيط في الآخر.
- إجابات قصيرة وواضحة (سطرين–3 بالكتير).
- لو السؤال عن شحن/سعر/ألوان/مقاسات/خامة: جاوب مباشرة من البيانات.

بيانات المتجر:
${JSON.stringify(catalog, null, 2)}

سياق المحادثة (للفهم فقط):
${JSON.stringify(session, null, 2)}

رسالة العميل:
"${text}"

اكتب الرد الآن:
`;
}

/**
 * ================== Fast rule-based answers ==================
 * عشان الحاجات الواضحة من غير Gemini (وممكن Gemini يكمل للباقي)
 */
function ruleAnswer(text, catalog) {
  const s = normalizeArabic(text);

  // الشحن
  if (s.includes("شحن") || s.includes("توصيل")) {
    const bucket = detectGovernorateBucket(text);
    if (bucket === "cairoGiza") {
      return `تمام 😊 شحن القاهرة والجيزة ${catalog.shipping.cairoGiza} جنيه. تحب الشحن فين بالظبط؟`;
    }
    if (bucket === "otherGovernorates" || s.includes("محافظ")) {
      return `تمام 😊 شحن المحافظات ${catalog.shipping.otherGovernorates} جنيه. تحب الشحن لأي محافظة؟`;
    }
    return `الشحن: القاهرة/الجيزة ${catalog.shipping.cairoGiza} جنيه — باقي المحافظات ${catalog.shipping.otherGovernorates} جنيه 😊 تحب الشحن فين؟`;
  }

  // أسعار
  if (s.includes("سعر") || s.includes("بكام") || s.includes("بكم")) {
    const lines = Object.values(catalog.categories)
      .map((c) => `• ${c.name}: ${c.price} جنيه`)
      .join("\n");
    return `أكيد 😊 دي الأسعار:\n${lines}\nتحب أنهي منتج؟`;
  }

  // متاح إيه؟
  if (s.includes("المتاح") || s.includes("موجود") || s.includes("عندكم اي") || s.includes("عندكو اي")) {
    const items = Object.values(catalog.categories).map((c) => c.name).join("، ");
    return `أهلًا بيك 😊 المتاح عندنا حاليًا: ${items}. تحب تشوف أنهي واحد؟`;
  }

  // لو ذكر منتج + لون/مقاس
  const prodKey = detectProduct(text);
  if (prodKey) {
    const p = catalog.categories[prodKey];
    if (!p) return null;

    // ألوان
    if (s.includes("الوان") || s.includes("ألوان") || s.includes("لون")) {
      return `ألوان ${p.name} المتاحة: ${p.colors.join("، ")} 😊 تحب أنهي لون؟`;
    }

    // مقاسات
    if (s.includes("مقاس") || s.includes("مقاسات") || s.includes("xl") || s.includes("xxl") || s.includes("2xl")) {
      return `مقاسات ${p.name} المتاحة: ${p.sizes.join(" / ")} 😊 تحب أنهي مقاس؟`;
    }

    // خامة
    if (s.includes("خامه") || s.includes("خامة") || s.includes("جوده") || s.includes("جودة")) {
      return `خامة ${p.name}: ${p.material} 😊 تحب أساعدك تختار مقاس؟`;
    }
  }

  return null;
}

/**
 * ================== Main Entry ==================
 */
export async function salesReply({ botId = "clothes", senderId, text, pageAccessToken, redis }) {
  if (!senderId || !text?.trim()) return;

  // 1) session
  let session = (await getSession(senderId, botId, redis)) || createDefaultSession();

  // 2) catalog (later: per botId from Redis)
  const catalog = DEFAULT_CATALOG;

  // 3) Greeting handling (رد تحية محترم)
  if (looksLikeGreeting(text)) {
    const reply = `وعليكم السلام 😊 أهلًا بيك! تحب تشوف المتاح ولا عندك منتج في بالك؟`;
    session.history.push({ user: text, bot: reply });
    await setSession(senderId, botId, session, redis);
    await sendText(senderId, reply, pageAccessToken);
    return;
  }

  // 4) FAQ cache (لو السؤال اتسأل قبل كده)
  const cached = await getCachedFAQ(redis, botId, text);
  if (cached) {
    session.history.push({ user: text, bot: cached });
    await setSession(senderId, botId, session, redis);
    await sendText(senderId, cached, pageAccessToken);
    return;
  }

  // 5) rule-based quick answer (لو واضح من غير Gemini)
  const quick = ruleAnswer(text, catalog);
  if (quick) {
    session.history.push({ user: text, bot: quick });
    await setSession(senderId, botId, session, redis);

    // احفظه كـ FAQ (عشان ده غالبًا سؤال متكرر)
    await saveFAQ(redis, botId, text, quick);

    await sendText(senderId, quick, pageAccessToken);
    return;
  }

  // 6) Gemini (للأسئلة اللي مش في البرومبت/مش واضحة)
  let replyText = null;

  if (model) {
    const prompt = buildPrompt({ brandName: catalog.brandName, text, session, catalog });

    try {
      const result = await model.generateContent(prompt);
      replyText = result?.response?.text?.() || null;
    } catch (e) {
      console.error("⚠️ Gemini failed:", e?.message || e);
      replyText = null;
    }
  }

  // 7) fallback محترم لو Gemini وقع
  if (!replyText) {
    replyText = `تمام 😊 قولي بس: عايز أنهي منتج (تيشيرت/هودي/قميص/بنطلون) + اللون اللي بتحبه؟`;
  }

  // 8) update session
  session.history.push({ user: text, bot: replyText });
  await setSession(senderId, botId, session, redis);

  // 9) save to FAQ لو السؤال متكرر غالبًا
  if (isFAQishQuestion(text)) {
    await saveFAQ(redis, botId, text, replyText);
  }

  // 10) send
  await sendText(senderId, replyText, pageAccessToken);
}
