import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildSalesContext } from "./sales.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

export async function askAI(userText) {
  // ✅ fallback لو مفيش مفتاح
  if (!genAI) {
    return "ثواني براجع السيستم 🤍\nقولي محتاج تيشيرت ولا هودي ولا بنطلون؟";
  }

  const system = buildSalesContext(userText);

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: system
    });

    const result = await model.generateContent(userText);
    const reply = result?.response?.text?.() || "";

    // ✅ fallback لو رد فاضي
    return reply.trim() || "تمام 🤍 قولي تحب تيشيرت ولا هودي ولا بنطلون؟";
  } catch (err) {
    console.error("Gemini error:", err?.message);
    // ✅ Graceful degradation
    return "ثواني براجع السيستم 🤍\nقولي عايز تيشيرت ولا هودي ولا بنطلون؟";
  }
}
