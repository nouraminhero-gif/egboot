import axios from "axios";

export async function askAI(message, context = "") {
    try {
        const res = await axios.post(
            "https://api.openai.com/v1/chat/completions",
            {
                model: "gpt-4o-mini", // الموديل المعتمد
                messages: [
                    {
                        role: "system",
                        content: `أنت خبير مبيعات في Egboot. اجمع الاسم، الخدمة، والتواصل. 
                        ممنوع طلب CVV أو وعود كاذبة.
                        يجب إنهاء الرد بـ CTA واضح.
                        السياق: ${context}`
                    },
                    { role: "user", content: message }
                ]
            },
            {
                headers: { Authorization: `Bearer ${process.env.AI_API_KEY}` }
            }
        );
        return res.data.choices[0].message.content;
    } catch (error) {
        return "حصل خطأ بسيط، ممكن تكرر طلبك؟";
    }
}
