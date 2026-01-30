// apps/worker/sales.js
// Sales flow + Redis session + Gemini 1.0 Pro fallback

import { GoogleGenerativeAI } from "@google/generative-ai";
import { catalog } from "./brain/catalog.js";
import { FAQ } from "./brain/faq.js";
import {
  getSession,
  setSession,
  clearSession,
  createDefaultSession,
} from "./session.js";

// =====================
// ENV
// =====================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

// =====================
// Gemini init (STABLE)
// =====================
let geminiModel = null;
let geminiReady = false;

async function initGemini() {
  if (geminiReady) return;
  geminiReady = true;

  if (!GEMINI_API_KEY) {
    console.warn("⚠️ GEMINI_API_KEY missing. AI disabled.");
    return;
  }

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

    geminiModel = genAI.getGenerativeModel({
      model: "gemini-1.0-pro",
    });

    console.log("✅ Gemini model ready: gemini-1.0-pro");
  } catch (e) {
    console.warn("⚠️ Gemini init failed:", e?.message || e);
    geminiModel = null;
  }
}

// =====================
// Helpers
// =====================
function normalize(text = "") {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isYes(t) {
  return ["نعم", "تمام", "موافق", "ok", "yes", "y", "تاكيد", "تأكيد"].includes(
    normalize(t)
  );
}

function isNo(t) {
  return ["لا", "لأ", "cancel", "إلغاء", "الغاء", "no", "n"].includes(
    normalize(t)
  );
}

function detectProduct(text) {
  const s = normalize(text);
  if (s.includes("تيشيرت") || s.includes("tshirt") || s === "1")
    return "tshirt";
  if (s.includes("هودي") || s.includes("hoodie") || s === "2")
    return "hoodie";
  return null;
}

function detectSize(text) {
  const s = normalize(text).replace(/\s/g, "");
  if (["m", "medium", "م"].includes(s)) return "M";
  if (["l", "large", "ل"].includes(s)) return "L";
  if (["xl", "xlarge", "اكسل"].includes(s)) return "XL";
  return null;
}

function detectColor(text) {
  const s = normalize(text);
  if (s.includes("اسود") || s.includes("black")) return "أسود";
  if (s.includes("ابيض") || s.includes("white")) return "أبيض";
  if (s.includes("كحلي") || s.includes("navy")) return "كحلي";
  return null;
}

function looksLikePhone(text) {
  const d = String(text).replace(/\D/g, "");
  return d.length >= 10 && d.length <= 15;
}

function prettyProduct(key) {
  if (key === "tshirt") return "تيشيرت";
  if (key === "hoodie") return "هودي";
  return "منتج";
}

function getProductInfo(key) {
  return catalog?.categories?.[key] || null;
}

// =====================
// Gemini fallback
// =====================
async function geminiFallback({ session, userText }) {
  await initGemini();
  if (!geminiModel) return null;

  const prompt = `
أنت مساعد مبيعات لمتجر ملابس على فيسبوك ماسنجر.
ردودك قصيرة وبالعامية المصرية.
ممنوع اختراع أسعار أو منتجات.

حالة الطلب:
product=${session.order.product || "none"}
size=${session.order.size || "none"}
color=${session.order.color || "none"}
step=${session.step}

User: ${userText}
Bot:
  `.trim();

  try {
    const res = await geminiModel.generateContent(prompt);
    return res?.response?.text?.() || null;
  } catch (e) {
    console.error("❌ Gemini error:", e?.message || e);
    return null;
  }
}

// =====================
// FB Send helper
// =====================
async function sendText(psid, text, token) {
  if (!psid || !token) return;

  try {
    await fetch(
      `https://graph.facebook.com/v18.0/me/messages?access_token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: psid },
          message: { text },
        }),
      }
    );
  } catch (e) {
    console.error("❌ FB send error:", e?.message || e);
  }
}

// =====================
// MAIN
// =====================
export async function salesReply(event, pageAccessToken) {
  if (event?.message?.is_echo) return;
  if (event?.delivery || event?.read) return;

  const senderId = event?.sender?.id;
  const userText = event?.message?.text?.trim();
  if (!senderId || !userText) return;

  let session = (await getSession(senderId)) || createDefaultSession();

  session.step ||= "idle";
  session.order ||= {
    product: null,
    size: null,
    color: null,
    phone: null,
    address: null,
  };
  session.history ||= [];

  session.history.push({ role: "user", text: userText });

  const sText = normalize(userText);

  // سلام
  if (sText.includes("سلام")) {
    const msg = "وعليكم السلام 😊 اكتب «ابدأ» عشان نبدأ الطلب";
    await sendText(senderId, msg, pageAccessToken);
    return;
  }

  // ابدأ
  if (sText.includes("ابدأ") || sText.includes("start")) {
    session.step = "choose_product";
    session.order = createDefaultSession().order;

    const msg = `تحب تطلب إيه؟  
1️⃣ تيشيرت  
2️⃣ هودي`;

    await setSession(senderId, session);
    await sendText(senderId, msg, pageAccessToken);
    return;
  }

  // choose product
  if (session.step === "choose_product") {
    const p = detectProduct(userText);
    if (!p) {
      await sendText(senderId, "قولي تيشيرت ولا هودي؟", pageAccessToken);
      return;
    }

    session.order.product = p;
    session.step = "choose_size";

    const info = getProductInfo(p);
    const msg = `📦 ${prettyProduct(p)}
💰 السعر: ${info.price}
📏 المقاسات: ${info.sizes.join(" / ")}
🎨 الألوان: ${info.colors.join(" / ")}

اكتب المقاس (M / L / XL)`;

    await setSession(senderId, session);
    await sendText(senderId, msg, pageAccessToken);
    return;
  }

  // choose size
  if (session.step === "choose_size") {
    const size = detectSize(userText);
    if (!size) {
      await sendText(senderId, "اكتب المقاس: M أو L أو XL", pageAccessToken);
      return;
    }

    session.order.size = size;
    session.step = "choose_color";

    await setSession(senderId, session);
    await sendText(senderId, "تمام 👌 اللون إيه؟", pageAccessToken);
    return;
  }

  // choose color
  if (session.step === "choose_color") {
    const color = detectColor(userText);
    if (!color) {
      await sendText(senderId, "اختار لون: أسود / أبيض / كحلي", pageAccessToken);
      return;
    }

    session.order.color = color;
    session.step = "confirm";

    const msg = `أكد الطلب:
${prettyProduct(session.order.product)}
مقاس: ${session.order.size}
لون: ${session.order.color}

اكتب «تأكيد» أو «إلغاء»`;

    await setSession(senderId, session);
    await sendText(senderId, msg, pageAccessToken);
    return;
  }

  // confirm
  if (session.step === "confirm") {
    if (isYes(userText)) {
      session.step = "get_phone";
      await setSession(senderId, session);
      await sendText(senderId, "ابعت رقم الموبايل 📱", pageAccessToken);
      return;
    }

    if (isNo(userText)) {
      await clearSession(senderId);
      await sendText(senderId, "تم الإلغاء ✅ اكتب «ابدأ» لو حابب", pageAccessToken);
      return;
    }
  }

  // fallback AI
  const ai = await geminiFallback({ session, userText });
  if (ai) {
    await sendText(senderId, ai, pageAccessToken);
    return;
  }

  await sendText(senderId, "مش فاهمك 😅 اكتب «ابدأ»", pageAccessToken);
}
