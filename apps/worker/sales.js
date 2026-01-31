// apps/worker/sales.js
import dotenv from "dotenv";
import axios from "axios";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getSession, setSession, createDefaultSession } from "./session.js";

dotenv.config();

// ================== ENV ==================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash"; // ✅ خليها 1.5
const EMOJI_ENABLED = true;

// ================== Catalog (مؤقتًا هنا) ==================
// بعدين هنخليه لكل عميل في Redis زي ما اتفقنا
export const catalog = {
  categories: {
    tshirt: {
      name: "تيشيرت",
      price: 299,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أسود", "أبيض", "كحلي", "رمادي", "بيج"],
      material: "قطن تقيل مريح",
    },
    hoodie: {
      name: "هودي",
      price: 599,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أسود", "رمادي", "كحلي", "زيتي", "بيج"],
      material: "خامة دفا وتقفيل ممتاز",
    },
    shirt: {
      name: "قميص",
      price: 449,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أسود", "أبيض", "كحلي", "رمادي", "بيج"],
      material: "قماش عملي ومريح",
    },
    pants: {
      name: "بنطلون",
      price: 499,
      sizes: ["30", "32", "34", "36", "38"],
      colors: ["أسود", "كحلي", "رمادي", "بيج", "زيتي"],
      material: "خامة قوية ومريحة",
    },
  },
  shipping: {
    cairo_giza: 70,
    other_governorates: 90,
  },
};

// ================== Gemini Setup ==================
let model = null;

function buildGenAI() {
  if (!GEMINI_API_KEY) return null;
  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    return genAI;
  } catch (e) {
    console.error("❌ Gemini init failed:", e?.message || e);
    return null;
  }
}

async function initGeminiModel() {
  if (model) return model;

  const genAI = buildGenAI();
  if (!genAI) return null;

  // جرّب موديل واحد (القيمه من ENV) ولو وقع جرّب بدائل
  const candidates = [
    GEMINI_MODEL,
    "gemini-1.5-flash",
    "gemini-1.5-flash-latest",
    "gemini-1.5-pro",
    "gemini-1.5-pro-latest",
  ].filter(Boolean);

  for (const name of candidates) {
    try {
      const m = genAI.getGenerativeModel({ model: name });
      // ping صغير يثبت انه شغال
      await m.generateContent("ping");
      model = m;
      console.log("✅ Gemini ready:", name);
      return model;
    } catch (e) {
      console.warn("⚠️ Gemini model failed:", name, e?.message || e);
    }
  }

  console.warn("⚠️ Gemini disabled (no working model).");
  return null;
}

// ================== FB Send ==================
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

