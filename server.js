require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs'); // لحفظ الشرح في ملف بسيط
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const DATA_FILE = './egboot_info.txt';

// دالة لجلب الشرح المحفوظ
const getStoredInfo = () => {
    try {
        return fs.readFileSync(DATA_FILE, 'utf8');
    } catch (e) {
        return "أهلاً بك في Egboot! نحن شركة متخصصة في خدمات البرمجة.";
    }
};

// --- [ لوحة التحكم لإضافة الشرح الكبير ] ---
app.get('/admin', (req, res) => {
    const currentInfo = getStoredInfo();
    res.send(`
        <!DOCTYPE html>
        <html dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>إدارة ذكاء Egboot</title>
            <style>
                body { font-family: sans-serif; background: #f0f2f5; padding: 20px; }
                .container { max-width: 800px; margin: auto; background: white; padding: 30px; border-radius: 15px; box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
                h2 { color: #1c1e21; text-align: center; }
                textarea { width: 100%; height: 300px; padding: 15px; border: 1px solid #ddd; border-radius: 10px; font-size: 16px; margin-bottom: 20px; box-sizing: border-box; }
                button { width: 100%; padding: 15px; background: #0084ff; color: white; border: none; border-radius: 10px; font-size: 18px; cursor: pointer; font-weight: bold; }
                .hint { color: #65676b; font-size: 14px; margin-bottom: 10px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>🧠 تدريب بوت Egboot</h2>
                <p class="hint">اكتب هنا شرحاً كاملاً عن مشروعك، أسعارك، وطريقة عملك. البوت سيفهم هذا الكلام ويرد منه.</p>
                <form action="/admin/save" method="POST">
                    <textarea name="big_info" placeholder="اكتب شرحك هنا..." required>${currentInfo}</textarea>
                    <button type="submit">تحديث ذاكرة البوت</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

app.post('/admin/save', (req, res) => {
    fs.writeFileSync(DATA_FILE, req.body.big_info);
    res.send('<script>alert("تم حفظ الشرح بنجاح!"); window.location.href="/admin";</script>');
});

// --- [ الرد الذكي ] ---
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of (entry.messaging || [])) {
                if (event.message && event.message.text) {
                    const userMessage = event.message.text;
                    const botMemory = getStoredInfo();

                    // هنا بنبعت الشرح + سؤال الزبون للـ AI (مثل ChatGPT API أو Google Gemini)
                    // حالياً سأعطيك رد "محاكي" للذكاء، ولو معك API Key نفعله فوراً
                    let finalResponse = `بناءً على معلومات Egboot: ${userMessage}`; 

                    try {
                        await axios.post('https://graph.facebook.com/v18.0/me/messages?access_token=' + process.env.PAGE_ACCESS_TOKEN, {
                            recipient: { id: event.sender.id },
                            message: { text: "فهمت سؤالك.. (هنا يتم ربط الـ AI ليرد من الشرح)" }
                        });
                    } catch (e) { console.error("Error sending message"); }
                }
            }
        }
        res.sendStatus(200);
    }
});

app.get('/webhook', (req, res) => { res.send(req.query['hub.challenge']); });

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('🚀 Smart Bot is Live!'));
