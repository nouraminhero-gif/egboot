require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Client } = require('pg'); 
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// رابط الاتصال المباشر بـ Supabase (مبني على صورك وباسوردك)
const connectionString = "postgresql://postgres.bznvximwimyguinpduzb:Xj5J@9c8w!Wp$8K@aws-0-eu-central-1.pooler.supabase.com:6543/postgres";

const client = new Client({ 
    connectionString,
    connectionTimeoutMillis: 10000 
});

client.connect()
    .then(() => {
        console.log('✅ Connected to Supabase Successfully');
        // إنشاء الجدول تلقائياً لتخزين الردود
        client.query('CREATE TABLE IF NOT EXISTS replies (keyword TEXT PRIMARY KEY, response TEXT)');
    })
    .catch(err => console.error('❌ Connection Error', err.stack));

// --- [ لوحة التحكم ] ---
app.get('/admin', async (req, res) => {
    try {
        const result = await client.query('SELECT * FROM replies ORDER BY keyword ASC');
        let rows = result.rows.map(r => `
            <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding:10px;">${r.keyword}</td>
                <td style="padding:10px;">${r.response}</td>
            </tr>`).join('');

        res.send(`
            <div dir="rtl" style="font-family:sans-serif; padding:20px; max-width:600px; margin:auto; background:#fff; border:1px solid #ccc; border-radius:12px;">
                <h2 style="text-align:center; color:#007bff;">🚀 لوحة إدارة Egboot</h2>
                <form action="/admin/add" method="POST" style="background:#f9f9f9; padding:20px; border-radius:10px; margin-bottom:20px;">
                    <label>الكلمة المفتاحية:</label>
                    <input name="keyword" placeholder="مثلاً: سعر" style="width:95%; padding:10px; margin-bottom:10px;" required>
                    <label>رد البوت:</label>
                    <textarea name="response" placeholder="اكتب الرد هنا..." style="width:95%; padding:10px; margin-bottom:10px;" required></textarea>
                    <button type="submit" style="width:100%; padding:12px; background:#28a745; color:#fff; border:none; border-radius:5px; cursor:pointer;">حفظ في الداتا بيز</button>
                </form>
                <table style="width:100%; border-collapse:collapse; text-align:right;">
                    <thead><tr style="background:#eee;">
                        <th style="padding:10px;">الكلمة</th><th style="padding:10px;">الرد</th>
                    </tr></thead>
                    <tbody>${rows || '<tr><td colspan="2" style="text-align:center; padding:20px;">لا يوجد بيانات.. أضف أول رد.</td></tr>'}</tbody>
                </table>
            </div>
        `);
    } catch (e) { res.send("⚠️ خطأ في جلب البيانات من الداتا بيز."); }
});

app.post('/admin/add', async (req, res) => {
    const { keyword, response } = req.body;
    try {
        const query = 'INSERT INTO replies(keyword, response) VALUES($1, $2) ON CONFLICT (keyword) DO UPDATE SET response = EXCLUDED.response';
        await client.query(query, [keyword.toLowerCase().trim(), response]);
        res.redirect('/admin');
    } catch (e) { res.send("❌ خطأ أثناء الحفظ: " + e.message); }
});

// --- [ Webhook للفيسبوك ] ---
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of (entry.messaging || [])) {
                if (event.message && event.message.text) {
                    const userText = event.message.text.toLowerCase().trim();
                    try {
                        const result = await client.query('SELECT response FROM replies WHERE keyword = $1', [userText]);
                        let replyText = result.rows.length > 0 ? result.rows[0].response : "أهلاً بك في Egboot! 🚀 جاري تحويلك للمختص.";
                        
                        await axios.post(\`https://graph.facebook.com/v18.0/me/messages?access_token=\${process.env.PAGE_ACCESS_TOKEN}\`, {
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
app.listen(PORT, () => console.log(\`🚀 Egboot System Ready on Port \${PORT}\`));
