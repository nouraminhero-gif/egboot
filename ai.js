import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs';

// إعداد Gemini بمفتاحك الخاص
const genAI = new GoogleGenerativeAI("AIzaSyDt_0jph7Stg6GBG22fihPwkSptZ1nOdMU");

/**
 * وظيفة askAI: هي المحرك اللي بيفكر قبل ما يرد
 * @param {string} userId - معرف العميل عشان نذاكر تاريخه
 * @param {string} message - رسالة العميل الحالية
 */
export async function askAI(userId, message) {
    try {
        // 1. قراءة قاعدة البيانات المحلية للخبرات والدروس
        let experienceData = "";
        try {
            const data = JSON.parse(fs.readFileSync('./sales_logic.json', 'utf8') || "[]");
            // جلب آخر 5 مواقف ناجحة عشان البوت يقلدها
            experienceData = data.slice(-5).map(d => `موقف: ${d.situation} -> الرد الناجح: ${d.result}`).join('\n');
        } catch (e) {
            experienceData = "لا توجد خبرات سابقة بعد، ابدأ بالتعرف على العميل.";
        }

        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            systemInstruction: `أنت "بياع Egboot الذكي"، لست مجرد بوت.
            
            شخصيتك: بياع مصري شاطر، لبق، بيعرف يقنع الزبون بذكاء.
            
            دستور العمل الخاص بك:
            1. التعلم التلقائي: بناءً على الخبرات دي:\n${experienceData}\nطور أسلوبك وتجنب تكرار الردود المملة.
            2. خبير المقاسات: لو العميل سأل عن مقاس، اطلب وزنه وطبق (M: 60-70k, L: 70-80k, XL: 80-90k, 2XL: 90-105k).
            3. إدارة الاعتراضات: لو العميل شتم (مثل "احا") أو قال "غالي"، امتص غضبه بذكاء بائع محترف وركز على جودة الخامة.
            4. هدفك النهائي: سحب العميل لإتمام الأوردر وطلب (الاسم، العنوان، التليفون).
            5. قواعد الأمان: ممنوع طلب أي بيانات بنكية أو CVV.
            6. قاعدة الختام: لازم تنهي كل رسالة بـ (Call to Action) أو سؤال يخلي الزبون يكمل البيعة.`
        });

        const result = await model.generateContent(message);
        const reply = result.response.text();

        // 2. تحديث قاعدة البيانات المحلية (التعلم الذاتي)
        saveToLocalDB(userId, message, reply);

        return reply;
    } catch (error) {
        console.error("AI Error:", error);
        return "منور يا غالي في Egboot، معلش الضغط عالي شوية، أقدر أساعدك في إيه تاني؟";
    }
}

/**
 * وظيفة حفظ الموقف في الـ Database المحلية ليتعلم منها الـ AI
 */
function saveToLocalDB(userId, situation, result) {
    const dbPath = './sales_logic.json';
    try {
        let data = [];
        if (fs.existsSync(dbPath)) {
            data = JSON.parse(fs.readFileSync(dbPath, 'utf8') || "[]");
        }
        data.push({
            date: new Date().toISOString(),
            userId,
            situation,
            result
        });
        // حفظ الملف محلياً في مشروعك
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
    } catch (e) {
        console.log("Database Save Error");
    }
}
