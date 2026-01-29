import { GoogleGenerativeAI } from "@google/generative-ai";
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
export async function askAI(userId, message) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const result = await model.generateContent(`أنت مساعد لمتجر ملابس مصري اسمه إيجيبوت، رد بلهجة مصرية مبهجة على: ${message}`);
        return result.response.text();
    } catch (e) { return "معاك يا فنان، ثواني وبراجع طلبك!"; }
}
