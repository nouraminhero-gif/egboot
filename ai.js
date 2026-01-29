// ai.js
import fetch from "node-fetch";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = "models/gemini-1.5-pro"; // ✅ ده الموجود حاليًا

export async function aiReply({ system, user }) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY missing");
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: system + "\n\n" + user }
            ]
          }
        ]
      })
    }
  );

  const data = await res.json();

  if (!res.ok) {
    console.error("❌ Gemini error:", JSON.stringify(data, null, 2));
    throw new Error("Gemini request failed");
  }

  return (
    data.candidates?.[0]?.content?.parts?.[0]?.text ||
    "تحب أساعدك في اختيار المقاس؟ 😊"
  );
}
