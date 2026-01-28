require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs'); 
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// مسار ثابت للملف لضمان عدم توقف صفحة الأدمن
const KNOWLEDGE_FILE = path.join(__dirname, 'egboot_knowledge.txt');

// دالة جلب البيانات مع إنشاء الملف تلقائياً إذا فُقد
const getKnowledge = () => {
    if (!fs.existsSync(KNOWLEDGE_FILE)) {
        fs.writeFileSync(KNOWLEDGE_FILE, "أهلاً بك في Egboot.");
        return "أهلاً بك في Egboot.";
    }
    return fs.readFileSync(KNOWLEDGE_FILE, 'utf8');
};

// --- [ صفحة الإدارة - لتدريب البوت ] ---
app.get('/admin', (req, res) => {
    const currentData = getKnowledge();
    res.send(`
        <html dir="rtl"><head><meta charset="UTF-8"><title>تحكم Egboot</title></head>
        <body style="font-family:sans-serif; background:#f0f2f5; padding:20px;">
            <div style="max-width:800px; margin:auto; background:white; padding:30px; border-radius:15px; box-shadow:0 4px 10px rgba(0,0,0,0.1);">
                <h2 style="color:#1877f2; text-align:center;">🧠 دستور ذكاء Egboot</h2>
                <p style="color:#666;">اكتب كل معلومة في سطر مستقل وبدون عناوين كبيرة لضمان الرد المختصر.</p>
                <form action="/admin/save" method="POST">
                    <textarea name="content" style="width:100%; height:450px; padding:15px; border-radius:10px; border:1px solid #ddd; font-size:16px;">${currentData}</textarea>
                    <button type="submit" style="width:100%; padding:15px; background:#42b72a; color:white; border:none; border-radius:10px; cursor:pointer; font-weight:bold; margin-top:10px; font-size:18px;">حفظ المعلومات</button>
                </form>
            </div>
        </body></html>
    `);
});

app.post('/admin/save', (req, res) => {
    fs.writeFileSync(KNOWLEDGE_FILE, req.body.content);
    res.send('<script>alert("تم الحفظ!"); window.location.href="/admin";</script>');
});

// --- [ محرك الردود الذكي: السلام أولاً + رد على قدر السؤال ] ---
function findSmartResponse(userMsg, knowledge) {
    const msg = userMsg.toLowerCase().trim();
    // تقسيم النص وتجاهل العناوين التي تبدأ بـ [
    const lines = knowledge.split('\n').filter(line => line.trim().length > 5 && !line.startsWith('['));
    
    let greeting = "";
    // شرط رد السلام أولاً
    if (msg.includes("سلام") || msg.includes("عليكم") || msg.includes("أهلا") || msg.includes("صباح") || msg.includes("مساء")) {
        greeting = "وعليكم السلام يا فندم، نورت Egboot! 👔\n";
    }

    let bestMatch = "";
    let highestScore = 0;

    for (let line of lines) {
        let score = 0;
        const keywords = msg.split(' ');
        keywords.forEach(word => {
            if (word.length > 2 && line.toLowerCase().includes(word)) score += 10;
        });
        if (score > highestScore) {
            highestScore = score;
            bestMatch = line;
        }
    }

    // إذا وجد معلومة دقيقة يرد بها، وإلا يكتفي بالترحيب
    if (highestScore >= 10) return greeting + bestMatch;
    if (greeting !== "") return greeting + "أؤمرني يا فندم، محتاج تسأل عن الأسعار ولا المقاسات؟";
    return "نورتنا في Egboot يا فندم! 👔 محتاج تعرف الأسعار ولا المقاسات المتاحة؟";
}

// --- [ استقبال رسائل فيسبوك ] ---
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
                    } catch (e) { console.error("FB API Error"); }
                }
            }
        }
        res.sendStatus(200);
    }
});

app.get('/webhook', (req, res) => res.send(req.query['hub.challenge']));
app.listen(process.env.PORT || 8080);
