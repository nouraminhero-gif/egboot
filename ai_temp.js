import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.warn("⚠️ GEMINI_API_KEY is missing");
}

const genAI = GEMINI_API_KEY
  ? new GoogleGenerativeAI(GEMINI_API_KEY)
  : null;

const SYSTEM_PROMPT = `
You are Egboot, an assistant for an Egyptian clothing store.
Speak in friendly Egyptian Arabic slang.
Help customers with:
- clothing choices
- sizes
- colors
- prices
- offers
Keep answers short and friendly.
If the question is not about clothes, gently redirect.
`;

// ===== main function =====
export async function askAI(message) {
  if (!genAI) {
    return "ثواني براجع السيستم 🤍";
  }

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: SYSTEM_PROMPT,
    });

    const result = await model.generateContent(message);
    const response = result?.response?.text?.();

    return response || "ثواني براجع السيستم 🤍";
  } catch (err) {
    console.error("Gemini error:", err.message);
    return "ثواني براجع السيستم 🤍";
  }
}
