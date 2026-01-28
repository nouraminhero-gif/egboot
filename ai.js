import { GoogleGenerativeAI } from "@google/generative-ai";

// استخدام المفتاح الخاص بك
const genAI = new GoogleGenerativeAI("AIzaSyDt_0jph7Stg6GBG22fihPwkSptZ1nOdMU");

export async function askAI(message, context = "") {
    try {
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            systemInstruction: `أنت بائع محترف وذكي جداً في براند ملابس Egboot.
            شخصيتك: لبق، بتعرف تقنع الزبون، ودمك خفيف بلهجة مصرية.
            
            قواعدك الصارمة:
            1. هدفك تجمع بيانات الأوردر (الاسم، المنتج، العنوان، التليفون).
            2. لو الزبون سأل عن مقاس، اسأله عن وزنه وطبق الجدول ده:
               - M: 60-70kg | L: 70-80kg | XL: 80-90kg | 2XL: 90-105kg.
            3. ممنوع تكرار الكلام. لو العميل قال "غالي" أو شتم، امتص غضبه بذكاء بياع شاطر.
            4. ممنوع تطلب أي بيانات بنكية أو CVV نهائياً.
            5. لازم تنهي كل رد بـ "طلب فعل" (CTA) زي: (تحب أحجزلك المقاس؟ / أبعتلك الألوان المتاحة؟).
            
            سياق المحادثة السابقة: ${context}`
        });

        const result = await model.generateContent(message);
        return result.response.text();
    } catch (error) {
        console.error("AI Error:", error);
        return "معلش يا ذوق، ضغط الشغل عالي شوية، ممكن تبعت سؤالك تاني؟"; 
    }
}
