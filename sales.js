import { sessions } from "./state.js"; // استيراد الذاكرة المؤقتة
import { askAI } from "./ai.js";      // استيراد محرك الذكاء الاصطناعي
import { saveLead } from "./lead.js";  // استيراد دالة حفظ البيانات

export async function handleSales(psid, text) {
    // 1. جلب حالة المستخدم الحالية أو إنشاء حالة جديدة
    let session = sessions.get(psid) || { step: "start", data: {} };

    // 2. تحديث السياق للذكاء الاصطناعي ليعرف أين نحن
    const context = `العميل حالياً في خطوة: ${session.step}. البيانات المجموعة حتى الآن: ${JSON.stringify(session.data)}`;

    switch (session.step) {
        case "start":
            session.step = "service";
            sessions.set(psid, session);
            return "أهلاً بك في Egboot 🚀، تحب نساعدك في أي خدمة برمجية النهاردة؟ (اكتب نوع الخدمة)";

        case "service":
            session.data.service = text;
            session.step = "name";
            sessions.set(psid, session);
            return "تمام جداً 👍، ممكن أعرف اسم حضرتك الكريم؟";

        case "name":
            session.data.name = text;
            session.step = "contact";
            sessions.set(psid, session);
            return `تشرفنا يا ${text}، عشان نقدر نتواصل معاك ونبعت العرض، ممكن رقمك أو الإيميل؟`;

        case "contact":
            session.data.contact = text;
            session.step = "done";
            
            // حفظ البيانات فوراً في Google Sheets
            await saveLead(session.data); 
            
            sessions.set(psid, session);
            
            // الرد النهائي مع CTA واضح
            return `تم استلام طلبك بنجاح ✅\nالخدمة: ${session.data.service}\nالاسم: ${session.data.name}\nالتواصل: ${session.data.contact}\n\nفريق Egboot هيتواصل معاك في أقرب وقت. هل عندك أي استفسار تاني؟`;

        default:
            // في حالة الخروج عن النص، اترك الذكاء الاصطناعي يقرر الرد المناسب
            return await askAI(text, context);
    }
}
