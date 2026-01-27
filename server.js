require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

// تشخيص المفاتيح في الـ Logs عشان نتأكد إن Railway قاريها
console.log("🔍 Checking Environment Variables...");
console.log("GEMINI_API_KEY set:", !!process.env.GEMINI_API_KEY);
console.log("PAGE_ACCESS_TOKEN set:", !!process.env.PAGE_ACCESS_TOKEN);

const DB_URI = "mongodb://nouraminhero:nour2010@ac-u6m8v7y-shard-00-00.mongodb.net:27017,ac-u6m8v7y-shard-00-01.mongodb.net:27017,ac-u6m8v7y-shard-00-02.mongodb.net:27017/egboot?ssl=true&replicaSet=atlas-13o8p5-shard-0&authSource=admin";

mongoose.connect(DB_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas'))
    .catch(err => console.log('❌ Database Error:', err.message));

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
        res.send(req.query['hub.challenge']);
    } else {
        res.send('Token Mismatch');
    }
});

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of entry.messaging) {
                if (event.message && event.message.text) {
                    try {
                        const userMessage = event.message.text;
                        console.log(`📩 New message: ${userMessage}`);

                        // طلب الرد من Gemini
                        const geminiRes = await axios.post(
                            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY.trim()}`,
                            { contents: [{ parts: [{ text: `رد بلهجة مصرية قصيرة: ${userMessage}` }] }] }
                        );

                        const aiReply = geminiRes.data.candidates[0].content.parts[0].text;
                        console.log(`🤖 AI says: ${aiReply}`);

                        // إرسال الرد للفيسبوك
                        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN.trim()}`, {
                            recipient: { id: event.sender.id },
                            message: { text: aiReply }
                        });

                    } catch (error) {
                        // طباعة الخطأ بالتفصيل عشان نعرف المشكلة فين بالظبط
                        console.error("⚠️ Detailed Error:", error.response?.data?.error || error.message);
                    }
                }
            }
        }
        res.sendStatus(200);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Egboot Server is Ready on Port ${PORT}`));
