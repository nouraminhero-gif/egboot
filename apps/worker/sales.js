// apps/worker/sales.js
import dotenv from "dotenv";
import axios from "axios";
import { GoogleGenerativeAI } from "@google/generative-ai";

import { catalog } from "./brain/catalog.js";
import { FAQ } from "./brain/faq.js";
import { getSession, setSession, createDefaultSession } from "./session.js";

dotenv.config();

// =======================
// Gemini (safe init + ping)
// =======================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL_ENV = process.env.GEMINI_MODEL || "";

// جرّب موديلات شائعة (سيب ENV لو عايز تفرض اسم)
const MODEL_CANDIDATES = [
  GEMINI_MODEL_ENV,
  "gemini-1.5-flash",
  "gemini-1.5-flash-latest",
  "gemini-1.5-pro",
  "gemini-1.5-pro-latest",
].filter(Boolean);

let geminiModel = null;
let geminiInitDone = false;

async function initGeminiOnce() {
  if (geminiInitDone) return;
  geminiInitDone = true;

  if (!GEMINI_API_KEY) {
    console.warn("⚠️ GEMINI_API_KEY missing. Gemini disabled.");
    return;
  }

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

    for (const name of MODEL_CANDIDATES) {
      try {
        const m = genAI.getGenerativeModel({ model: name });

        // ping خفيف عشان نتأكد إن الموديل متاح بمفتاحك (يمنع 404 المفاجئ)
        await m.generateContent("ping");

        geminiModel = m;
        console.log(`🤖 Gemini ready: ${name}`);
        return;
      } catch (e) {
        const msg = e?.message || String(e);
        console.warn(`⚠️ Gemini model failed (${name}): ${msg}`);
      }
    }

    console.warn("⚠️ No Gemini model worked. Using fallback only.");
  } catch (e) {
    console.error("❌ Gemini init failed:", e?.message || e);
  }
}

// =======================
// FB Send
// =======================
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

// =======================
// Helpers
// =======================
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

function faqAnswer(text) {
  const s = normalize(text);

  if (s.includes("شحن") || s.includes("سعر الشحن") || s.includes("shipping"))
    return `🚚 ${FAQ.shipping_price}`;
  if (s.includes("يوصل") || s.includes("توصيل") || s.includes("مده") || s.includes("مدة") || s.includes("delivery"))
    return `⏱️ ${FAQ.delivery_time}`;
  if (s.includes("دفع") || s.includes("payment") || s.includes("كاش"))
    return `💵 ${FAQ.payment}`;
  if (s.includes("استبدال") || s.includes("استرجاع") || s.includes("exchange") || s.includes("return"))
    return `🔁 ${FAQ.exchange}`;

  return null;
}

function buildCatalogText() {
  const cats = catalog?.categories || {};
  const keys = Object.keys(cats);

  if (!keys.length) return "لا يوجد كتالوج متاح.";

  const lines = keys.map((k) => {
    const p = cats[k];
    const sizes = (p?.sizes || []).join("/");
    const colors = (p?.colors || []).join("/");
    return `- ${k}: سعر ${p?.price ?? "—"} | مقاسات ${sizes || "—"} | ألوان ${colors || "—"}`;
  });

  return lines.join("\n");
}

function trimHistory(session) {
  // حافظ على آخر 8 رسائل بس عشان البرومبت ما يكبرش
  if (!Array.isArray(session.history)) session.history = [];
  if (session.history.length > 8) session.history = session.history.slice(-8);
  return session;
}

async function geminiReply({ userText, session }) {
  await initGeminiOnce();
  if (!geminiModel) return null;

  const catalogText = buildCatalogText();
  const shipping = catalog?.shipping || "";

  const history = (session.history || [])
    .slice(-6)
    .map((m) => `${m.role === "user" ? "User" : "Bot"}: ${m.text}`)
    .join("\n");

  const prompt = `
أنت بوت مبيعات لمتجر ملابس على فيسبوك ماسنجر.
ردودك قصيرة وواضحة وبالعامية المصرية.
ممنوع تخترع منتجات أو أسعار.
لو سؤال شحن/توصيل/دفع/استبدال استخدم المعلومات المتاحة.
لو العميل محتاج اختيار: اسأله سؤال واحد واضح.

الكتالوج:
${catalogText}

الشحن:
${shipping}

FAQ:
- الشحن: ${FAQ.shipping_price}
- التوصيل: ${FAQ.delivery_time}
- الدفع: ${FAQ.payment}
- الاستبدال: ${FAQ.exchange}

المحادثة السابقة:
${history}

User: ${userText}
Bot:
`.trim();

  try {
    const res = await geminiModel.generateContent(prompt);
    const out = res?.response?.text?.() || "";
    return String(out).trim() || null;
  } catch (e) {
    console.error("⚠️ Gemini generate failed:", e?.message || e);
    return null;
  }
}

function fallbackReply(text) {
  const t = normalize(text);

  const faq = faqAnswer(text);
  if (faq) return faq;

  if (t.includes("سلام") || t.includes("السلام") || t.includes("hi") || t.includes("hello"))
    return "أهلًا بيك 👋 تحب تطلب تيشيرت ولا هودي؟";

  if (t.includes("سعر") || t.includes("بكام"))
    return "قولي المنتج (تيشيرت ولا هودي) والمقاس/اللون لو تعرفهم وأنا أقولك السعر فورًا.";

  return "تمام 👌 قولي تحب تيشيرت ولا هودي؟ وكمان المقاس لو معروف (M/L/XL).";
}

// =======================
// ✅ Main export (supports BOTH call styles)
// =======================
// 1) salesReply({ senderId, text, event, pageAccessToken })
// 2) salesReply(event, pageAccessToken)
export async function salesReply(a, b) {
  // ---- detect call style
  const isPayload = a && typeof a === "object" && (a.event || a.senderId);

  const event = isPayload ? a.event : a;
  const pageAccessToken = isPayload ? a.pageAccessToken : b;

  // psid + text
  const senderId =
    (isPayload ? a.senderId : null) ||
    event?.sender?.id ||
    null;

  const userText =
    (isPayload ? a.text : null) ||
    event?.message?.text ||
    "";

  const text = String(userText || "").trim();

  // ignore non-text
  if (!senderId) return;
  if (!text) {
    await sendText(senderId, "ابعتلي رسالة نصية عشان أقدر أساعدك ✅", pageAccessToken);
    return;
  }

  // ---- session
  let session = (await getSession(senderId)) || createDefaultSession();
  if (!session || typeof session !== "object") session = createDefaultSession();

  // normalize session shape
  session.history = Array.isArray(session.history) ? session.history : [];
  session = trimHistory(session);

  // save user msg
  session.history.push({ role: "user", text });

  // ---- reply
  // FAQ أولاً (سريع)
  const faq = faqAnswer(text);
  let replyText = faq;

  // Gemini
  if (!replyText) {
    replyText = await geminiReply({ userText: text, session });
  }

  // fallback
  if (!replyText) {
    replyText = fallbackReply(text);
  }

  // save bot msg
  session.history.push({ role: "bot", text: replyText });
  session = trimHistory(session);

  await setSession(senderId, session);

  // send
  await sendText(senderId, replyText, pageAccessToken);
}
