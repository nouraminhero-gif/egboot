import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI("AIzaSyDt_0jph7Stg6GBG22fihPwkSptZ1nOdMU");

export async function askAI(userId, message) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `أنت بياع ذكي في براند ملابس اسمه Egboot. رد بلهجة مصرية عامية وقصيرة جداً. العميل بيقول: ${message}`;
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (error) {
        console.error("AI Error:", error);
        return "منورنا في Egboot، ثواني وبكون معاك يا بطل."; 
    }
}
