// apps/worker/sales.js
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getSession, setSession, createDefaultSession } from "./session.js";
import axios from "axios";

dotenv.config();

// ================== Gemini Setup ==================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

let model = null;

if (GEMINI_API_KEY) {
  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    model = genAI.getGenerativeModel({
      model: "gemini-pro", // ✅ الاسم الصح الوحيد
    });
    console.log("🤖 Gemini Pro ready");
  } catch (e) {
    console.error("❌ Gemini init failed:", e?.message || e);
  }
} else {
  console.warn("⚠️ GEMINI_API_KEY missing. Gemini disabled.");
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

// ================== Main Entry ==================
export async function salesReply({ senderId, text, pageAccessToken }) {
  // 1️⃣ session
  let session = (await getSession(senderId)) || createDefaultSession();

  // 2️⃣ prompt
  const prompt = buildPrompt({ text, session });

  let replyText = null;

  // 3️⃣ Gemini
  if (model) {
    try {
      const result = await model.generateContent(prompt);
      replyText = result.response.text();
    } catch (e) {
      console.error("⚠️ Gemini failed:", e?.message || e);
    }
  }

  // 4️⃣ fallback
  if (!replyText) {
    replyText = fallbackReply(text, session);
  }

  // 5️⃣ update session (بسيط)
  session.history.push({
    user: text,
    bot: replyText,
  });

  await setSession(senderId, session);

  // 6️⃣ send
  await sendText(senderId, replyText, pageAccessToken);
}

// ================== Prompt ==================
function buildPrompt({ text, session }) {
  return `
أنت بوت مبيعات ذكي ومهذب.
بتتكلم عربي مصري بسيط.

مهمتك:
- تفهم العميل
- تساعده يختار منتج
- ترد رد قصير وواضح

حالة العميل الحالية:
${JSON.stringify(session, null, 2)}

رسالة العميل:
"${text}"

ردك يكون:
- جملة أو اتنين
- من غير إيموجي
- من غير شرح تقني
`;
}

// ================== Fallback ==================
function fallbackReply(text, session) {
  const t = text.toLowerCase();

  if (t.includes("سعر") || t.includes("بكام")) {
    return "حلو 👌 قولي المنتج اللي حابه وأنا أقولك السعر فورًا";
  }

  if (t.includes("السلام") || t.includes("hi")) {
    return "أهلًا بيك 👋 تحب أساعدك في إيه؟";
  }

  return "تمام 👍 ممكن توضحلي أكتر إنت محتاج إيه؟";
}
