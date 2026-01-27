require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

// 1. قاعدة البيانات - الربط المباشر لضمان تخطي حظر الـ IP
const DB_URI = "mongodb://nouraminhero:nour2010@ac-u6m8v7y-shard-00-00.mongodb.net:27017,ac-u6m8v7y-shard-00-01.mongodb.net:27017,ac-u6m8v7y-shard-00-02.mongodb.net:27017/egboot?ssl=true&replicaSet=atlas-13o8p5-shard-0&authSource=admin";

mongoose.connect(DB_URI)
    .then(() => console.log('✅ Connected to MongoDB!'))
    .catch(err => console.log('❌ DB Error:', err.message));

// 2. استقبال رسائل الفيسبوك
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of entry.messaging) {
                if (event.message && event.message.text) {
                    const userText = event.message.text;
                    console.log(`📩 New Message: ${userText}`);

                    try {
                        // الرابط ده هو الوحيد اللي شغال دلوقتي بدون 404 (v1beta/models/gemini-pro)
                        const API_KEY = process.env.GEMINI_API_KEY.trim();
                        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${API_KEY}`;

                        const response = await axios.post(geminiUrl, {
                            contents: [{ parts: [{ text: `أنت مساعد ذكي لمتجر Nour Fashion في مصر. رد بلهجة مصرية قصيرة: ${userText}` }] }]
                        });

                        // التأكد إن الرد جه من Gemini
                        if (response.data.candidates && response.data.candidates[0].content) {
                            const aiReply = response.data.candidates[0].content.parts[0].text;
                            console.log(`🤖 AI Reply: ${aiReply}`);

                            // إرسال الرد لفيسبوك
                            const PAGE_TOKEN = process.env.PAGE_ACCESS_TOKEN.trim();
                            await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_TOKEN}`, {
                                recipient: { id: event.sender.id },
                                message: { text: aiReply }
                            });
                        }
                    } catch (error) {
                        // هنا السيرفر هيقولنا "بالظبط" إيه اللي مضايق جوجل
                        console.error("⚠️ Detailed Error:", error.response?.data?.error?.message || error.message);
                    }
                }
            }
        }
        res.sendStatus(200);
    }
});

app.get('/webhook', (req, res) => {
    const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "egboot_2026";
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.send(req.query['hub.challenge']);
    } else { res.send('Wrong Token'); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Egboot Server Live on ${PORT}`));