// ================== Helpers ==================
function normalize(text = "") {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGreeting(text) {
  const s = normalize(text);
  return (
    s.includes("السلام") ||
    s.includes("اهلا") ||
    s.includes("مرحبا") ||
    s === "hi" ||
    s === "hello"
  );
}

function listProducts() {
  const cats = catalog.categories || {};
  const lines = Object.values(cats).map((p) => `- ${p.name} بسعر ${p.price} جنيه`);
  return lines.length ? lines.join("\n") : "حاليًا مفيش منتجات متسجلة.";
}

function shippingAnswer() {
  return `🚚 الشحن: القاهرة والجيزة ${catalog.shipping.cairo_giza} جنيه، وباقي المحافظات ${catalog.shipping.other_governorates} جنيه.`;
}

function buildPrompt({ userText, session }) {
  const cats = catalog.categories || {};
  const catalogText = Object.values(cats)
    .map((p) => {
      const sizes = (p.sizes || []).join(" / ");
      const colors = (p.colors || []).join(" / ");
      return `${p.name}: سعر ${p.price} | مقاسات ${sizes} | ألوان ${colors} | خامة: ${p.material || "—"}`;
    })
    .join("\n");

  const history = (session?.history || []).slice(-6).map((h) => `U:${h.u}\nB:${h.b}`).join("\n");

  return `
أنت بائع لبق جدًا لمتجر ملابس على فيسبوك ماسنجر.
أسلوبك: ودود، محترم، مش بتفرض خطوات على العميل، وبتبدأ بتحية لو مناسب.

قواعد مهمة:
- جاوب بشكل مباشر على سؤال العميل.
- لو السؤال مش واضح: اسأل سؤال واحد بس للتوضيح.
- ممنوع تختلق أسعار/منتجات/مقاسات/ألوان مش موجودة في الكتالوج.
- لو حاجة مش متاحة: اعتذر وقدّم بديل.

الشحن:
- القاهرة/الجيزة: ${catalog.shipping.cairo_giza}
- باقي المحافظات: ${catalog.shipping.other_governorates}

الكتالوج:
${catalogText}

سياق المحادثة (آخر رسائل):
${history || "(لا يوجد)"}

رسالة العميل:
"${userText}"

اكتب رد قصير (سطر أو سطرين) بالعامية المصرية.
${EMOJI_ENABLED ? "استخدم ايموجي خفيفة لو مناسب." : "بدون ايموجي."}
`.trim();
}

function fallbackReply(userText) {
  const s = normalize(userText);

  if (s.includes("شحن") || s.includes("توصيل")) return shippingAnswer();
  if (s.includes("منتجات") || s.includes("عندك ايه") || s.includes("الموجود")) {
    return `${EMOJI_ENABLED ? "أكيد 😊" : "أكيد."} المنتجات عندنا:\n${listProducts()}`;
  }
  if (isGreeting(userText)) {
    return EMOJI_ENABLED
      ? "وعليكم السلام 😊 نورتنا! تحب تشوف المنتجات ولا تسأل عن حاجة معينة؟"
      : "وعليكم السلام. تحب تشوف المنتجات ولا تسأل عن حاجة معينة؟";
  }

  return EMOJI_ENABLED
    ? "تمام 😊 تحب تيشيرت ولا هودي ولا قميص ولا بنطلون؟"
    : "تمام. تحب تيشيرت ولا هودي ولا قميص ولا بنطلون؟";
}

// ================== Main Entry ==================
// ✅ هنا event المفروض جاي من webhook.js
export async function salesReply(event, pageAccessToken) {
  // تجاهل الايفنتات اللي مش رسالة
  if (event?.message?.is_echo) return;
  if (event?.delivery || event?.read) return;

  const psid = event?.sender?.id;
  const pageId = event?.recipient?.id; // ✅ هينفع لاحقًا للتينانت
  const userText = String(event?.message?.text || "").trim();

  if (!psid || !userText) return;

  // session
  let session = (await getSession(pageId, psid)) || createDefaultSession();
  session.history = Array.isArray(session.history) ? session.history : [];

  // ✅ مهم: البوت بيرد فقط بعد ما العميل يبعت
  // أول رسالة لو تحية: رد تحية + سؤال بسيط (مش يبدأ شغل)
  if (session.history.length === 0 && isGreeting(userText)) {
    const msg = EMOJI_ENABLED
      ? "وعليكم السلام 😊 نورتنا! تحب تشوف المنتجات ولا تسأل عن حاجة معينة؟"
      : "وعليكم السلام. تحب تشوف المنتجات ولا تسأل عن حاجة معينة؟";

    session.history.push({ u: userText, b: msg });
    await setSession(pageId, psid, session);
    await sendText(psid, msg, pageAccessToken);
    return;
  }

  // ردود سريعة للحاجات الواضحة
  const s = normalize(userText);
  if (s.includes("شحن") || s.includes("توصيل")) {
    const msg = shippingAnswer();
    session.history.push({ u: userText, b: msg });
    await setSession(pageId, psid, session);
    await sendText(psid, msg, pageAccessToken);
    return;
  }

  if (s.includes("منتجات") || s.includes("عندك ايه") || s.includes("الموجود")) {
    const msg = `${EMOJI_ENABLED ? "أكيد 😊" : "أكيد."} المنتجات عندنا:\n${listProducts()}`;
    session.history.push({ u: userText, b: msg });
    await setSession(pageId, psid, session);
    await sendText(psid, msg, pageAccessToken);
    return;
  }

  // Gemini
  const m = await initGeminiModel();
  let reply = null;

  if (m) {
    try {
      const prompt = buildPrompt({ userText, session });
      const result = await m.generateContent(prompt);
      reply = String(result?.response?.text?.() || "").trim();
    } catch (e) {
      console.error("⚠️ Gemini failed:", e?.message || e);
    }
  }

  // fallback
  if (!reply) reply = fallbackReply(userText);

  // حفظ + ارسال
  session.history.push({ u: userText, b: reply });
  await setSession(pageId, psid, session);
  await sendText(psid, reply, pageAccessToken);
}
