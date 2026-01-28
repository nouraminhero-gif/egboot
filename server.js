require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Client } = require('pg'); 
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ الرابط المباشر (Direct) - ده اللي هيحل مشكلة "Tenant not found" نهائياً
// المشروع: bznvximwimyguinpduzb
const connectionString = "postgresql://postgres:Xj5J@9c8w!Wp$8K@db.bznvximwimyguinpduzb.supabase.co:5432/postgres";

const client = new Client({ 
    connectionString,
    connectionTimeoutMillis: 15000 
});

client.connect()
    .then(() => {
        console.log('✅ Connected to Egboot DB Successfully');
        client.query('CREATE TABLE IF NOT EXISTS replies (keyword TEXT PRIMARY KEY, response TEXT)');
    })
    .catch(err => {
        console.error('❌ DB Error:', err.message);
    });

// --- [ واجهة لوحة التحكم ] ---
app.get('/admin', async (req, res) => {
    try {
        const result = await client.query('SELECT * FROM replies ORDER BY keyword ASC');
        let rows = result.rows.map(r => `
            <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding:12px; border:1px solid #eee;">${r.keyword}</td>
                <td style="padding:12px; border:1px solid #eee;">${r.response}</td>
            </tr>`).join('');

        res.send(`
            <!DOCTYPE html>
            <html dir="rtl">
            <head>
                <meta charset="UTF-8">
                <title>لوحة إدارة Egboot</title>
                <style>
                    body { font-family: sans-serif; background: #f4f7f6; padding: 20px; }
                    .card { max-width: 600px; margin: auto; background: white; padding: 25px; border-radius: 15px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
                    h2 { text-align: center; color: #007bff; }
                    input, textarea { width: 100%; padding: 12px; margin: 10px 0; border: 1px solid #ddd; border-radius: 8px; box-sizing: border-box; }
                    button { width: 100%; padding: 12px; background: #28a745; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: bold; }
                    table { width: 100%; margin-top: 25px; border-collapse: collapse; }
                    th { background: #007bff; color: white; padding: 12px; text-align: right; }
                    td { padding: 12px; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h2>🚀 لوحة إدارة Egboot</h2>
                    <form action="/admin/add" method="POST">
                        <input name="keyword" placeholder="الكلمة (مثلاً: سعر)" required>
                        <textarea name="response" placeholder="رد البوت..." rows="3" required></textarea>
                        <button type="submit">حفظ الرد</button>
                    </form>
                    <table>
                        <thead><tr><th>الكلمة</th><th>الرد</th></tr></thead>
                        <tbody>${rows || '<tr><td colspan="2" style="text-align:center;">لا يوجد ردود مضافة.</td></tr>'}</tbody>
                    </table>
                </div>
            </body>
            </html>
        `);
    } catch (e) {
        res.status(500).send("خطأ في الاتصال: " + e.message);
    }
});

app.post('/admin/add', async (req, res) => {
    const { keyword, response } = req.body;
    try {
        await client.query(
            'INSERT INTO replies(keyword, response) VALUES($1, $2) ON CONFLICT (keyword) DO UPDATE SET response = EXCLUDED.response',
            [keyword.toLowerCase().trim(), response]
        );
        res.redirect('/admin');
    } catch (e) { res.status(500).send("خطأ: " + e.message); }
});

// --- [ Webhook ] ---
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of (entry.messaging || [])) {
                if (event.message && event.message.text) {
                    const userText = event.message.text.toLowerCase().trim();
                    try {
                        const result = await client.query('SELECT response FROM replies WHERE keyword = $1', [userText]);
                        let replyText = result.rows.length > 0 ? result.rows[0].response : "أهلاً بك!";
                        await axios.post('https://graph.facebook.com/v18.0/me/messages?access_token=' + process.env.PAGE_ACCESS_TOKEN, {
                            recipient: { id: event.sender.id },
                            message: { text: replyText }
                        });
                    } catch (e) { console.error("FB Error"); }
                }
            }
        }
        res.sendStatus(200);
    }
});

app.get('/webhook', (req, res) => { res.send(req.query['hub.challenge']); });

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('🚀 Server is Live on Port ' + PORT));
