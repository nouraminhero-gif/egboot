import dotenv from "dotenv";
import axios from "axios";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

// ================== Gemini ==================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let model = null;

if (GEMINI_API_KEY) {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  console.log("🤖 Gemini ready");
}

// ================== Helpers ==================
const COLORS = ["اسود", "أبيض", "ابيض", "كحلي", "رمادي"];
const PRODUCTS = ["قميص", "تيشيرت", "هودي", "بنطلون"];
const SIZES = ["m", "l", "xl", "2xl", "xxl"];

function normalize(text = "") {
  return text.toLowerCase().trim();
}

function detectIntent(text) {
  const t = normalize(text);
  const intent = {};

  PRODUCTS.forEach(p => {
    if (t.includes(p)) intent.product = p;
  });

  COLORS.forEach(c => {
    if (t.includes(c)) intent.color = c;
  });

  SIZES.forEach(s => {
    if (t.includes(s)) intent.size = s.toUpperCase();
  });

  return intent;
}

// ================== Session ==================
function createSession() {
  return {
    step: "idle", // idle | product | color | size
    product: null,
    color: null,
    size: null,
    history: []
  };
}

// ================== FB Send ==================
async function sendText(psid, text, token) {
  if (!psid || !token) return;

  await axios.post(
    "https://graph.facebook.com/v18.0/me/messages",
    {
      recipient: { id: psid },
      messaging_type: "RESPONSE",
      message: { text }
    },
    { params: { access_token: token } }
  );
}

// ================== Main ==================
export async function salesReply({
  botId,
  senderId,
  text,
  pageAccessToken,
  redis
}) {
  const SESSION_KEY = `egboot:session:${botId}:${senderId}`;

  // 1️⃣ load session
  let session;
  const raw = await redis.get(SESSION_KEY);
  session = raw ? JSON.parse(raw) : createSession();

  // 2️⃣ detect intent
  const intent = detectIntent(text);

  if (intent.product && !session.product) {
    session.product = intent.product;
    session.step = "color";
  }

  if (intent.color && session.product && !session.color) {
    session.color = intent.color;
    session.step = "size";
  }

  if (intent.size && session.product && session.color) {
    session.size = intent.size;
    session.step = "done";
  }

  // 3️⃣ decide reply (logic أولاً)
  let reply = "";

  if (session.step === "idle") {
    reply = "أهلًا بيك 👋 تحب تشوف إيه من المتاح عندنا؟";
  }

  else if (session.step === "color") {
    reply = `تمام 👌 تحب اللون إيه في ${session.product}؟`;
  }

  else if (session.step === "size") {
    reply = "اختار المقاس اللي يريحك 😊 (M / L / XL / 2XL)";
  }

  else if (session.step === "done") {
    reply = `تمام ✅ اخترت ${session.product} ${session.color} مقاس ${session.size}. تحب أكمل معاك الطلب؟`;
  }

  // 4️⃣ Gemini fallback (لو سؤال خارج السيناريو)
  if (model && reply === "") {
    try {
      const prompt = `
أنت بائع لبس شاطر وذوقك عالي.
ردك يكون:
- عربي مصري
- جملة أو اتنين
- لطيف ومش فرض

سياق العميل:
${JSON.stringify(session)}

سؤال العميل:
"${text}"
`;
      const result = await model.generateContent(prompt);
      reply = result.response.text();
    } catch {
      reply = "ممكن توضّحلي أكتر؟ 😊";
    }
  }

  // 5️⃣ save session
  session.history.push({ user: text, bot: reply });
  await redis.set(SESSION_KEY, JSON.stringify(session));

  // 6️⃣ send
  await sendText(senderId, reply, pageAccessToken);
}
