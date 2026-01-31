// apps/worker/sales.js
import dotenv from "dotenv";
import axios from "axios";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getSession, setSession, createDefaultSession } from "./session.js";
import crypto from "crypto";

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

// ======= Catalog (default bot: clothes) =======
const defaultCatalog = {
  categories: {
    tshirt: {
      name: "تيشيرت",
      price: 299,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أسود", "أبيض", "كحلي", "رمادي", "بيج"],
      material: "قطن مريح مناسب للصيف والاستخدام اليومي",
    },
    hoodie: {
      name: "هودي",
      price: 599,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أسود", "رمادي", "كحلي", "بيج", "أوف وايت"],
      material: "خامة دافية ومناسبة للشتا",
    },
    shirt: {
      name: "قميص",
      price: 499,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أسود", "أبيض", "كحلي", "رمادي", "بيج"],
      material: "قماش عملي للمشاوير والشغل",
    },
    pants: {
      name: "بنطلون",
      price: 549,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أسود", "كحلي", "رمادي", "بيج", "زيتي"],
      material: "خامة مريحة وتعيش معاك",
    },
  },
  shipping: {
    cairo_giza: 70,
    other_governorates: 90,
  },
};

// ======= Persona (default) =======
const defaultPersona = {
  tone: "لطيف ورايق",
  greeting: "أهلًا بيك 👋",
  styleRules: [
    "اسأل سؤال واحد بس في كل رسالة",
    "ماتفرضش (لازم تختار) — خليك مرن",
    "اقترح بلُطف وباختيارات واضحة",
    "استخدم إيموجي خفيف (1-2)",
  ],
};

// ======= Gemini Setup =======
let model = null;
if (GEMINI_API_KEY) {
  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    // ✅ موديل ثابت شغال غالبًا
    model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    console.log("🤖 Gemini ready: gemini-1.5-flash");
  } catch (e) {
    console.error("❌ Gemini init failed:", e?.message || e);
  }
} else {
  console.warn("⚠️ GEMINI_API_KEY missing. Gemini disabled.");
}

