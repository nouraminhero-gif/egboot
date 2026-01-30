// apps/worker/sales.js
import dotenv from "dotenv";
import axios from "axios";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getSession, setSession, createDefaultSession } from "./session.js";

dotenv.config();

// =====================
// ENV
// =====================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL_ENV = process.env.GEMINI_MODEL || ""; // optional override

// =====================
// Gemini Init (auto-pick a real available model)
// =====================
let geminiModel = null;
let geminiInitDone = false;

async function initGemini() {
  if (geminiInitDone) return;
  geminiInitDone = true;

  if (!GEMINI_API_KEY) {
    console.warn("⚠️ GEMINI_API_KEY missing. Gemini disabled.");
    return;
  }

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

    // 1) لو المستخدم محدد موديل في ENV نجربه الأول
    if (GEMINI_MODEL_ENV) {
      try {
        const m = genAI.getGenerativeModel({ model: GEMINI_MODEL_ENV });
        await m.generateContent("ping");
        geminiModel = m;
        console.log("🤖 Gemini ready (ENV model):", GEMINI_MODEL_ENV);
        return;
      } catch (e) {
        console.warn("⚠️ ENV model failed:", e?.message || e);
      }
    }

    // 2) ListModels الحقيقي من API عشان نجيب موديل متاح فعلًا
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`;
    const { data } = await axios.get(url);

    const models = Array.isArray(data?.models) ? data.models : [];

    // ناخد أول موديل بيدعم generateContent
    const pick = models.find((m) => Array.isArray(m.supportedGenerationMethods)
      && m.supportedGenerationMethods.includes("generateContent"));

    if (!pick?.name) {
      console.warn("⚠️ No model supports generateContent for this key/project.");
      return;
    }

    // name بيكون بالشكل: "models/gemini-1.5-flash" ... إلخ
    geminiModel = genAI.getGenerativeModel({ model: pick.name });
    console.log("🤖 Gemini ready (auto-picked):", pick.name);
  } catch (e) {
    console.error("❌ Gemini init/listModels failed:", e?.response?.data || e?.message || e);
  }
}

// =====================
// FB Send
// =====================
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

// =====================
// Prompt
// =====================
function buildPrompt({ userText, session }) {
  return `
أنت مساعد مبيعات لبوت فيسبوك ماسنجر.
بتتكلم باللهجة المصرية بشكل طبيعي وبسيط.
ممنوع تخترع أسعار أو منتجات مش موجودة.
لو السؤال مش واضح: اسأل سؤال واحد بس يوضح احتياجه.
ردك يكون قصير (سطرين بالكتير) ومفيد.

سياق العميل (Session):
${JSON.stringify(session, null, 2)}

رسالة العميل:
"${userText}"

اكتب ردك الآن:
`.trim();
}

// =====================
// Fallback بسيط لو Gemini وقع
// =====================
function fallbackReply(userText = "") {
  const t = String(userText).toLowerCase();

  if (t.includes("سعر") || t.includes("بكام")) {
    return "تمام ✅ قولي المنتج اللي تقصده (تيشيرت ولا هودي) وأنا أقولك السعر فورًا.";
  }
  if (t.includes("سلام") || t.includes("السلام") || t.includes("hi") || t.includes("hello")) {
    return "أهلًا بيك 👋 تحب تطلب تيشيرت ولا هودي؟";
  }
  return "تمام ✅ ممكن توضحلي محتاج إيه بالظبط؟ (تيشيرت/هودي/سعر/شحن)";
}

// =====================
// Main Export (compatible with your queue.js)
// Supports:
// 1) salesReply({ senderId, text, event, pageAccessToken })
// 2) salesReply(event, pageAccessToken)
// =====================
export async function salesReply(a, b) {
  // Normalize inputs
  let senderId, userText, pageAccessToken;

  if (a && typeof a === "object" && a.senderId && a.pageAccessToken) {
    senderId = a.senderId;
    userText = a.text ?? a?.event?.message?.text ?? "";
    pageAccessToken = a.pageAccessToken;
  } else {
    const event = a;
    pageAccessToken = b;
    senderId = event?.sender?.id;
    userText = event?.message?.text ?? "";
  }

  // لازم يكون فيه senderId
  if (!senderId) return;

  // لازم يكون نص
  userText = String(userText || "").trim();
  if (!userText) {
    await sendText(senderId, "ابعتلي رسالة نصية عشان أقدر أساعدك ✅", pageAccessToken);
    return;
  }

  // session
  let session = (await getSession(senderId)) || createDefaultSession();
  session.history = Array.isArray(session.history) ? session.history : [];

  // init gemini once
  await initGemini();

  // gemini try
  let replyText = null;
  if (geminiModel) {
    try {
      const prompt = buildPrompt({ userText, session });
      const result = await geminiModel.generateContent(prompt);
      replyText = String(result?.response?.text?.() || "").trim();
    } catch (e) {
      console.error("⚠️ Gemini generate failed:", e?.response?.data || e?.message || e);
    }
  }

  // fallback if needed
  if (!replyText) {
    replyText = fallbackReply(userText);
  }

  // save session
  session.history.push({ role: "user", text: userText });
  session.history.push({ role: "bot", text: replyText });
  await setSession(senderId, session);

  // send
  await sendText(senderId, replyText, pageAccessToken);
}
