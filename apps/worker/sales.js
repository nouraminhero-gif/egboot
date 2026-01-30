// apps/worker/sales.js
import dotenv from "dotenv";
import axios from "axios";
import { GoogleGenerativeAI } from "@google/generative-ai";

import { catalog } from "./brain/catalog.js";
import { FAQ } from "./brain/faq.js";
import { getSession, setSession, createDefaultSession } from "./session.js";

dotenv.config();

// ================== Gemini Setup ==================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash"; // ✅ الافتراضي الصح

let geminiModel = null;

async function initGemini() {
  if (geminiModel) return geminiModel;
  if (!GEMINI_API_KEY) {
    console.warn("⚠️ GEMINI_API_KEY missing. Gemini disabled.");
    return null;
  }

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    geminiModel = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    console.log("🤖 Gemini ready:", GEMINI_MODEL);
    return geminiModel;
  } catch (e) {
    console.error("❌ Gemini init failed:", e?.message || e);
    geminiModel = null;
    return null;
  }
}

// ================== Helpers ==================
function safeString(x) {
  return typeof x === "string" ? x : "";
}

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

function isGreeting(t) {
  const s = normalize(t);
  return (
    s.includes("سلام") ||
    s.includes("السلام") ||
    s.includes("اهلا") ||
    s.includes("أهلا") ||
    s.includes("هاي") ||
    s.includes("hi") ||
    s === "hello"
  );
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

function listProductsText() {
  const cats = catalog?.categories || {};
  const keys = Object.keys(cats);

  if (!keys.length) return "المنتجات المتاحة: (مش لاقي كتالوج دلوقتي)";

  const lines = keys.map((k, i) => {
    const p = cats[k];
    const name = p?.name || k;
    const price = p?.price != null ? `${p.price} جنيه` : "اسألني عن السعر";
    return `${i + 1}) ${name} — ${price}`;
  });

  return `المنتجات المتاحة عندنا:\n${lines.join("\n")}\n\nقولّي تحب أنهي؟`;
}

function shouldUseGemini(text) {
  // Gemini بس لو:
  // - مش Greeting/FAQ/أوامر واضحة
  // - وفي نفس الوقت الرسالة "مفتوحة" أو مش مفهومة
  const s = normalize(text);
  if (!s) return true;

  // لو FAQ
  if (faqAnswer(text)) return false;

  // أوامر مباشرة
  if (s.includes("ابدأ") || s.includes("ابدا") || s.includes("start") || s.includes("المنتجات") || s.includes("كتالوج"))
    return false;

  // greetings نخليها Gemini لو أول مرة (علشان يبدأ المحادثة بشكل ذكي)
  // لكن بعد كده نخليها رد ثابت.
  if (isGreeting(text)) return true;

  // كلمات واضحة عن سعر/منتج/مقاس/لون ممكن نرد رد بسيط بدون Gemini
  const simpleHints = ["سعر", "بكام", "مقاس", "الوان", "لون", "تيشيرت", "هودي", "شحن", "توصيل", "دفع"];
  if (simpleHints.some((w) => s.includes(w))) return false;

  // غير كده: Gemini
  return true;
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

// ================== Gemini Prompt ==================
function buildGeminiSystem({ session }) {
  const cats = catalog?.categories || {};
  const keys = Object.keys(cats);

  const productsBlock = keys
    .map((k) => {
      const p = cats[k] || {};
      const name = p.name || k;
      const price = p.price != null ? p.price : "غير محدد";
      const sizes = Array.isArray(p.sizes) ? p.sizes.join("/") : "—";
      const colors = Array.isArray(p.colors) ? p.colors.join("/") : "—";
      return `- ${name}: السعر ${price} | المقاسات ${sizes} | الألوان ${colors}`;
    })
    .join("\n");

  const shipping = catalog?.shipping || "الشحن حسب المحافظة";

  return `
أنت بوت مبيعات لمتجر ملابس على فيسبوك ماسنجر.
اسلوبك: مصري بسيط، محترم، ردود قصيرة (سطرين-4 بالكثير).
هدفك:
1) تبدأ المحادثة بترحيب ذكي وتعرض الخيارات.
2) لو سؤال خارج قواعدنا، تجاوب بشكل عام بدون اختراع بيانات.
3) ممنوع تخترع أسعار/منتجات مش موجودة في الكتالوج.
4) لو السؤال عن الشحن/التوصيل/الدفع/الاستبدال استخدم FAQ.

الكتالوج:
${productsBlock || "(لا يوجد كتالوج)"}

سياسة الشحن:
${shipping}

FAQ:
- الشحن: ${FAQ.shipping_price}
- التوصيل: ${FAQ.delivery_time}
- الدفع: ${FAQ.payment}
- الاستبدال: ${FAQ.exchange}

حالة العميل الحالية (Session مختصر):
step=${session?.step || "idle"}
order=${JSON.stringify(session?.order || {}, null, 0)}
`.trim();
}

async function geminiReply({ session, userText }) {
  const m = await initGemini();
  if (!m) return null;

  const system = buildGeminiSystem({ session });

  // شوية سياق من آخر كلام
  const history = Array.isArray(session?.history) ? session.history.slice(-6) : [];
  const histText = history
    .map((x) => {
      const u = safeString(x?.user);
      const b = safeString(x?.bot);
      return `User: ${u}\nBot: ${b}`;
    })
    .join("\n");

  const prompt = `${system}\n\nالمحادثة السابقة:\n${histText}\n\nUser: ${userText}\nBot:`;

  try {
    const res = await m.generateContent(prompt);
    const out = res?.response?.text?.() || "";
    return String(out).trim() || null;
  } catch (e) {
    console.error("⚠️ Gemini failed:", e?.message || e);
    return null;
  }
}

// ================== Main export (compatible with queue.js) ==================
export async function salesReply(arg1, arg2) {
  // يدعم شكلين:
  // 1) salesReply({ senderId, text, pageAccessToken, event })
  // 2) salesReply(event, pageAccessToken)

  let senderId = null;
  let text = "";
  let pageAccessToken = null;

  // شكل 1
  if (arg1 && typeof arg1 === "object" && "senderId" in arg1) {
    senderId = arg1.senderId;
    text = safeString(arg1.text);
    pageAccessToken = arg1.pageAccessToken;
  } else {
    // شكل 2
    const event = arg1;
    pageAccessToken = arg2;
    senderId = event?.sender?.id || null;
    text = safeString(event?.message?.text);
  }

  if (!senderId) return;

  const safeText = safeString(text).trim(); // ممكن يبقى فاضي لو attachment

  // 1) session
  let session = (await getSession(senderId)) || createDefaultSession();
  session.history = Array.isArray(session.history) ? session.history : [];
  session.order = session.order || { product: null, size: null, color: null, phone: null, address: null };
  session.step = session.step || "idle";

  // ✅ أول مرة: خلي Gemini "يبدأ المحادثة" حتى لو المستخدم قال hi أو بعت حاجة مش نص
  const isFirstTime = session.history.length === 0;

  // 2) ردود ثابتة أولاً
  let replyText = null;

  // لو مفيش نص (صورة/ستكر) — نبدأ محادثة بدل ما نقع
  if (!safeText) {
    if (isFirstTime) {
      // Gemini welcome
      replyText =
        (await geminiReply({
          session,
          userText: "المستخدم بدأ المحادثة بدون نص. ابدأ انت بترحيب وعرض المنتجات المتاحة.",
        })) ||
        `أهلاً بيك 👋\n${listProductsText()}`;
    } else {
      replyText = `ابعتلي رسالة نصية عشان أقدر أساعدك ✅`;
    }
  } else {
    // FAQ
    const faq = faqAnswer(safeText);
    if (faq) replyText = faq;

    // أوامر بسيطة
    const s = normalize(safeText);
    if (!replyText && (s.includes("المنتجات") || s.includes("كتالوج"))) {
      replyText = listProductsText();
    }

    // greeting بعد أول مرة
    if (!replyText && isGreeting(safeText) && !isFirstTime) {
      replyText = `أهلاً بيك 👋\n${listProductsText()}`;
    }

    // ✅ Gemini يبدأ أول مرة حتى لو greeting
    if (!replyText && isFirstTime) {
      replyText =
        (await geminiReply({
          session,
          userText: `ابدأ المحادثة مع العميل: "${safeText}" وعرّفه بالمنتجات وخليه يختار.`,
        })) ||
        `أهلاً بيك 👋\n${listProductsText()}`;
    }

    // 3) Gemini fallback للأسئلة اللي مش موجودة في “الردود الثابتة”
    if (!replyText && shouldUseGemini(safeText)) {
      replyText = await geminiReply({ session, userText: safeText });
    }

    // 4) fallback نهائي
    if (!replyText) {
      // رد بسيط بدل ما البوت يبان “غبي”
      if (s.includes("سعر") || s.includes("بكام")) {
        replyText = `أكيد ✅ قولي اسم المنتج (أو ابعت "المنتجات") وأنا أقولك السعر فورًا.`;
      } else {
        replyText = `تمام ✅ قولّي محتاج تيشيرت ولا هودي؟ (أو ابعت "المنتجات")`;
      }
    }
  }

  // 5) update session
  session.history.push({ user: safeText || "(no-text)", bot: replyText });
  await setSession(senderId, session);

  // 6) send
  await sendText(senderId, replyText, pageAccessToken);
}
