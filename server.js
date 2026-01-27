require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

// الاتصال بـ MongoDB مع تجاهل أخطاء الـ IP عشان السيرفر ميفصلش
const DB_URI = "mongodb://nouraminhero:nour2010@ac-u6m8v7y-shard-00-00.mongodb.net:27017,ac-u6m8v7y-shard-00-01.mongodb.net:27017,ac-u6m8v7y-shard-00-02.mongodb.net:27017/egboot?ssl=true&replicaSet=atlas-13o8p5-shard-0&authSource=admin";

mongoose.connect(DB_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.log('⚠️ DB Connection Issue:', err.message));

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of entry.messaging || []) {
                if (event.message && event.message.text) {
                    const userText = event.message.text;
                    console.log(`📩 Message: ${userText}`);

                    try {
                        // الكود ده بيقرأ المفتاح الجديد OPENAI_API_KEY مباشرة
                        const response = await axios.post(
                            'https://api.openai.com/v1/chat/completions',
                            {
                                model: "gpt-3.5-turbo",
                                messages: [
                                    { role: "system", content: "أنت مساعد لمتجر Nour Fashion. رد بلهجة مصرية." },
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

                        const aiReply = response.data.choices[0].message.content;

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
