// apps/worker/sales.js
import dotenv from "dotenv";
import axios from "axios";
import Redis from "ioredis";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getSession, setSession, createDefaultSession } from "./session.js";

dotenv.config();

/**
 * =========================
 * ENV
 * =========================
 */
const PAGE_ACCESS_TOKEN_FALLBACK = process.env.PAGE_ACCESS_TOKEN || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
// مهم: ده اللي شغال غالباً مع @google/generative-ai على v1beta
const GEMINI_MODEL = process.env.GEMINI_MODEL || "models/gemini-pro";

const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL || "";

/**
 * =========================
 * Redis (FAQ Cache)
 * =========================
 * تخزين Q->A عشان لو اتكرر السؤال نرد فوراً بدون Gemini
 */
const faqRedis = REDIS_URL
  ? new Redis(REDIS_URL, {
      enableReadyCheck: false,
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        if (times > 10) return null;
        return Math.min(times * 500, 5000);
      },
    })
  : null;

const FAQ_PREFIX = "egboot:faq:"; // هيتعمل key لكل بوت/عميل
const FAQ_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 يوم

/**
 * =========================
 * Gemini
 * =========================
 */
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
 * =========================
 * Facebook Send
 * =========================
 */
async function sendText(psid, text, token) {
  const t = token || PAGE_ACCESS_TOKEN_FALLBACK;
  if (!psid || !t || !text) return;

  try {
    await axios.post(
      "https://graph.facebook.com/v18.0/me/messages",
      {
        recipient: { id: psid },
        messaging_type: "RESPONSE",
        message: { text: String(text).slice(0, 1900) },
      },
      { params: { access_token: t } }
    );
  } catch (e) {
    console.error("❌ FB send error:", e?.response?.data || e?.message || e);
  }
}

/**
 * =========================
 * Helpers
 * =========================
 */
