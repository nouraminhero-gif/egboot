require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(express.json());

// ربط Gemini بالمفتاح الخاص بك
const genAI = new GoogleGenerativeAI("AIzaSyDt_0jph7Stg6GBG22fihPwkSptZ1nOdMU");

// تعليمات "شخصية البياع" لـ Gemini
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    systemInstruction: `أنت بائع محترف في براند Egboot للملابس. 
    مهمتك: البيع بذكاء، إقناع العميل، وإدارة الحوار بلهجة مصرية محترمة وشاطرة.
    
    البيانات:
    - القميص: 450 جنيه.
    - التيشيرت: 250 جنيه.
    - المقاسات: M (60-70kg), L (70-80kg), XL (80-90kg), 2XL (90-105kg), 3XL (105-120kg).
    
    قواعد البيع:
    1. لو العميل قال وزنه، حدد له المقاس المناسب فوراً وبثقة (ممنوع ردود عامة).
    2. لو العميل كرر كلامه أو شتم، امتص غضبه وغير صيغة الكلام (ممنوع تكرار الرد).
    3. حافظ على "سياق" المحادثة؛ لو بنكلم عن قميص، خليك في القميص.
    4. اطلب بيانات الشحن (الاسم، العنوان، التليفون) في نهاية الحوار لعمل الأوردر.`
});

const chatHistories = {};

app.post('/webhook', async (req, res) => {
    const { object, entry } = req.body;
    if (object === 'page') {
        for (let e of entry) {
            for (let m of (e.messaging || [])) {
                if (m.message && m.message.text) {
                    const senderId = m.sender.id;
                    const userMsg = m.message.text;

                    if (!chatHistories[senderId]) chatHistories[senderId] = [];

                    try {
                        const chat = model.startChat({ history: chatHistories[senderId] });
                        const result = await chat.sendMessage(userMsg);
                        const responseText = result.response.text();

                        chatHistories[senderId].push({ role: "user", parts: [{ text: userMsg }] });
                        chatHistories[senderId].push({ role: "model", parts: [{ text: responseText }] });

                        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
                            recipient: { id: senderId },
                            message: { text: responseText }
                        });
                    } catch (error) {
                        console.error("Gemini Error");
                    }
                }
            }
        }
        res.sendStatus(200);
    }
});

app.listen(process.env.PORT || 8080);
