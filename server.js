require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Client } = require('pg'); 
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// الرابط ده متعدل بالـ Project ID بتاعك عشان السيرفر ما يكرشش تاني
const connectionString = "postgresql://postgres.bznvximwimyguinpduzb:Xj5J@9c8w!Wp$8K@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";

const client = new Client({ connectionString });
client.connect()
    .then(() => {
        console.log('✅ Egboot Database Connected!');
        client.query('CREATE TABLE IF NOT EXISTS replies (keyword TEXT PRIMARY KEY, response TEXT)');
    })
    .catch(err => console.error('❌ Connection Error:', err.message));

app.get('/admin', async (req, res) => {
    try {
        const result = await client.query('SELECT * FROM replies ORDER BY keyword ASC');
        let rows = result.rows.map(r => `<tr><td style="padding:10px; border:1px solid #ddd;">${r.keyword}</td><td style="padding:10px; border:1px solid #ddd;">${r.response}</td></tr>`).join('');
        res.send(`<div dir="rtl" style="font-family:sans-serif; padding:20px; max-width:600px; margin:auto; border:1px solid #ccc; border-radius:12px; background:white;"><h2>🚀 لوحة إدارة Egboot</h2><form action="/admin/add" method="POST" style="background:#f9f9f9; padding:15px; border-radius:10px;"><input name="keyword" placeholder="الكلمة" style="width:95%; padding:10px; margin-bottom:10px;" required><textarea name="response" placeholder="الرد" style="width:95%; padding:10px; margin-bottom:10px;" required></textarea><button type="submit" style="width:100%; padding:10px; background:#28a745; color:white; border:none; cursor:pointer;">حفظ</button></form><table style="width:100%; margin-top:20px; border-collapse:collapse;"><tr style="background:#eee;"><th>الكلمة</th><th>الرد</th></tr>${rows || '<tr><td colspan="2" style="text-align:center;">لا يوجد ردود</td></tr>'}</table></div>`);
    } catch (e) { res.status(500).send("خطأ في الداتا بيز"); }
});

app.post('/admin/add', async (req, res) => {
    const { keyword, response } = req.body;
    try {
        await client.query('INSERT INTO replies(keyword, response) VALUES($1, $2) ON CONFLICT (keyword) DO UPDATE SET response = EXCLUDED.response', [keyword.toLowerCase().trim(), response]);
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
                        const result = await client.query('SELECT response FROM replies WHERE keyword = $1', [userText]);
                        let replyText = result.rows.length > 0 ? result.rows[0].response : "أهلاً بك في Egboot!";
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
app.listen(process.env.PORT || 8080);
