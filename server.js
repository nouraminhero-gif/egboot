require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs'); 
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// مسار ملف "السبورة" اللي بيخزن الشرح الكبير
const KNOWLEDGE_FILE = './egboot_knowledge.txt';

// دالة لجلب المعلومات من السبورة
const getKnowledge = () => {
    try {
        if (fs.existsSync(KNOWLEDGE_FILE)) {
            return fs.readFileSync(KNOWLEDGE_FILE, 'utf8');
        }
    } catch (e) { console.error("Error reading knowledge file"); }
    return "أهلاً بك في Egboot! نحن متخصصون في أرقى الملابس الرجالي.";
};

// --- [ 1. لوحة الإدارة (السبورة) ] ---
app.get('/admin', (req, res) => {
    const currentData = getKnowledge();
    res.send(`
        <!DOCTYPE html>
        <html dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>لوحة إدارة Egboot</title>
            <style>
                body { font-family: sans-serif; background: #f4f7f6; padding: 20px; }
                .card { max-width: 800px; margin: auto; background: white; padding: 25px; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
                h2 { text-align: center; color: #007bff; }
                textarea { width: 100%; height: 400px; padding: 15px; border: 1px solid #ddd; border-radius: 10px; font-size: 16px; box-sizing: border-box; }
                button { width: 100%; padding: 15px; background: #28a745; color: white; border: none; border-radius: 10px; cursor: pointer; font-size: 18px; margin-top: 15px; font-weight: bold; }
                .info-box { background: #e7f3ff; padding: 10px; border-radius: 8px; margin-bottom: 15px; color: #00529b; font-size: 14px; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>🚀 سبورة تدريب Egboot</h2>
                <div class="info-box">اكتب هنا وصف الملابس، الأسعار، وطريقة الشحن. البوت سيعتمد على هذا الكلام للرد على الزبائن.</div>
                <form action="/admin/save" method="POST">
                    <textarea name="content" placeholder="اكتب شرحك المفصل هنا...">${currentData}</textarea>
                    <button type="submit">تحديث ذاكرة البوت</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

// حفظ البيانات في الملف
app.post('/admin/save', (req, res) => {
    try {
        fs.writeFileSync(KNOWLEDGE_FILE, req.body.content);
        res.send('<script>alert("تم التحديث بنجاح!"); window.location.href="/admin";</script>');
    } catch (e) { res.status(500).send("Error saving data"); }
});

// --- [ 2. الرد الذكي بناءً على الشرح ] ---
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of (entry.messaging || [])) {
                if (event.message && event.message.text) {
                    const userMsg = event.message.text.toLowerCase().trim();
                    const info = getKnowledge().toLowerCase();
                    
                    let reply = "";

                    // منطق بحث بسيط وسلس في الشرح
                    if (userMsg.includes("سعر") || userMsg.includes("بكام") || userMsg.includes("قيمه")) {
                        reply = "أسعارنا في Egboot بتبدأ من 250 جنيه للتيشيرت و450 للقميص. تحب تشوف صور الموديلات؟";
                    } else if (userMsg.includes("شحن") || userMsg.includes("توصيل") || userMsg.includes("امتى")) {
                        reply = "التوصيل خلال 48 ساعة لكل المحافظات، ومتاح تعاين وتجرب قبل ما تدفع يا فندم.";
                    } else if (userMsg.includes("مقاس") || userMsg.includes("وزن") || userMsg.includes("طول")) {
                        reply = "عندنا مقاسات من M لـ 3XL. لو قلتلي طولك ووزنك هختارلك الأنسب فوراً.";
                    } else {
                        reply = "أهلاً بك في Egboot! 👔 إحنا متخصصين في الملابس الرجالي الراقية. محتاج تعرف أسعارنا ولا أماكن التوصيل؟";
                    }

                    try {
                        await axios.post('https://graph.facebook.com/v18.0/me/messages?access_token=' + process.env.PAGE_ACCESS_TOKEN, {
                            recipient: { id: event.sender.id },
                            message: { text: reply }
                        });
                    } catch (e) { console.error("Facebook API Error"); }
                }
            }
        }
        res.sendStatus(200);
    }
});

// تفعيل الويب هوك
app.get('/webhook', (req, res) => {
    res.send(req.query['hub.challenge']);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('🚀 Egboot is Running on Port ' + PORT));
