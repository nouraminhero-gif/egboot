require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

// 1. قاعدة بيانات Egboot (مع ضبط وقت الانتظار لمنع الانهيار)
const DB_URI = "mongodb://nouraminhero:nour2010@ac-u6m8v7y-shard-00-00.mongodb.net:27017,ac-u6m8v7y-shard-00-01.mongodb.net:27017,ac-u6m8v7y-shard-00-02.mongodb.net:27017/egboot?ssl=true&replicaSet=atlas-13o8p5-shard-0&authSource=admin";

mongoose.connect(DB_URI, { serverSelectionTimeoutMS: 3000 })
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.log('⚠️ DB Connection Issue (Server will stay live):', err.message));

// 2. معالجة الرسائل والرد بـ ChatGPT
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            if (entry.messaging) {
                for (let event of entry.messaging) {
                    if (event.message && event.message.text) {
                        const userText = event.message.text;
                        console.log(`📩 New Message: ${userText}`);

                        try {
                            // نداء OpenAI باستخدام مفتاحك sk-proj المباشر
                            const gptRes = await axios.post('https://api.openai.com/v1/chat/completions', {
                                model: "gpt-3.5-turbo",
                                messages: [
                                    { role: "system", content: "أنت مساعد ذكي لمتجر Nour Fashion. رد بلهجة مصرية قصيرة." },
                                    { role: "user", content: userText }
                                ]
                            }, {
                                headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
                            });

                            const aiReply = gptRes.data.choices[0].message.content;
                            console.log(`🤖 ChatGPT Reply: ${aiReply}`);

                            // إرسال الرد لفيسبوك
                            await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
                                recipient: { id: event.sender.id },
                                message: { text: aiReply }
                            });

                        } catch (error) {
                            console.error("⚠️ Error handling message:", error.response?.data?.error?.message || error.message);
                        }
                    }
                }
            }
        }
        res.sendStatus(200);
    }
});

// 3. تأكيد الـ Webhook
app.get('/webhook', (req, res) => {
    const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "egboot_2026";
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.send(req.query['hub.challenge']);
    } else { res.send('Wrong Token'); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Egboot Server Hard-Started on Port ${PORT}`));
