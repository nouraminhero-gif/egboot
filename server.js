require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

// 1. قاعدة البيانات - Egboot
const DB_URI = "mongodb://nouraminhero:nour2010@ac-u6m8v7y-shard-00-00.mongodb.net:27017,ac-u6m8v7y-shard-00-01.mongodb.net:27017,ac-u6m8v7y-shard-00-02.mongodb.net:27017/egboot?ssl=true&replicaSet=atlas-13o8p5-shard-0&authSource=admin";

mongoose.connect(DB_URI)
    .then(() => console.log('✅ DATABASE CONNECTED!'))
    .catch(err => console.error('❌ DB ERROR:', err.message));

// 2. استقبال رسائل الفيسبوك والرد بـ ChatGPT
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
                            const gptResponse = await axios.post(
                                'https://api.openai.com/v1/chat/completions',
                                {
                                    model: "gpt-3.5-turbo",
                                    messages: [
                                        { role: "system", content: "أنت مساعد ذكي لمتجر Nour Fashion في مصر. رد بلهجة مصرية قصيرة وودودة." },
                                        { role: "user", content: userText }
                                    ]
                                },
                                {
                                    headers: {
                                        'Authorization': `Bearer ${process.env.OPENAI_API_KEY.trim()}`,
                                        'Content-Type': 'application/json'
                                    }
                                }
                            );

                            const aiReply = gptResponse.data.choices[0].message.content;
                            console.log(`🤖 ChatGPT Reply: ${aiReply}`);

                            await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN.trim()}`, {
                                recipient: { id: event.sender.id },
                                message: { text: aiReply }
                            });

                        } catch (error) {
                            console.error("⚠️ AI Error:", error.response?.data?.error?.message || error.message);
                        }
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
