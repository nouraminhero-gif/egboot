require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const DB_URI = "mongodb://nouraminhero:nour2010@ac-u6m8v7y-shard-00-00.mongodb.net:27017,ac-u6m8v7y-shard-00-01.mongodb.net:27017,ac-u6m8v7y-shard-00-02.mongodb.net:27017/egboot?ssl=true&replicaSet=atlas-13o8p5-shard-0&authSource=admin";

// 1. اتصال سريع بالداتا بيز (بدون ما يعلق السيرفر)
mongoose.connect(DB_URI, { serverSelectionTimeoutMS: 3000 })
    .then(() => console.log('✅ Connected to DB'))
    .catch(err => console.log('⚠️ DB offline, using local mode'));

const Reply = mongoose.model('Reply', new mongoose.Schema({
    keyword: { type: String, unique: true },
    response: String
}), 'replies');

// 2. لوحة التحكم - شغالة دائماً
app.get('/admin', async (req, res) => {
    let rows = "";
    try {
        const allReplies = await Reply.find().maxTimeMS(2000);
        rows = allReplies.map(r => `<tr><td>${r.keyword}</td><td>${r.response}</td></tr>`).join('');
    } catch (e) { rows = "<tr><td colspan='2'>⚠️ الداتا بيز لا تستجيب حالياً</td></tr>"; }

    res.send(`
        <div dir="rtl" style="font-family:sans-serif; padding:20px;">
            <h2>🤖 سيستم Egboot - لوحة الإدارة</h2>
            <form action="/admin/add" method="POST" style="background:#eee; padding:15px; border-radius:10px;">
                <input name="keyword" placeholder="الكلمة" style="width:100%; margin-bottom:10px;" required><br>
                <textarea name="response" placeholder="الرد" style="width:100%; margin-bottom:10px;" required></textarea><br>
                <button type="submit" style="background:green; color:white; width:100%; padding:10px;">إضافة للذاكرة</button>
            </form>
            <table border="1" style="width:100%; margin-top:20px; border-collapse:collapse;">
                <tr style="background:#ddd;"><th>الكلمة</th><th>الرد</th></tr>
                ${rows}
            </table>
        </div>
    `);
});

app.post('/admin/add', async (req, res) => {
    try {
        await Reply.findOneAndUpdate(
            { keyword: req.body.keyword.toLowerCase().trim() },
            { response: req.body.response },
            { upsert: true }
        );
        res.redirect('/admin');
    } catch (e) { res.send("Error saving: " + e.message); }
});

// 3. استقبال رسائل الفيسبوك
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of (entry.messaging || [])) {
                if (event.message && event.message.text) {
                    const userText = event.message.text.toLowerCase().trim();
                    try {
                        const match = await Reply.findOne({ keyword: { $regex: userText, $options: 'i' } }).maxTimeMS(2000);
                        let replyText = match ? match.response : "أهلاً بك في Egboot! 🚀 جاري تحويلك للمختص.";
                        
                        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
                            recipient: { id: event.sender.id },
                            message: { text: replyText }
                        });
                    } catch (e) { console.log("❌ Loop Error"); }
                }
            }
        }
        res.sendStatus(200);
    }
});

app.get('/webhook', (req, res) => {
    res.send(req.query['hub.challenge']);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 System Ready on Port ${PORT}`));
