// ai.js
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

export async function askAI({ system, user, meta = {} }) {
  if (!GEMINI_API_KEY) {
    console.warn("⚠️ GEMINI_API_KEY missing");
    return "";
  }

  // Gemini endpoint (v1beta generateContent)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          { text: `SYSTEM:\n${system}\n\nUSER:\n${user}\n\nMETA:\n${JSON.stringify(meta)}` },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 300,
    },
  };

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const t = await r.text();
      console.error("❌ Gemini error:", r.status, t);
      return "";
    }

    const data = await r.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";

    return text;
  } catch (e) {
    console.error("❌ askAI exception:", e.message);
    return "";
  }
}
