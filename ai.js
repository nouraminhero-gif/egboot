import { GoogleGenerativeAI } from "@google/generative-ai";

const key = process.env.GEMINI_API_KEY;
const genAI = key ? new GoogleGenerativeAI(key) : null;

export async function askAI({ systemPrompt, userMessage }) {
  if (!genAI) {
    return { reply: "ثواني براجع السيستم 🤍", updates: {} };
  }

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: systemPrompt
    });

    const result = await model.generateContent(userMessage);
    const raw = result?.response?.text?.() || "";

    // حاول تبارس JSON حتى لو الموديل زوّد كلام
    const json = extractJson(raw);
    if (!json) {
      return { reply: "ثواني كده.. قولي المقاس واللون والمحافظة؟ 🤍", updates: {} };
    }
    return {
      reply: json.reply || "تمام ❤️ قولي المقاس واللون والمحافظة؟",
      updates: json.updates || {},
      suggestedProductId: json.suggestedProductId || null
    };
  } catch (e) {
    return { reply: "ثواني براجع السيستم 🤍", updates: {} };
  }
}

function extractJson(text) {
  try {
    // يلقط أول بلوك JSON
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    const slice = text.slice(start, end + 1);
    return JSON.parse(slice);
  } catch {
    return null;
  }
}
