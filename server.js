require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs'); 
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// تأمين مسار الملف لضمان عمل صفحة الأدمن باستمرار
const KNOWLEDGE_FILE = path.join(__dirname, 'egboot_knowledge.txt');

const getKnowledge = () => {
    if (!fs.existsSync(KNOWLEDGE_FILE)) {
        fs.writeFileSync(KNOWLEDGE_FILE, "أهلاً بك في Egboot.");
        return "أهلاً بك في Egboot.";
    }
    return fs.readFileSync(KNOWLEDGE_FILE, 'utf8');
};

// --- [ 1. صفحة الإدارة - للإصلاح والتدريب ] ---
app.get('/admin', (req, res) => {
    const currentData = getKnowledge();
    res.send(`
        <html dir="rtl"><head><meta charset="UTF-8"><title>لوحة تحكم Egboot</title></head>
        <body style="font-family:sans-serif; background:#f4f7f6; padding:20px;">
            <div style="max-width:800px; margin:auto; background:white; padding:30px; border-radius:15px; box-shadow:0 4px 15px rgba(0,0,0,0.1);">
                <h2 style="color:#007bff; text-align:center;">🧠 تطوير ذكاء Egboot</h2>
                <form action="/admin/save" method="POST">
                    <textarea name="content" style="width:100%; height:450px; padding:15px; border-radius:10px; border:1px solid #ccc; font-size:16px;">${currentData}</textarea>
                    <button type="submit" style="width:100%; padding:15px; background:#28a745; color:white; border:none; border-radius:10px; cursor:pointer; font-weight:bold; margin-top:10px; font-size:18px;">حفظ المعلومات</button>
                </form>
            </div>
        </body></html>
    `);
});

app.post('/admin/save', (req, res) => {
    fs.writeFileSync(KNOWLEDGE_FILE, req.body.content);
    res.send('<script>alert("تم تحديث ذكاء البوت!"); window.location.href="/admin";</script>');
});

// --- [ 2. محرك الردود: السلام أولاً + الرد المباشر ] ---
function findSmartResponse(userMsg, knowledge) {
    const msg = userMsg.toLowerCase().trim();
    // تقسيم النص وتجاهل أي سطور تنظيمية [مثل العناوين]
    const lines = knowledge.split('\n').filter(line => line.trim().length > 5 && !line.startsWith('['));
    
    let greeting = "";
    // شرط رد السلام أولاً بشكل مهذب
    if (msg.includes("سلام") || msg.includes("عليكم") || msg.includes("أهلاً") || msg.includes("صباح") || msg.includes("مساء")) {
        greeting = "وعليكم السلام يا فندم، نورت Egboot لملابس الرجال! 👔\n";
    }

    let bestMatch = "";
    let highestScore = 0;

    // البحث عن السطر الأكثر تشابهاً مع سؤال الزبون
    for (let line of lines) {
        let score = 0;
        const words = msg.split(' ');
        words.forEach(word => {
            if (word.length > 2 && line.toLowerCase().includes(word)) score += 10;
        });

        if (score > highestScore) {
            highestScore = score;
            bestMatch = line;
        }
    }

    // بناء الرد النهائي: السلام + الإجابة المحددة
    if (highestScore >= 10) return greeting + bestMatch;
    if (greeting !== "") return greeting + "أؤمرني يا فندم، محتاج تعرف إيه عن الأسعار أو المقاسات المتاحة؟";
    return "نورتنا في Egboot يا فندم! 👔 محتاج تسأل عن الأسعار ولا المقاسات المتاحة؟";
}

// --- [ 3. استقبال رسائل فيسبوك ] ---
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of (entry.messaging || [])) {
                if (event.message && event.message.text) {
                    const userMsg = event.message.text;
                    const knowledge = getKnowledge();
                    const reply = findSmartResponse(userMsg, knowledge);
                    try {
                        await axios.post('https://graph.facebook.com/v18.0/me/messages?access_token=' + process.env.PAGE_ACCESS_TOKEN, {
                            recipient: { id: event.sender.id },
                            message: { text: reply }
                        });
                    } catch (e) { console.error("FB Send Error"); }
                }
            }
        }
        res.sendStatus(200);
    }
});

app.get('/webhook', (req, res) => res.send(req.query['hub.challenge']));
app.listen(process.env.PORT || 8080);
