require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Client } = require('pg'); 
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// رابط الاتصال بـ Supabase (بياناتك من الصور)
const connectionString = "postgresql://postgres.bznvximwimyguinpduzb:Xj5J@9c8w!Wp$8K@aws-0-eu-central-1.pooler.supabase.com:6543/postgres";

const client = new Client({ 
    connectionString,
    connectionTimeoutMillis: 10000 
});

client.connect()
    .then(() => {
        console.log('✅ Connected to Supabase Successfully');
        // إنشاء الجدول لو مش موجود
        client.query('CREATE TABLE IF NOT EXISTS replies (keyword TEXT PRIMARY KEY, response TEXT)');
    })
    .catch(err => console.error('❌ Connection Error', err.stack));

// صفحة الـ Admin الرئيسية
app.get('/admin', async (req, res) => {
    try {
        const result = await client.query('SELECT * FROM replies ORDER BY keyword ASC');
        let rows = result.rows.map(r => `
            <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding:10px;">${r.keyword}</td>
                <td style="padding:10px;">${r.response}</td>
            </tr>`).join('');

        res.send(`
            <!DOCTYPE html>
            <html dir="rtl">
            <head>
                <meta charset="UTF-8">
                <title>لوحة تحكم Egboot</title>
                <style>
                    body { font-family: sans-serif; background: #f0f2f5; padding: 20px; }
                    .container { max-width: 600px; margin: auto; background: white; padding: 20px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                    input, textarea { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ccc; border-radius: 5px; box-sizing: border-box; }
                    button { width: 100%; padding: 12px; background: #28a745; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; }
                    table { width: 100%; margin-top: 20px; border-collapse: collapse; }
                    th { background: #eee; padding: 10px; text-align: right; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h2 style="text-align:center; color:#007bff;">🚀 لوحة إدارة Egboot</h2>
                    <form action="/admin/add" method="POST">
                        <input name="keyword" placeholder="الكلمة المفتاحية (مثلاً: سعر)" required>
                        <textarea name="response" placeholder="رد البوت التلقائي..." rows="3" required></textarea>
                        <button type="submit">حفظ الرد</button>
                    </form>
                    <table>
                        <thead><tr><th>الكلمة</th><th>الرد</th></tr></thead>
                        <tbody>${rows || '<tr><td colspan="2" style="text-align:center; padding:20px;">لا يوجد ردود مضافة.</td></tr>'}</tbody>
                    </table>
                </div>
            </body>
            </html>
        `);
    } catch (e) {
        res.status(500).send("⚠️ حدث خطأ في الاتصال بقاعدة البيانات.");
    }
});

// إضافة رد جديد
app.post('/admin/add', async (req, res) => {
    const { keyword, response } = req.body;
    try {
        await client.query(
            'INSERT INTO replies(keyword, response) VALUES($1, $2) ON CONFLICT (keyword) DO UPDATE SET response = EXCLUDED.response',
            [keyword.toLowerCase().trim(), response]
        );
        res.redirect('/admin');
    } catch (e) {
        res.status(500).send("❌ خطأ أثناء الحفظ: " + e.message);
    }
});

// الـ Webhook للفيسبوك
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of (entry.messaging || [])) {
                if (event.message && event.message.text) {
                    const userText = event.message.text.toLowerCase().trim();
                    try {
                        const result = await client.query('SELECT response FROM replies WHERE keyword = $1', [userText]);
                        let replyText = result.rows.length > 0 ? result.rows[0].response : "أهلاً بك في Egboot! 🚀";
                        
                        await axios.post('https://graph.facebook.com/v18.0/me/messages?access_token=' + process.env.PAGE_ACCESS_TOKEN, {
                            recipient: { id: event.sender.id },
                            message: { text: replyText }
                        });
                    } catch (e) { console.error("FB Send Error"); }
                }
            }
        }
        res.sendStatus(200);
    }
});

app.get('/webhook', (req, res) => { res.send(req.query['hub.challenge']); });

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('🚀 Server is Live!'));
