import { sessions } from "./state.js";
import { askAI } from "./ai.js"; // ربط ملف الذكاء الجديد
import { saveLead } from "./lead.js";

export async function handleSales(psid, text) {
    let session = sessions.get(psid) || { step: "start", data: {} };
    
    // إرسال النص للذكاء الاصطناعي للحصول على رد ذكي وملتزم بالقواعد
    const aiReply = await askAI(text, `Step: ${session.step}`);

    switch (session.step) {
        case "start":
            session.step = "service";
            sessions.set(psid, session);
            return "أهلاً بك في Egboot 🚀، كيف يمكننا مساعدتك اليوم؟";

        case "service":
            session.data.service = text;
            session.step = "name";
            sessions.set(psid, session);
            return aiReply; // استخدام رد الـ AI لطلب الاسم بشكل ودي

        case "contact":
            session.data.contact = text;
            session.step = "done";
            await saveLead(session.data); // حفظ البيانات في Sheets
            sessions.set(psid, session);
            return "تم تسجيل طلبك بنجاح! فريقنا سيتواصل معك قريباً. هل لديك أي استفسار آخر؟";

        default:
            return aiReply;
    }
}
