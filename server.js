require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 1. رابط اتصال جديد ومختصر (لحل مشكلة الـ Timeout)
// تأكد أن الباسورد nour2010 صحيحة لهذا المستخدم
const DB_URI = "mongodb+srv://nouraminhero_db_user:nour2010@cluster0.u6m8v7y.mongodb.net/egboot?retryWrites=true&w=majority";

mongoose.connect(DB_URI)
    .then(() => console.log('✅ Connected to Egboot DB'))
    .catch(err => console.log('❌ DB Connection Error:', err.message));

const Reply = mongoose.model('Reply', new mongoose.Schema({
    keyword: { type: String, unique: true },
    response: String
}), 'replies');

// --- لوحة التحكم ---
app.get('/admin', async (req, res) => {
    try {
        const allReplies = await Reply.find().maxTimeMS(5000).catch(() => []);
        let rows = allReplies.map(r => `<tr><td style="padding:10px; border:1px solid #ddd;">${r.keyword}</td><td style="padding:10px; border:1px solid #ddd;">${r.response}</td></tr>`).join('');
        
        res.send(`
            <div dir="rtl" style="font-family:sans-serif; padding:20px; max-width:600px; margin:auto; background:#fff; border:1px solid #ccc; border-radius:10px;">
                <h2 style="text-align:center;">🤖 لوحة إدارة Egboot</h2>
                <form action="/admin/add" method="POST" style="background:#f4f4f4; padding:15px; border-radius:8px;">
                    <input name="keyword" placeholder="الكلمة المفتاحية" style="width:95%; padding:10px; margin-bottom:10px;" required>
                    <textarea name="response" placeholder="الرد التلقائي" style="width:95%; padding:10px; margin-bottom:10px;" required></textarea>
                    <button type="submit" style="width:100%; padding:10px; background:#28a745; color:white; border:none; cursor:pointer; border-radius:5px;">حفظ في السيستم</button>
                </form>
                <table style="width:100%; margin-top:20px; border-collapse:collapse;">
                    <tr style="background:#ddd;"><th>الكلمة</th><th>الرد</th></tr>
                    ${rows || '<tr><td colspan="2" style="text-align:center; padding:10px;">لا يوجد بيانات.. أضف أول كلمة!</td></tr>'}
                </table>
            </div>
        `);
    } catch (e) { res.send("خطأ في التحميل.. تأكد من اتصال الداتا بيز"); }
});

app.post('/admin/add', async (req, res) => {
    try {
        await Reply.findOneAndUpdate(
            { keyword: req.body.keyword.toLowerCase().trim() },
            { response: req.body.response },
            { upsert: true, new: true, timeout: 10000 }
        );
        res.redirect('/admin');
    } catch (e) { 
        res.send("❌ خطأ في الحفظ: " + e.message + "<br><a href='/admin'>ارجع وحاول تاني</a>"); 
    }
});

// --- Webhook ---
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of (entry.messaging || [])) {
                if (event.message && event.message.text) {
                    const userText = event.message.text.toLowerCase().trim();
                    try {
                        const match = await Reply.findOne({ keyword: { $regex: userText, $options: 'i' } });
                        let reply = match ? match.response : "أهلاً بك في Egboot! 🚀 جاري تحويلك للمختص.";
                        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
                            recipient: { id: event.sender.id },
                            message: { text: reply }
                        });
                    } catch (e) { console.log("FB Error"); }
                }
            }
        }
        res.sendStatus(200);
    }
});

app.get('/webhook', (req, res) => { res.send(req.query['hub.challenge']); });
app.listen(process.env.PORT || 8080);
