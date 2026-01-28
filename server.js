require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs'); // مكتبة لقراءة وكتابة الملفات داخلياً
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// مسار الملف اللي هيتحفظ فيه "الشرح الكبير" بتاعك
const DATA_PATH = './egboot_knowledge.txt';

// دالة لجلب الشرح من الملف أو إعطاء نص افتراضي لو الملف لسه منشأش
const getBotKnowledge = () => {
    try {
        if (fs.existsSync(DATA_PATH)) {
            return fs.readFileSync(DATA_PATH, 'utf8');
        }
    } catch (err) { console.error("Error reading file"); }
    return "أهلاً بك في Egboot! نحن هنا لخدمتكم.";
};

// --- [ صفحة الأدمن لإضافة الشرح الكبير بسلاسة ] ---
app.get('/admin', (req, res) => {
    const currentKnowledge = getBotKnowledge();
    res.send(`
        <!DOCTYPE html>
        <html dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>إدارة معرفة Egboot</title>
            <style>
                body { font-family: sans-serif; background: #f0f2f5; padding: 20px; }
                .card { max-width: 800px; margin: auto; background: white; padding: 30px; border-radius: 15px; box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
                h2 { color: #0084ff; text-align: center; }
                textarea { width: 100%; height: 400px; padding: 15px; border: 1px solid #ddd; border-radius: 10px; font-size: 16px; margin: 20px 0; box-sizing: border-box; resize: vertical; }
                button { width: 100%; padding: 15px; background: #28a745; color: white; border: none; border-radius: 10px; font-size: 18px; cursor: pointer; font-weight: bold; }
                .info { background: #e7f3ff; padding: 10px; border-radius: 5px; color: #00529b; font-size: 14px; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>🧠 تدريب بوت Egboot</h2>
                <div class="info">اكتب هنا كل المعلومات اللي عايز البوت يعرفها (أسعار، خدمات، مواعيد، شرح طويل). البوت هيستخدم الكلام ده للرد.</div>
                <form action="/admin/save" method="POST">
                    <textarea name="knowledge" placeholder="اكتب شرحك المفصل هنا..." required>${currentKnowledge}</textarea>
                    <button type="submit">تحديث ذاكرة البوت</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

// حفظ الشرح الجديد
app.post('/admin/save', (req, res) => {
    try {
        fs.writeFileSync(DATA_PATH, req.body.knowledge);
        res.send('<script>alert("تم تحديث معلومات البوت بنجاح!"); window.location.href="/admin";</script>');
    } catch (err) {
        res.status(500).send("خطأ أثناء الحفظ");
    }
});

// --- [ الرد من خلال الشرح ] ---
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of (entry.messaging || [])) {
                if (event.message && event.message.text) {
                    const userMsg = event.message.text;
                    const knowledgeBase = getBotKnowledge();
                    
                    // هنا البوت "بيقرأ" الشرح بتاعك وبيرد بناء عليه
                    // في الخطوة الجاية ممكن نربطه بـ AI حقيقي عشان يحلل الكلام ده
                    let replyText = "شكراً لرسالتك لـ Egboot! سيتم الرد بناءً على الشرح المحفوظ لدينا قريباً.";

                    try {
                        await axios.post('https://graph.facebook.com/v18.0/me/messages?access_token=' + process.env.PAGE_ACCESS_TOKEN, {
                            recipient: { id: event.sender.id },
                            message: { text: replyText }
                        });
                    } catch (e) { console.error("Facebook API Error"); }
                }
            }
        }
        res.sendStatus(200);
    }
});

app.get('/webhook', (req, res) => { res.send(req.query['hub.challenge']); });

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('🚀 Smart Bot is Live on Port ' + PORT));
 
