require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

// 1. الاتصال بقاعدة البيانات (Egboot)
const DB_URI = "mongodb://nouraminhero:nour2010@ac-u6m8v7y-shard-00-00.mongodb.net:27017,ac-u6m8v7y-shard-00-01.mongodb.net:27017,ac-u6m8v7y-shard-00-02.mongodb.net:27017/egboot?ssl=true&replicaSet=atlas-13o8p5-shard-0&authSource=admin";

mongoose.connect(DB_URI)
    .then(() => console.log('✅ DATABASE CONNECTED SUCCESSFULLY!'))
    .catch(err => console.error('❌ DB CONNECTION ERROR:', err.message));

// 2. التحقق من الـ Webhook لفيسبوك
app.get('/webhook', (req, res) => {
    const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "egboot_2026";
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.send(req.query['hub.challenge']);
    } else {
        res.send('Error, wrong validation token');
    }
});

// 3. استقبال ومعالجة الرسائل
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        for (let entry of body.entry) {
            if (entry.messaging) {
                for (let event of entry.messaging) {
                    if (event.message && event.message.text) {
                        const senderId = event.sender.id;
                        const userText = event.message.text;

                        console.log(`📩 Message from ${senderId}: ${userText}`);

                        try {
                            // نداء Gemini - تم تحديث الرابط لـ gemini-1.5-flash-latest لحل مشكلة 404
                            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${process.env.GEMINI_API_KEY.trim()}`;
                            
                            const geminiResponse = await axios.post(geminiUrl, {
                                contents: [{ parts: [{ text: `أنت مساعد ذكي لمتجر Nour Fashion في مصر. رد بلهجة مصرية ودودة على: ${userText}` }] }]
                            });

                            const botReply = geminiResponse.data.candidates[0].content.parts[0].text;
                            console.log(`🤖 AI Reply: ${botReply}`);

                            // إرسال الرد إلى Messenger
                            await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN.trim()}`, {
                                recipient: { id: senderId },
                                message: { text: botReply }
                            });

                        } catch (error) {
                            console.error("⚠️ ERROR DETAIL:", error.response?.data?.error || error.message);
                        }
                    }
                }
            }
        }
        res.sendStatus(200);
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Egboot Server is running on port ${PORT}`));
