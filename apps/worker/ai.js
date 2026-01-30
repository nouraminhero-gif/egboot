// ai.js
import { FAQ } from "./brain/faq.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";

export async function aiFallbackAnswer({ question, sessionSummary }) {
  if (!GEMINI_API_KEY) {
    return {
      answer: "معلش، مش قادر أجاوب دلوقتي. ممكن تعيد السؤال؟",
      ok: false,
    };
  }

  // Context ثابت + سياق السيشن الحالي
  const context = `
أنت مساعد مبيعات لصفحة ملابس.
معلومات ثابتة:
- ${FAQ.shipping_price}
- ${FAQ.delivery_time}
- ${FAQ.payment}
- ${FAQ.exchange}

سياق العميل الحالي:
${sessionSummary}

مهم:
- جاوب على سؤال العميل فقط باختصار ووضوح.
- ممنوع تسأل أسئلة جديدة إلا لو لازم لتوضيح السؤال نفسه.
- ممنوع تغيّر خطوات الطلب.`;

  const prompt = `
السؤال: ${question}
الرد:`;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: context + "\n\n" + prompt }] },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 180,
          },
        }),
      }
    );

    const data = await resp.json();

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "معلش، مش قادر أجاوب دلوقتي.";

    return { answer: text, ok: true };
  } catch (e) {
    return { answer: "حصل مشكلة تقنية بسيطة، جرّب تاني.", ok: false };
  }
}
