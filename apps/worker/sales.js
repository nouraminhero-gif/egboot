// apps/worker/sales.js
import dotenv from "dotenv";
import axios from "axios";
import crypto from "crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";

import { getSession, setSession, createDefaultSession } from "./session.js";

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
  notes: [
    "الأسعار بالجنيه المصري.",
    "لو محتاج مساعدة في المقاس: قولي وزنك وطولك وعايزه واسع ولا مظبوط.",
  ],
};

/**
 * ================== Gemini Setup ==================
 * ✅ بدون ping / بدون fallback loops
 * ✅ موديل ثابت مضمون
 */
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";

let model = null;

if (GEMINI_API_KEY) {
  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    console.log(`🤖 Gemini ready: ${GEMINI_MODEL}`);
  } catch (e) {
    console.error("❌ Gemini init failed:", e?.message || e);
    model = null;
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
    s.includes("أهلا") ||
    s.includes("هاي") ||
    s.includes("hi")
  );
}

function isFAQishQuestion(t) {
  const s = normalizeArabic(t);
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
  if (s.includes("محافظ") || s.includes("اسيوط") || s.includes("أسيوط")) return "otherGovernorates";
  return null;
}

/**
 * ================== Dedup (avoid repeated replies) ==================
 * key: egboot:dedup:<botId>:<mid> => "1" (TTL 60s)
 */
async function dedupCheck(redis, botId, mid) {
  if (!redis || !mid) return false;
  const key = `egboot:dedup:${botId}:${mid}`;
  try {
    const res = await redis.set(key, "1", "NX", "EX", 60);
    return res !== "OK"; // لو مش OK يبقى اتعالج قبل كده
  } catch (e) {
    console.error("❌ dedup redis error:", e?.message || e);
    return false;
  }
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
    await redis.expire(key, 60 * 60 * 24 * 30);
  } catch (e) {
    console.error("❌ FAQ hset error:", e?.message || e);
  }
}

/**
 * ================== Prompt (شخصية ألطف) ==================
 */
function buildPrompt({ brandName, text, session, catalog }) {
  return `
أنت موظف مبيعات شاطر ولطيف في متجر ملابس اسمه "${brandName}".
بتتكلم باللهجة المصرية، وبأسلوب محترم وخفيف، وإيموجي بسيطة 😊.

قواعد مهمّة جدًا:
- رد فقط على رسالة العميل الحالية.
- ممنوع تبدأ كلام لوحدك.
- لو العميل بدأ بتحية: رد تحية لطيفة الأول (من غير ما تدخل في بيع فورًا).
- ممنوع تفرض قرار أو تقول "لازم".
- خليك مُساعد: قدم معلومة + سؤال واحد بسيط في الآخر.
- ردود قصيرة وواضحة (2-3 سطور).

بيانات المتجر:
${JSON.stringify(catalog, null, 2)}

سياق مختصر للمحادثة:
${JSON.stringify(session?.history?.slice?.(-6) || session, null, 2)}

رسالة العميل:
"${text}"

اكتب رد واحد فقط:
`;
}

/**
 * ================== Rule-based quick answers ==================
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

  // الأسعار
  if (s.includes("سعر") || s.includes("بكام") || s.includes("بكم")) {
    const lines = Object.values(catalog.categories)
      .map((c) => `• ${c.name}: ${c.price} جنيه`)
      .join("\n");
    return `أكيد 😊 دي الأسعار:\n${lines}\nتحب أنهي منتج؟`;
  }

  // المتاح
  if (s.includes("المتاح") || s.includes("موجود") || s.includes("عندكم اي") || s.includes("عندكو اي")) {
    const items = Object.values(catalog.categories).map((c) => c.name).join("، ");
    return `أهلًا بيك 😊 المتاح عندنا حاليًا: ${items}. تحب تشوف أنهي واحد؟`;
  }

  // منتج محدد
  const prodKey = detectProduct(text);
  if (prodKey) {
    const p = catalog.categories[prodKey];
    if (!p) return null;

    if (s.includes("الوان") || s.includes("ألوان") || s.includes("لون")) {
      return `ألوان ${p.name} المتاحة: ${p.colors.join("، ")} 😊 تحب أنهي لون؟`;
    }

    if (s.includes("مقاس") || s.includes("مقاسات") || s.includes("xl") || s.includes("xxl") || s.includes("2xl")) {
      return `مقاسات ${p.name} المتاحة: ${p.sizes.join(" / ")} 😊 تحب أنهي مقاس؟`;
    }

    if (s.includes("خامه") || s.includes("خامة") || s.includes("جوده") || s.includes("جودة")) {
      return `خامة ${p.name}: ${p.material} 😊 تحب أساعدك تختار مقاس؟`;
    }
  }

  return null;
}

/**
 * ================== Main Entry ==================
 */
export async function salesReply({ botId = "clothes", senderId, text, pageAccessToken, redis, mid }) {
  if (!senderId || !text?.trim()) return;

  // ✅ dedup
  const isDup = await dedupCheck(redis, botId, mid);
  if (isDup) {
    console.log("🟣 dedup: skipped duplicate mid:", mid);
    return;
  }

  // ✅ session
  let session = (await getSession(senderId, botId, redis)) || createDefaultSession();
  const catalog = DEFAULT_CATALOG;

  // ✅ تحية أول الرسالة
  if (looksLikeGreeting(text)) {
    const reply = `وعليكم السلام 😊 أهلًا بيك في ${catalog.brandName} 👋`;
    session.history.push({ user: text, bot: reply });
    await setSession(senderId, botId, session, redis);
    await sendText(senderId, reply, pageAccessToken);
    return;
  }

  // ✅ FAQ cache
  const cached = await getCachedFAQ(redis, botId, text);
  if (cached) {
    session.history.push({ user: text, bot: cached });
    await setSession(senderId, botId, session, redis);
    await sendText(senderId, cached, pageAccessToken);
    return;
  }

  // ✅ rule quick
  const quick = ruleAnswer(text, catalog);
  if (quick) {
    session.history.push({ user: text, bot: quick });
    await setSession(senderId, botId, session, redis);
    await saveFAQ(redis, botId, text, quick);
    await sendText(senderId, quick, pageAccessToken);
    return;
  }

  // ✅ Gemini
  let replyText = null;

  if (model) {
    const prompt = buildPrompt({ brandName: catalog.brandName, text, session, catalog });

    try {
      const result = await model.generateContent(prompt);
      replyText = result?.response?.text?.() || null;
      console.log("🧠 Gemini used:", GEMINI_MODEL);
    } catch (e) {
      console.error("⚠️ Gemini failed:", e?.message || e);
      replyText = null;
    }
  } else {
    console.warn("⚠️ Gemini disabled/unavailable.");
  }

  // ✅ fallback
  if (!replyText) {
    replyText = `تمام 😊 تحب تشوف إيه من المتاح؟ (تيشيرت/هودي/قميص/بنطلون)`;
  }

  // ✅ save session + faq
  session.history.push({ user: text, bot: replyText });
  await setSession(senderId, botId, session, redis);

  if (isFAQishQuestion(text)) {
    await saveFAQ(redis, botId, text, replyText);
  }

  await sendText(senderId, replyText, pageAccessToken);
}
