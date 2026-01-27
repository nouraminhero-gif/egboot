require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// رابط الاتصال التقليدي (Standard Connection String)
// جرب الرابط ده لأنه أسرع في تخطي الـ Buffering اللي بيحصل عندك
const DB_URI = "mongodb://nouraminhero_db_user:nour2010@ac-u6m8v7y-shard-00-00.mongodb.net:27017,ac-u6m8v7y-shard-00-01.mongodb.net:27017,ac-u6m8v7y-shard-00-02.mongodb.net:27017/egboot?ssl=true&replicaSet=atlas-13o8p5-shard-0&authSource=admin&retryWrites=true&w=majority";

mongoose.connect(DB_URI, {
    serverSelectionTimeoutMS: 10000, // صبر 10 ثواني للاتصال
    socketTimeoutMS: 45000, // صبر 45 ثانية للعمليات
})
.then(() => console.log('✅ Connected Successfully'))
.catch(err => console.log('❌ DB Error:', err.message));

const Reply = mongoose.model('Reply', new mongoose.Schema({
    keyword: { type: String, unique: true },
    response: String
}), 'replies');

// لوحة التحكم
app.get('/admin', async (req, res) => {
    try {
        const allReplies = await Reply.find().maxTimeMS(5000).catch(() => []);
        let rows = allReplies.map(r => `
            <tr>
                <td style="padding:10px; border:1px solid #ddd;">${r.keyword}</td>
                <td style="padding:10px; border:1px solid #ddd;">${r.response}</td>
            </tr>`).join('');
        
        res.send(`
            <div dir="rtl" style="font-family:sans-serif; padding:20px; max-width:600px; margin:auto; background:#fff; border:1px solid #ccc; border-radius:10px;">
                <h2 style="text-align:center;">🤖 لوحة إدارة Egboot</h2>
                <form action="/admin/add" method="POST" style="background:#f4f4f4; padding:15px; border-radius:8px;">
                    <input name="keyword" placeholder="الكلمة" style="width:95%; padding:10px; margin-bottom:10px;" required>
                    <textarea name="response" placeholder="الرد" style="width:95%; padding:10px; margin-bottom:10px;" required></textarea>
                    <button type="submit" style="width:100%; padding:10px; background:#28a745; color:white; border:none; cursor:pointer;">حفظ</button>
                </form>
                <table style="width:100%; margin-top:20px; border-collapse:collapse;">
                    <thead><tr style="background:#ddd;"><th>الكلمة</th><th>الرد</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="2" style="text-align:center;">لا يوجد بيانات</td></tr>'}</tbody>
                </table>
            </div>
        `);
    } catch (e) { res.send("خطأ في التحميل"); }
});

app.post('/admin/add', async (req, res) => {
    try {
        // استخدام الطريقة المباشرة للحفظ لتجنب الـ Buffering Timeout
        const { keyword, response } = req.body;
        await Reply.updateOne(
            { keyword: keyword.toLowerCase().trim() },
            { $set: { response: response } },
            { upsert: true }
        );
        res.redirect('/admin');
    } catch (e) { 
        res.send("❌ حدث خطأ أثناء الحفظ: " + e.message + "<br><a href='/admin'>ارجع وحاول تاني</a>"); 
    }
});

// Webhook
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of (entry.messaging || [])) {
                if (event.message && event.message.text) {
                    const userText = event.message.text.toLowerCase().trim();
                    try {
                        const match = await Reply.findOne({ keyword: { $regex: userText, $options: 'i' } });
                        let replyText = match ? match.response : "أهلاً بك! جاري تحويلك للمختص.";
                        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
                            recipient: { id: event.sender.id },
                            message: { text: replyText }
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
