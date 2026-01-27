require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

// 1. رابط الداتا بيز المباشر (Egboot)
const DB_URI = "mongodb://nouraminhero:nour2010@ac-u6m8v7y-shard-00-00.mongodb.net:27017,ac-u6m8v7y-shard-00-01.mongodb.net:27017,ac-u6m8v7y-shard-00-02.mongodb.net:27017/egboot?ssl=true&replicaSet=atlas-13o8p5-shard-0&authSource=admin";

mongoose.connect(DB_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas'))
    .catch(err => console.log('❌ DB Error:', err.message));

// 2. معالجة رسايل الفيسبوك والربط مع Gemini
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of entry.messaging) {
                if (event.message && event.message.text) {
                    try {
                        const userMessage = event.message.text;
                        console.log(`📩 New message: ${userMessage}`);

                        // استخدام موديل gemini-pro (الرابط المستقر للنسخة v1beta)
                        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY.trim()}`;
                        
                        const geminiRes = await axios.post(geminiUrl, {
                            contents: [{ parts: [{ text: `أنت مساعد ذكي لمتجر Nour Fashion. رد بمصري: ${userMessage}` }] }]
                        });

                        const aiReply = geminiRes.data.candidates[0].content.parts[0].text;
                        console.log(`🤖 AI Reply: ${aiReply}`);

                        // إرسال الرد للعميل
                        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN.trim()}`, {
                            recipient: { id: event.sender.id },
                            message: { text: aiReply }
                        });

                    } catch (error) {
                        // طباعة تفاصيل الخطأ كاملة للتشخيص
                        console.error("⚠️ Detailed Error:", error.response?.data?.error || error.message);
                    }
                }
            }
        }
        res.sendStatus(200);
    }
});

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
        res.send(req.query['hub.challenge']);
    } else { res.send('Wrong Token'); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Egboot Server Live on ${PORT}`));
