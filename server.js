require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

// الاتصال بقاعدة البيانات مع تجاهل أخطاء الـ IP مؤقتاً لضمان استمرار البوت
const DB_URI = "mongodb://nouraminhero:nour2010@ac-u6m8v7y-shard-00-00.mongodb.net:27017,ac-u6m8v7y-shard-00-01.mongodb.net:27017,ac-u6m8v7y-shard-00-02.mongodb.net:27017/egboot?ssl=true&replicaSet=atlas-13o8p5-shard-0&authSource=admin";

mongoose.connect(DB_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.log('⚠️ DB Connection Issue (Skipping for now):', err.message));

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            if (entry.messaging) {
                for (let event of entry.messaging) {
                    if (event.message && event.message.text) {
                        const userText = event.message.text;
                        console.log(`📩 Message: ${userText}`);

                        try {
                            // استخدام OPENAI_API_KEY اللي ظاهر في صورتك
                            const openaiKey = process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.trim() : null;
                            
                            if (!openaiKey) {
                                console.error("❌ OpenAI Key is missing in Variables!");
                                return;
                            }

                            const gptResponse = await axios.post(
                                'https://api.openai.com/v1/chat/completions',
                                {
                                    model: "gpt-3.5-turbo",
                                    messages: [
                                        { role: "system", content: "أنت مساعد ذكي لمتجر Nour Fashion. رد بلهجة مصرية." },
                                        { role: "user", content: userText }
                                    ]
                                },
                                { headers: { 'Authorization': `Bearer ${openaiKey}` } }
                            );

                            const aiReply = gptResponse.data.choices[0].message.content;

                            // إرسال الرد لفيسبوك
                            const pageToken = process.env.PAGE_ACCESS_TOKEN ? process.env.PAGE_ACCESS_TOKEN.trim() : null;
                            await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${pageToken}`, {
                                recipient: { id: event.sender.id },
                                message: { text: aiReply }
                            });

                        } catch (error) {
                            console.error("⚠️ API Error:", error.response?.data?.error?.message || error.message);
                        }
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
