require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 1. الربط بالداتا بيز
const DB_URI = "mongodb://nouraminhero:nour2010@ac-u6m8v7y-shard-00-00.mongodb.net:27017,ac-u6m8v7y-shard-00-01.mongodb.net:27017,ac-u6m8v7y-shard-00-02.mongodb.net:27017/egboot?ssl=true&replicaSet=atlas-13o8p5-shard-0&authSource=admin";
mongoose.connect(DB_URI).then(() => console.log('✅ Connected to Egboot Engine'));

const Reply = mongoose.model('Reply', new mongoose.Schema({
    keyword: String,
    response: String
}), 'replies');

// --- [ لوحة التحكم البسيطة ] ---
app.get('/admin', (req, res) => {
    res.send(`
        <body style="font-family:sans-serif; direction:rtl; padding:20px;">
            <h2>🤖 لوحة تحكم Egboot - علم البوت بتاعك</h2>
            <form action="/admin/add" method="POST">
                <input name="keyword" placeholder="الكلمة (مثلا: سعر)" required>
                <textarea name="response" placeholder="الرد الذكي" required></textarea>
                <button type="submit">إضافة للذاكرة</button>
            </form>
        </body>
    `);
});

app.post('/admin/add', async (req, res) => {
    await Reply.create(req.body);
    res.send('✅ البوت اتعلم المعلومة دي! <a href="/admin">ارجع ضيف غيرها</a>');
});

// --- [ معالج الرسائل الذكي ] ---
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of (entry.messaging || [])) {
                if (event.message && event.message.text) {
                    const userText = event.message.text.toLowerCase();
                    
                    // بحث ذكي في الداتا بيز (يجد الكلمات حتى لو جزء من الجملة)
                    const match = await Reply.findOne({ keyword: { $regex: userText, $options: 'i' } });
                    
                    let finalReply = match ? match.response : "أهلاً بك! جاري تحويلك لممثل خدمة العملاء.";

                    await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
                        recipient: { id: event.sender.id },
                        message: { text: finalReply }
                    });
                }
            }
        }
        res.sendStatus(200);
    }
});

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
        res.send(req.query['hub.challenge']);
    } else { res.send('Wrong'); }
});

app.listen(process.env.PORT || 8080, () => console.log('🚀 SYSTEM READY'));
