import { GoogleGenerativeAI } from "@google/generative-ai";

// استدعاء مفتاح Gemini من الـ Variables اللى ضفناها فى Railway
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function askAI(userId, message) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        
        // التوجيهات الخاصة ببراند Egboot
        const prompt = `أنت مساعد ذكي لمتجر "Egboot" للملابس في مصر.
        اسمك "إيجيبوت".
        رد بلهجة مصرية عامية مبهجة، خفيفة الظل، وعملية جداً.
        لو العميل سأل عن أسعار أو مقاسات، قوله "ابعتلي صورة القطعة اللى عجبتك وهرد عليك بالتفاصيل فوراً يا فنان".
        رسالة العميل هي: ${message}`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("Gemini Error:", error.message);
        // رد احتياطي محترم لو الخدمة هنجت عشان الزبون ميهربش
        return "معاك يا فندم، براجع السيستم حالاً وهرد عليك بكل التفاصيل!";
    }
}
