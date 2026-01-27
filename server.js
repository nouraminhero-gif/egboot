require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const DB_URI = "mongodb://nouraminhero:nour2010@ac-u6m8v7y-shard-00-00.mongodb.net:27017,ac-u6m8v7y-shard-00-01.mongodb.net:27017,ac-u6m8v7y-shard-00-02.mongodb.net:27017/egboot?ssl=true&replicaSet=atlas-13o8p5-shard-0&authSource=admin";

// ربط سريع مع مهلة 3 ثواني فقط
mongoose.connect(DB_URI, { serverSelectionTimeoutMS: 3000 })
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.log('⚠️ DB Timeout - Using Safe Mode'));

const Reply = mongoose.model('Reply', new mongoose.Schema({
    keyword: { type: String, unique: true },
    response: String
}), 'replies');

// --- لوحة التحكم ---
app.get('/admin', async (req, res) => {
    try {
        // الـ catch هنا بيضمن إن لو الداتا بيز وقعت، الصفحة تفتح برضه بجدول فاضي
        const allReplies = await Reply.find().maxTimeMS(2000).catch(() => []);
        let rows = allReplies.map(r => `<tr><td style="padding:8px; border:1px solid #ddd;">${r.keyword}</td><td style="padding:8px; border:1px solid #ddd;">${r.response}</td></tr>`).join('');

        res.send(`
            <div dir="rtl" style="font-family:sans-serif; padding:20px; max-width:500px; margin:auto; border:1px solid #ccc; border-radius:10px;">
                <h2 style="text-align:center;">🤖 لوحة إدارة Egboot</h2>
                <form action="/admin/add" method="POST" style="display:flex; flex-direction:column; gap:10px;">
                    <input name="keyword" placeholder="الكلمة (بكام، شحن..)" style="padding:10px;" required>
                    <textarea name="response" placeholder="الرد الذكي" style="padding:10px;" required></textarea>
                    <button type="submit" style="padding:10px; background:#28a745; color:white; border:none; border-radius:5px; cursor:pointer;">حفظ في الذاكرة</button>
                </form>
                <h3 style="margin-top:20px;">الردود الحالية:</h3>
                <table style="width:100%; border-collapse:collapse;">
                    <thead><tr style="background:#f4f4f4;"><th>الكلمة</th><th>الرد</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="2" style="text-align:center;">لا يوجد ردود بعد</td></tr>'}</tbody>
                </table>
            </div>
        `);
    } catch (e) {
        res.send("<h2>⚠️ الصفحة قيد التحميل.. جرب تعمل ريفرش كمان ثانية.</h2>");
    }
});

app.post('/admin/add', async (req, res) => {
    try {
        await Reply.findOneAndUpdate(
            { keyword: req.body.keyword.toLowerCase().trim() },
            { response: req.body.response },
            { upsert: true }
        );
        res.redirect('/admin');
    } catch (e) { res.send("Error: " + e.message); }
});

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of (entry.messaging || [])) {
                if (event.message && event.message.text) {
                    const userText = event.message.text.toLowerCase().trim();
                    try {
                        const match = await Reply.findOne({ keyword: { $regex: userText, $options: 'i' } }).maxTimeMS(1500);
                        let reply = match ? match.response : "أهلاً بك في Egboot! 🚀 جاري تحويلك للمختص.";
                        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
                            recipient: { id: event.sender.id },
                            message: { text: reply }
                        });
                    } catch (e) { console.log("FB Send Error"); }
                }
            }
        }
        res.sendStatus(200);
    }
});

app.get('/webhook', (req, res) => {
    res.send(req.query['hub.challenge']);
});

app.listen(process.env.PORT || 8080, () => console.log('🚀 SYSTEM READY'));
