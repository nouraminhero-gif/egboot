import { GoogleGenerativeAI } from "@google/generative-ai";
import { getPastExperiences, saveSaleExperience } from "./db_handler.js";

const genAI = new GoogleGenerativeAI("AIzaSyDt_0jph7Stg6GBG22fihPwkSptZ1nOdMU");

export async function askAI(userId, userMessage) {
    const memory = getPastExperiences(); // جلب الخبرة المحلية

    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        systemInstruction: `أنت بياع Egboot، لست مجرد بوت رد آلي. 
        مهمتك: البيع، الإقناع، والتعلم.
        خبراتك السابقة من الـ Database الخاصة بك:\n${memory}
        
        قواعدك:
        1. لو الزبون شتم أو اعترض، امتص غضبه بذكاء بياع مصري "حريف" (ممنوع التكرار).
        2. الوزن والمقاس: احسب المقاس بذكاء (60-70kg: M, 70-80kg: L, 80-90kg: XL, 90-105kg: 2XL).
        3. الهدف: جمع (الاسم، العنوان، التليفون) لعمل الأوردر.
        4. الختام: دائماً اسأل سؤالاً (CTA) يدفع الزبون للخطوة التالية.`
    });

    try {
        const result = await model.generateContent(userMessage);
        const reply = result.response.text();
        
        // حفظ الموقف فوراً في الذاكرة لتطوير الذكاء
        saveSaleExperience(userId, userMessage, reply);
        
        return reply;
    } catch (err) {
        return "منور يا بطل في Egboot، ابعت سؤالك تاني والشبكة هتضبط.";
    }
}
