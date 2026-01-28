import { GoogleGenerativeAI } from "@google/generative-ai";

// بيقرأ المفتاح من Variables اللي في الصورة
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function askAI(userId, message) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(`أنت بياع مصري في براند Egboot. رد باختصار: ${message}`);
        return result.response.text();
    } catch (error) {
        return "ثواني والشبكة تضبط يا بطل.. اؤمرني محتاج مقاس إيه؟";
    }
}