function normalizeText(input) {
  if (!input) return "";
  let s = String(input).trim().toLowerCase();

  // إزالة تشكيل عربي (تقريبياً) + توحيد همزات بسيطة
  s = s
    .replace(/[\u0610-\u061A\u064B-\u065F\u06D6-\u06ED]/g, "")
    .replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");

  // إزالة رموز/ترقيم وتوحيد مسافات
  s = s.replace(/[^\p{L}\p{N}\s]/gu, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// ده يعتبر سؤال "عام" ينفع يتحفظ FAQ (مش بيانات شخصية)
function isFaqSafeToCache(text) {
  const t = normalizeText(text);

  // لو فيه طلب بيانات شخصية/عنوان/موبايل/اسم… مانحفظهوش
  const sensitiveHints = [
    "عنوان",
    "رقم",
    "موبايل",
    "تليفون",
    "اسم",
    "محافظه",
    "شارع",
    "عماره",
    "شقه",
    "واتساب",
  ];
  if (sensitiveHints.some((w) => t.includes(w))) return false;

  // أسئلة عامة: سعر/شحن/مقاسات/ألوان/متاح/خامة/استبدال… إلخ
  const faqHints = [
    "سعر",
    "بكام",
    "شحن",
    "توصيل",
    "مقاس",
    "مقاسات",
    "الوان",
    "لون",
    "متاح",
    "موجود",
    "خامه",
    "استبدال",
    "استرجاع",
    "الدفع",
    "كاش",
    "فيزا",
  ];
  return faqHints.some((w) => t.includes(w));
}

function makeFaqKey({ botId = "default", question }) {
  // botId مهم جداً عشان SaaS (كل بوت له ذاكرة مختلفة)
  const q = normalizeText(question);
  return `${FAQ_PREFIX}${botId}:${q}`;
}

async function getCachedAnswer({ botId, question }) {
  if (!faqRedis) return null;
  const key = makeFaqKey({ botId, question });
  try {
    const val = await faqRedis.get(key);
    return val || null;
  } catch (e) {
    console.error("❌ FAQ get error:", e?.message || e);
    return null;
  }
}

async function cacheAnswer({ botId, question, answer }) {
  if (!faqRedis) return;
  const key = makeFaqKey({ botId, question });
  try {
    await faqRedis.set(key, answer, "EX", FAQ_TTL_SECONDS);
  } catch (e) {
    console.error("❌ FAQ set error:", e?.message || e);
  }
}

function buildSystemPrompt({ catalog, persona }) {
  // catalog + persona المفروض ييجوا من tenant/config لاحقاً
  // هنا بنحطهم كحقائق + أسلوب الرد
  return `
أنت مساعد مبيعات عربي مصري لطيف وذكي.
أسلوبك:
- تبدأ بالترحيب فقط لو العميل سلّم أو أول رسالة منه، وماتفرضش اختيارات.
- اسأل سؤال واحد صغير في كل رد.
- خليك عملي، واضح، ومش تقيل.
- استخدم إيموجي خفيف جدًا (0-1) حسب السياق.
- ممنوع تقول "لازم" أو "عشان نكمل" أو تدي أوامر.

حقائق المتجر (Catalog):
${JSON.stringify(catalog || {}, null, 2)}

شخصية البياع (Persona):
${JSON.stringify(persona || {}, null, 2)}

قواعد:
- لو السؤال عن الشحن: اذكر (القاهرة/الجيزة 70) وباقي المحافظات 90.
- لو السؤال عن الألوان: اذكر إن عندنا 5 ألوان (اذكرهم لو موجودين).
- لو المقاسات: من M لحد 2XL حسب المنتج.
- لو حاجة مش متأكد منها: قل "هتأكدلك" واعرض بديل/سؤال.

الرد يكون من 1 إلى 3 جمل.
`;
}

function buildUserPrompt({ text, session }) {
  return `
رسالة العميل:
"${text}"

سياق مختصر (Session):
${JSON.stringify(
  {
    step: session?.step,
    order: session?.order,
    last3: (session?.history || []).slice(-3),
  },
  null,
  2
)}
`;
}

/**
 * Fallback محترم (مش "غبي")
 */
function fallbackReply(text) {
  const t = normalizeText(text);

  if (!t) return "أهلًا بيك 👋 تحب تسأل عن إيه بالظبط؟";

  if (t.includes("السلام") || t.includes("مرحبا") || t === "hi" || t === "hello") {
    return "أهلًا وسهلًا 👋 منوّر! تحب تشوف المتاح ولا تسأل عن سعر/شحن؟";
  }

  if (t.includes("شحن") || t.includes("توصيل")) {
    return "الشحن للقاهرة والجيزة 70 جنيه، وباقي المحافظات 90 جنيه 📦 تحب الشحن على أنهي محافظة؟";
  }

  if (t.includes("سعر") || t.includes("بكام")) {
    return "تمام 👌 تحب تسأل عن سعر أنهي منتج بالظبط؟ (تيشيرت/هودي/قميص/بنطلون)";
  }

  if (t.includes("مقاس") || t.includes("مقاسات")) {
    return "أكيد 👌 قولّي وزنك وطولك تقريبًا وأنا أرشحلك المقاس المناسب.";
  }

  return "تمام 👌 فهمت عليك… ممكن تقولّي محتاج تيشيرت ولا هودي ولا قميص ولا بنطلون؟";
}

/**
 * =========================
 * MAIN
 * =========================
 * ✅ بيرد فقط لما العميل يبعت (مش بيبدأ المحادثة من نفسه)
 */
export async function salesReply({
  senderId,
  text,
  pageAccessToken,
  // مهم للـ SaaS: ابعت botId/tenantId عشان الـ FAQ يبقى خاص بكل بوت
  botId = "nour-fashion",
  catalog = null,
  persona = null,
}) {
  try {
    const userText = (text ?? "").toString().trim();

    // حماية من خطأ toLowerCase على undefined
    if (!senderId || !userText) return;

    // 1) Session
    let session = (await getSession(senderId)) || createDefaultSession();

    // 2) FAQ Cache أولاً (لو سؤال عام متكرر)
    if (isFaqSafeToCache(userText)) {
      const cached = await getCachedAnswer({ botId, question: userText });
      if (cached) {
        // سجل وابعث
        session.history.push({ user: userText, bot: cached, from: "faq_cache" });
        await setSession(senderId, session);
        await sendText(senderId, cached, pageAccessToken);
        return;
      }
    }

    // 3) Gemini
    let replyText = null;

    if (model) {
      const sys = buildSystemPrompt({ catalog, persona });
      const usr = buildUserPrompt({ text: userText, session });

      // بنحط system + user جوه prompt واحد بسيط
      const prompt = `${sys}\n\n---\n\n${usr}`;

      try {
        const result = await model.generateContent(prompt);
        replyText = result?.response?.text?.() || null;

        // تنظيف بسيط
        if (replyText) replyText = replyText.trim();
      } catch (e) {
        console.error("⚠️ Gemini failed:", e?.message || e);
        replyText = null;
      }
    }

    // 4) Fallback
    if (!replyText) {
      replyText = fallbackReply(userText);
    }

    // 5) Save session
    session.history.push({ user: userText, bot: replyText, from: replyText ? "ai" : "fallback" });
    await setSession(senderId, session);

    // 6) Cache FAQ لو مناسب + Gemini نجح (أو حتى الرد النهائي)
    // (الأفضل نخزن بس لما Gemini اشتغل فعلاً، بس هنا هنخزن الرد النهائي طالما السؤال FAQ)
    if (isFaqSafeToCache(userText) && replyText) {
      await cacheAnswer({ botId, question: userText, answer: replyText });
    }

    // 7) Send
    await sendText(senderId, replyText, pageAccessToken);
  } catch (e) {
    console.error("❌ salesReply fatal:", e?.message || e);
  }
}
