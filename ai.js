import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function askAI(userId, message) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `أنت بياع في محل ملابس اسمه Egboot، رد بلهجة مصرية قصيرة جداً. الزبون بيقول: ${message}`;
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (error) {
        // لو فشل، السيرفر هيكتب السبب في الـ Logs
        console.error("Gemini Error Detail:", error.message);
        return "منورنا في Egboot، ثواني وهرد على سعادتك بكل التفاصيل."; 
    }
}
