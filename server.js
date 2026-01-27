require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 1. الاتصال بقاعدة بيانات Egboot (مع تجاهل أخطاء الـ IP لضمان استمرار السيرفر)
const DB_URI = "mongodb://nouraminhero:nour2010@ac-u6m8v7y-shard-00-00.mongodb.net:27017,ac-u6m8v7y-shard-00-01.mongodb.net:27017,ac-u6m8v7y-shard-00-02.mongodb.net:27017/egboot?ssl=true&replicaSet=atlas-13o8p5-shard-0&authSource=admin";

mongoose.connect(DB_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => console.log('✅ Connected to Egboot DB'))
    .catch(err => console.log('⚠️ DB Connection Issue:', err.message));

// 2. تعريف موديل الردود (الذاكرة اللي هتطورها بنفسك)
const Reply = mongoose.model('Reply', new mongoose.Schema({
    keyword: { type: String, unique: true },
    response: String
}), 'replies');

// --- [ 🖥️ لوحة تحكم السيستم - صفحة الأدمن ] ---
app.get('/admin', async (req, res) => {
    try {
        const allReplies = await Reply.find();
        let rows = allReplies.map(r => `
            <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding:10px; font-weight:bold;">${r.keyword}</td>
                <td style="padding:10px;">${r.response}</td>
            </tr>
        `).join('');

        res.send(`
            <!DOCTYPE html>
            <html dir="rtl">
            <head>
                <meta charset="UTF-8">
                <title>لوحة تحكم Egboot</title>
                <style>
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f0f2f5; padding: 20px; }
                    .container { max-width: 700px; margin: auto; background: white; padding: 30px; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
                    input, textarea { width: 100%; padding: 12px; margin: 10px 0; border: 1px solid #ddd; border-radius: 8px; box-sizing: border-box; }
                    button { width: 100%; padding: 12px; background: #007bff; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; }
                    button:hover { background: #0056b3; }
                    table { width: 100%; margin-top: 20px; border-collapse: collapse; background: #fff; }
                    th { background: #f8f9fa; padding: 10px; text-align: right; border-bottom: 2px solid #dee2e6; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h2 style="text-align:center; color:#333;">🤖 لوحة تحكم سيستم Egboot</h2>
                    <p style="text-align:center;">علم البوت يرد على إيه ويقول إيه</p>
                    
                    <form action="/admin/add" method="POST">
                        <input name="keyword" placeholder="الكلمة المفتاحية (مثال: سعر، عنوان، بكام)" required>
                        <textarea name="response" rows="3" placeholder="الرد اللي البوت هيقوله للعميل" required></textarea>
                        <button type="submit">حفظ في ذاكرة البوت</button>
                    </form>

                    <h3>المعلومات اللي البوت عارفها دلوقتي:</h3>
                    <table>
                        <thead><tr><th>الكلمة</th><th>الرد</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </body>
            </html>
        `);
    } catch (err) { res.status(500).send("خطأ في تحميل الصفحة"); }
});

// استقبال البيانات الجديدة وحفظها
app.post('/admin/add', async (req, res) => {
    const { keyword, response } = req.body;
    try {
        await Reply.findOneAndUpdate(
            { keyword: keyword.toLowerCase().trim() },
            { response: response },
            { upsert: true }
        );
        res.send('<script>alert("تم تحديث ذاكرة البوت!"); window.location.href="/admin";</script>');
    } catch (err) { res.send("Error: " + err.message); }
});

// --- [ 📬 الـ Webhook الخاص بفيسبوك ] ---
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of (entry.messaging || [])) {
                if (event.message && event.message.text) {
                    const userText = event.message.text.toLowerCase().trim();
                    const senderId = event.sender.id;

                    try {
                        // بحث ذكي في الداتا بيز (بيفهم لو الكلمة جزء من الجملة)
                        const match = await Reply.findOne({ keyword: { $regex: userText, $options: 'i' } });
                        
                        let finalReply = match ? match.response : "أهلاً بك في Egboot! 🚀 جاري تحويل استفسارك لأحد المختصين.";

                        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
                            recipient: { id: senderId },
                            message: { text: finalReply }
                        });
                        console.log(`✅ Responded to: ${userText}`);
                    } catch (e) { console.log("❌ FB Error"); }
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
app.listen(PORT, () => console.log(`🚀 Egboot System Live on Port ${PORT}`));
