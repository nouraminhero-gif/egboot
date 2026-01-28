import { GoogleGenerativeAI } from "@google/generative-ai";
import { getKnowledge, saveExperience } from "./db_handler.js";

const genAI = new GoogleGenerativeAI("AIzaSyDt_0jph7Stg6GBG22fihPwkSptZ1nOdMU");

export async function askAI(userId, message) {
    const memory = getKnowledge(); // مذاكرة الدروس السابقة
    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        systemInstruction: `أنت بياع Egboot الذكي. تعلم من المواقف دي:\n${memory}
        قواعدك:
        - بيع بذكاء ولهجة مصرية.
        - لو الزبون اعترض أو شتم، امتص غضبه بأسلوب جديد (ممنوع التكرار).
        - احسب المقاسات: (60-70kg: M, 70-80kg: L, 80-90kg: XL, 90-105kg: 2XL).
        - اطلب الاسم والتليفون والعنوان لقفل الأوردر.`
    });

    try {
        const result = await model.generateContent(message);
        const reply = result.response.text();
        saveExperience(userId, message, reply); // تطوير الذات فوراً
        return reply;
    } catch (e) { return "معاك يا فندم، اؤمرني أساعدك إزاي؟"; }
}