// ======= FB Send =======
async function sendText(psid, text, token) {
  if (!psid || !token) return;

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

// ======= Helpers =======
function normalizeQuestion(q) {
  return (q || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, ""); // remove punctuation
}

function hashKey(s) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

function faqKey(botId, questionNorm) {
  return `egboot:faq:${botId}:${hashKey(questionNorm)}`;
}

async function getFAQ(redis, botId, questionNorm) {
  if (!redis) return null;
  try {
    const raw = await redis.get(faqKey(botId, questionNorm));
    return raw || null;
  } catch {
    return null;
  }
}

async function setFAQ(redis, botId, questionNorm, answer) {
  if (!redis) return;
  try {
    // TTL 30 يوم
    await redis.set(faqKey(botId, questionNorm), answer, "EX", 60 * 60 * 24 * 30);
  } catch {}
}

function getShippingText() {
  return `الشحن: القاهرة والجيزة ${defaultCatalog.shipping.cairo_giza} جنيه، وباقي المحافظات ${defaultCatalog.shipping.other_governorates} جنيه.`;
}

function listProductsShort() {
  const c = defaultCatalog.categories;
  return `المتاح دلوقتي: ${c.tshirt.name} (${c.tshirt.price})، ${c.hoodie.name} (${c.hoodie.price})، ${c.shirt.name} (${c.shirt.price})، ${c.pants.name} (${c.pants.price}).`;
}

// ======= Prompt =======
function buildPrompt({ persona, catalog, session, text }) {
  const products = Object.values(catalog.categories).map((p) => ({
    name: p.name,
    price: p.price,
    sizes: p.sizes,
    colors: p.colors,
    material: p.material,
  }));

  return `
أنت موظف مبيعات شاطر جدًا لبراند ملابس في مصر.
الهدف: تساعد العميل يختار بسرعة وبأسلوب لطيف، وتجاوب على الأسئلة بوضوح.

قواعد أسلوبك:
- ابدأ بتحية لطيفة لو دي أول رسالة من العميل أو العميل قال "السلام عليكم/هاي".
- متقولش "لازم" و متضغطش على العميل.
- اسأل سؤال واحد بس في آخر الرسالة لو محتاج معلومة.
- ردود قصيرة (سطرين بالكتير).
- استخدم 1-2 ايموجي فقط.

معلومات المتجر:
- ${getShippingText()}
- المقاسات المتاحة عمومًا: M / L / XL / 2XL
- الألوان: 5 ألوان حسب المنتج
- المنتجات المتاحة: ${products.map((p) => p.name).join("، ")}

حالة المحادثة الحالية (للاسترشاد):
${JSON.stringify(session, null, 2)}

رسالة العميل:
"${text}"

اكتب ردك باللهجة المصرية.
`;
}

// ======= Simple fallback (لو Gemini وقع) =======
function fallbackReply(text, session) {
  const t = (text || "").toLowerCase();

  // تحية
  if (t.includes("السلام") || t.includes("اهلا") || t.includes("hi") || t.includes("hello")) {
    return `أهلًا بيك 👋 تحب تشوف المتاح ولا عندك منتج معين في بالك؟`;
  }

  // شحن
  if (t.includes("شحن") || t.includes("التوصيل") || t.includes("محافظات") || t.includes("القاهرة") || t.includes("الجيزة")) {
    return `${getShippingText()} تحب الشحن يبقى على أنهي محافظة؟ 🙂`;
  }

  // المتاح
  if (t.includes("الموجود") || t.includes("المتاح") || t.includes("عندكم ايه")) {
    return `${listProductsShort()} تحب تيشيرت ولا هودي ولا قميص ولا بنطلون؟ 🙂`;
  }

  // خامة / جودة
  if (t.includes("خامة") || t.includes("جودة") || t.includes("تقيل") || t.includes("قطن")) {
    return `الخامة عندنا مريحة وعمليّة ❤️ تحب المنتج يكون صيفي (تيشيرت/قميص) ولا شتوي (هودي)؟`;
  }

  return `تمام 👌 قولّي بس إنت عايز (تيشيرت/هودي/قميص/بنطلون) وإيه اللون اللي بتحبه؟`;
}

// ======= Main Entry =======
export async function salesReply({ botId = "clothes", senderId, text, pageAccessToken, redis }) {
  // حماية
  if (!senderId || !text?.trim()) {
    console.warn("⚠️ salesReply missing senderId/text");
    return;
  }

  // Session
  let session = (await getSession(botId, senderId)) || createDefaultSession();

  // ✅ ممنوع البوت يبدأ كلام من نفسه
  // هنا احنا بنرد فقط على رسالة العميل

  const questionNorm = normalizeQuestion(text);

  // 1) FAQ cache first
  const cached = await getFAQ(redis, botId, questionNorm);
  if (cached) {
    // update session
    session.history.push({ user: text, bot: cached, cached: true, at: Date.now() });
    session.updatedAt = Date.now();
    session.firstMessageSeen = true;
    await setSession(botId, senderId, session);
    await sendText(senderId, cached, pageAccessToken);
    return;
  }

  // 2) Gemini
  const persona = defaultPersona;
  const catalog = defaultCatalog;

  let replyText = null;

  if (model) {
    try {
      const prompt = buildPrompt({ persona, catalog, session, text });
      const result = await model.generateContent(prompt);
      replyText = result?.response?.text?.() || null;
    } catch (e) {
      console.error("⚠️ Gemini failed:", e?.message || e);
    }
  }

  // 3) fallback
  if (!replyText) {
    replyText = fallbackReply(text, session);
  } else {
    // 4) learn -> save FAQ answer
    await setFAQ(redis, botId, questionNorm, replyText);
  }

  // 5) update session
  session.history.push({ user: text, bot: replyText, at: Date.now() });
  session.firstMessageSeen = true;
  await setSession(botId, senderId, session);

  // 6) send
  await sendText(senderId, replyText, pageAccessToken);
}
