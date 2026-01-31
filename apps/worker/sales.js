// apps/worker/sales.js
import dotenv from "dotenv";
import axios from "axios";
import crypto from "crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";

import {
  getSession,
  setSession,
  createDefaultSession,
  getKB,
  setKB,
  bumpKBHit,
} from "./session.js";

dotenv.config();

// ================== Catalog (Clothes bot) ==================
const catalog = {
  categories: {
    tshirt: {
      name: "تيشيرت",
      price: 299,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أسود", "أبيض", "كحلي", "رمادي", "بيج"],
      material: "قطن مريح مناسب للاستخدام اليومي",
    },
    hoodie: {
      name: "هودي",
      price: 599,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أسود", "رمادي", "كحلي", "زيتي", "بيج"],
      material: "خامة دافية ومناسبة للشتا",
    },
    shirt: {
      name: "قميص",
      price: 449,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أسود", "أبيض", "كحلي", "رمادي", "بيج"],
      material: "قماش عملي وشكله شيك",
    },
    pants: {
      name: "بنطلون",
      price: 499,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أسود", "كحلي", "رمادي", "زيتي", "بيج"],
      material: "قماش تقيل ومستحمل",
    },
  },
  shipping: {
    cairo_giza: 70,
    other_governorates: 90,
  },
  notes: [
    "المقاسات المتاحة من M لحد 2XL",
    "الألوان المتاحة 5 ألوان",
    "الشحن داخل القاهرة والجيزة 70 جنيه، وباقي المحافظات 90 جنيه",
  ],
};

// ================== Gemini Setup ==================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
let model = null;

if (GEMINI_API_KEY) {
  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    // ✅ ثبّت الموديل هنا عشان نتجنب مشاكل الأسماء
    model = genAI.getGenerativeModel({ model: "gemini-pro" });
    console.log("🤖 Gemini ready: gemini-pro");
  } catch (e) {
    console.error("❌ Gemini init failed:", e?.message || e);
  }
} else {
  console.warn("⚠️ GEMINI_API_KEY missing. Gemini disabled.");
}

// ================== FB Send ==================
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

// ================== Helpers ==================
function normalizeQuestion(input = "") {
  // تطبيع بسيط: lowercase + remove punctuation + collapse spaces
  const s = String(input)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return s;
}

function questionKey(text) {
  const norm = normalizeQuestion(text);
  if (!norm) return "";
  return crypto.createHash("sha1").update(norm).digest("hex");
}

function extractTextFromEvent(event) {
  const text = event?.message?.text;
  const postback = event?.postback?.payload;
  // لو postback رجّعه كنص عادي (عشان يرد)
  return text || postback || "";
}

// ================== Persona / Prompt ==================
function buildPrompt({ userText, session }) {
  const lastTurns = (session?.history || []).slice(-6);

  return `
أنت بائع ملابس محترم ولطيف وذكي. بتتكلم عربي مصري.
ممنوع تفرض على العميل قرار. ممنوع تقول "لازم تختار" أو "عشان نكمل".
أسلوبك: ترحيب بسيط + سؤال واحد ذكي يساعد العميل.

قواعد:
- ردك قصير (1-3 جمل).
- استخدم إيموجي خفيف (1 كحد أقصى).
- لو العميل بيسأل عن الشحن: وضح القاهرة/الجيزة 70 وباقي المحافظات 90.
- لو المقاس مش متوفر: اقترح بديل بلطف.
- لو العميل سأل سؤال عام عن الجودة/الخامة: استخدم معلومات الخامات الموجودة.
- ممنوع كلام تقني.

الكتالوج:
${JSON.stringify(catalog, null, 2)}

سياق آخر محادثة:
${JSON.stringify(lastTurns, null, 2)}

حالة الطلب:
${JSON.stringify(session?.order || {}, null, 2)}

رسالة العميل:
"${userText}"

اكتب الرد الآن:
`;
}

// ================== Fallback (لو Gemini وقع) ==================
function fallbackReply(userText, session) {
  const t = normalizeQuestion(userText);

  // ترحيب لو أول رسالة
  const isFirst = !session?.history?.length;
  if (isFirst && (t.includes("السلام") || t.includes("سلام") || t.includes("hi") || t.includes("hello"))) {
    return "وعليكم السلام 👋 تحب تشوف تيشيرت ولا هودي ولا قميص ولا بنطلون؟";
  }

  if (t.includes("شحن")) {
    return "الشحن القاهرة والجيزة 70 جنيه، وباقي المحافظات 90 جنيه ✅ تحب الشحن لِـ انهي محافظة؟";
  }

  if (t.includes("سعر") || t.includes("بكام") || t.includes("كام")) {
    return "تمام 👌 تحب سعر التيشيرت ولا الهودي ولا القميص ولا البنطلون؟";
  }

  if (t.includes("مقاس") || t.includes("وزني")) {
    return "تمام 👌 قولي وزنك وطولك وأنا أرشحلك المقاس الأنسب من M لحد 2XL.";
  }

  return "تمام 👌 تحب أساعدك تختار إيه بالظبط: نوع المنتج ولا المقاس ولا الألوان؟";
}

// ================== Main Entry ==================
// ✅ دي بتقبل event مباشرة عشان تشتغل مع worker.js اللي عندك
export async function salesReply(event, pageAccessToken) {
  const senderId = event?.sender?.id;
  const userText = extractTextFromEvent(event);

  if (!senderId) {
    console.warn("⚠️ salesReply missing senderId");
    return;
  }

  // لو مفيش نص، متكسرش الدنيا
  if (!userText) {
    console.warn("⚠️ salesReply: empty userText (skip)");
    return;
  }

  // 1) session
  let session = (await getSession(senderId)) || createDefaultSession();

  // 2) جرّب KB (التعلّم) الأول
  const kbKey = questionKey(userText);
  if (kbKey) {
    const cached = await getKB(kbKey);
    if (cached?.answer) {
      await bumpKBHit(kbKey);

      // خزّن في history
      session.history.push({ user: userText, bot: cached.answer });
      await setSession(senderId, session);

      await sendText(senderId, cached.answer, pageAccessToken);
      return;
    }
  }

  // 3) Gemini
  let replyText = "";
  if (model) {
    try {
      const prompt = buildPrompt({ userText, session });
      const result = await model.generateContent(prompt);
      replyText = result?.response?.text?.() || "";
    } catch (e) {
      console.error("⚠️ Gemini failed:", e?.message || e);
    }
  }

  // 4) fallback
  if (!replyText) {
    replyText = fallbackReply(userText, session);
  } else {
    // 5) Learn: خزّن إجابة Gemini كسؤال متكرر (لو ينفع)
    // نخزن بس لو الإجابة "مختصرة ومفيدة"
    if (kbKey && replyText.length >= 10 && replyText.length <= 350) {
      await setKB(kbKey, replyText);
    }
  }

  // 6) update session
  session.history.push({ user: userText, bot: replyText });
  await setSession(senderId, session);

  // 7) send
  await sendText(senderId, replyText, pageAccessToken);
}
