require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// الربط بالمستخدم الصحيح من الصورة: nouraminhero_db_user
const DB_URI = "mongodb://nouraminhero_db_user:nour2010@ac-u6m8v7y-shard-00-00.mongodb.net:27017,ac-u6m8v7y-shard-00-01.mongodb.net:27017,ac-u6m8v7y-shard-00-02.mongodb.net:27017/egboot?ssl=true&replicaSet=atlas-13o8p5-shard-0&authSource=admin";

mongoose.connect(DB_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => console.log('✅ Connected Successfully to Egboot DB'))
    .catch(err => console.log('⚠️ DB Connection Issue:', err.message));

const Reply = mongoose.model('Reply', new mongoose.Schema({
    keyword: { type: String, unique: true },
    response: String
}), 'replies');

// --- لوحة التحكم ---
app.get('/admin', async (req, res) => {
    try {
        const allReplies = await Reply.find().maxTimeMS(3000).catch(() => []);
        let rows = allReplies.map(r => `<tr><td style="padding:10px; border:1px solid #ddd;">${r.keyword}</td><td style="padding:10px; border:1px solid #ddd;">${r.response}</td></tr>`).join('');
        
        res.send(`
            <div dir="rtl" style="font-family:sans-serif; padding:20px; max-width:600px; margin:auto; background:#fff; border:1px solid #ccc; border-radius:10px;">
                <h2 style="text-align:center;">🤖 لوحة إدارة Egboot</h2>
                <form action="/admin/add" method="POST" style="background:#f4f4f4; padding:15px; border-radius:8px;">
                    <input name="keyword" placeholder="الكلمة المفتاحية (مثلاً: سعر)" style="width:99%; padding:10px; margin-bottom:10px;" required>
                    <textarea name="response" placeholder="الرد التلقائي" style="width:99%; padding:10px; margin-bottom:10px;" required></textarea>
                    <button type="submit" style="width:100%; padding:10px; background:#28a745; color:white; border:none; cursor:pointer; border-radius:5px;">حفظ في السيستم</button>
                </form>
                <table style="width:100%; margin-top:20px; border-collapse:collapse;">
                    <tr style="background:#ddd;"><th>الكلمة</th><th>الرد</th></tr>
                    ${rows || '<tr><td colspan="2" style="text-align:center; padding:10px;">لا يوجد بيانات.. أضف أول كلمة!</td></tr>'}
                </table>
            </div>
        `);
    } catch (e) { res.send("جاري الاتصال بالقاعدة.. ريفرش."); }
});

app.post('/admin/add', async (req, res) => {
    try {
        await Reply.findOneAndUpdate(
            { keyword: req.body.keyword.toLowerCase().trim() },
            { response: req.body.response },
            { upsert: true }
        );
        res.redirect('/admin');
    } catch (e) { res.send("خطأ في الحفظ: " + e.message); }
});

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of (entry.messaging || [])) {
                if (event.message && event.message.text) {
                    const userText = event.message.text.toLowerCase().trim();
                    try {
                        const match = await Reply.findOne({ keyword: { $regex: userText, $options: 'i' } });
                        let reply = match ? match.response : "أهلاً بك! جاري تحويلك للمختص.";
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

app.get('/webhook', (req, res) => { res.send(req.query['hub.challenge']); });
app.listen(process.env.PORT || 8080);
