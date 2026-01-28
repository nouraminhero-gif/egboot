import { GoogleGenerativeAI } from "@google/generative-ai";

// السطر ده هو السر.. لازم يقرأ GEMINI_API_KEY من Railway
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function askAI(userId, message) {
    try {
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            systemInstruction: "أنت بياع شاطر في براند ملابس Egboot، رد بلهجة مصرية قصيرة وجذابة."
        });

        const result = await model.generateContent(message);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("AI Error:", error);
        // غيرنا الجملة هنا عشان نتأكد إن التعديل سمع
        return "منورنا في Egboot يا بطل! ثواني والشبكة تضبط وأرد عليك بكل التفاصيل."; 
    }
}
