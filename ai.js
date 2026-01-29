import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function askAI(userId, message) {
    try {
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            systemInstruction: "أنت بياع مصري شاطر وبيهزر في براند ملابس Egboot. ردودك قصيرة، روشة، وباللهجة المصرية فقط."
        });

        const result = await model.generateContent(message);
        return result.response.text();
    } catch (error) {
        console.error("Gemini Error:", error.message);
        return "منورنا في Egboot يا وحش! ثواني والشبكة تظبط وأرد عليك بكل التفاصيل.";
    }
}
