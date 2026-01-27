require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// 1. قراءة المتغيرات من Railway (بدون trim لضمان عدم وجود أخطاء)
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const PAGE_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "egboot_2026";

app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of (entry.messaging || [])) {
                if (event.message && event.message.text) {
                    const userText = event.message.text;
                    const senderId = event.sender.id;
                    console.log(`📩 رسالة من: ${senderId} - النص: ${userText}`);

                    try {
                        let aiReply = "";

                        // 2. محاولة الاتصال بـ OpenAI
                        try {
                            const gptRes = await axios.post('https://api.openai.com/v1/chat/completions', {
                                model: "gpt-3.5-turbo",
                                messages: [{ role: "user", content: userText }]
                            }, {
                                headers: { 'Authorization': `Bearer ${OPENAI_KEY}` },
                                timeout: 5000 // ينتظر 5 ثواني فقط
                            });
                            aiReply = gptRes.data.choices[0].message.content;
                        } catch (aiErr) {
                            // لو فيه مشكلة في الرصيد (Quota) زي ما ظهر في الصور
                            console.log("⚠️ OpenAI Error: " + (aiErr.response?.data?.error?.message || aiErr.message));
                            aiReply = "أهلاً بك في Egboot! 🚀 السيرفر شغال والربط سليم، لكن يبدو أن هناك مشكلة في رصيد الذكاء الاصطناعي حالياً.";
                        }

                        // 3. إرسال الرد للفيسبوك (سواء رد AI أو الرد التلقائي)
                        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_TOKEN}`, {
                            recipient: { id: senderId },
                            message: { text: aiReply }
                        });
                        console.log("✅ تم إرسال الرد للعميل بنجاح");

                    } catch (fbErr) {
                        console.error("❌ Facebook API Error: ", fbErr.response?.data || fbErr.message);
                    }
                }
            }
        }
        res.sendStatus(200);
    }
});

// تأكيد الـ Webhook
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.send(req.query['hub.challenge']);
    } else { res.send('Wrong Token'); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 EG-BOOT IS LIVE ON PORT ${PORT}`));
