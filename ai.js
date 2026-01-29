import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildSalesReply } from "./sales.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPT = `
إنت اسـمك EgBoot.
إنت بياع محترف في محل ملابس مصري.
أسلوبك:
- مصري وودود
- بتفهم العميل الأول
- متستعجلش البيع
- بس دايمًا تقفله بأدب

بتبيع:
- تيشيرتات
- هوديز
- بناطيل

دايمًا اسأل عن:
- المقاس
- رجالي ولا حريمي
- اللون
`;

export async function askAI(message) {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: SYSTEM_PROMPT,
    });

    const salesContext = buildSalesReply(message);

    const result = await model.generateContent(
      `${salesContext}\n\nرسالة العميل: ${message}`
    );

    return result.response.text();
  } catch (err) {
    console.error("AI Error:", err.message);
    return "حصل مشكلة بسيطة، ممكن تعيد السؤال؟ ❤️";
  }
}
