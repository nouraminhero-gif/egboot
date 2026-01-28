require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs'); 
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const KNOWLEDGE_FILE = './egboot_knowledge.txt';

const getKnowledge = () => {
    try {
        if (fs.existsSync(KNOWLEDGE_FILE)) return fs.readFileSync(KNOWLEDGE_FILE, 'utf8');
    } catch (e) { return ""; }
    return "";
};

// --- [ محرك الردود الذكي والمختصر ] ---
function findSmartResponse(userMsg, knowledge) {
    const msg = userMsg.toLowerCase().trim();
    const lines = knowledge.split('\n').filter(line => line.trim().length > 5);
    
    let greeting = "";
    // 1. التحقق من وجود سلام
    if (msg.includes("سلام") || msg.includes("عليكم") || msg.includes("أهلاً") || msg.includes("صباح") || msg.includes("مساء")) {
        greeting = "وعليكم السلام يا فندم، نورت Egboot! 👔 ";
    }

    // 2. البحث عن إجابة محددة (على قد السؤال)
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

    // لو لقى إجابة دقيقة، يرجعها مع السلام
    if (highestScore > 0) {
        return greeting + bestMatch;
    }

    // لو مفيش إجابة بس فيه سلام
    if (greeting !== "") return greeting + "أؤمرني يا فندم، محتاج تعرف إيه عن موديلاتنا؟";

    // الرد الافتراضي المختصر
    return "أهلاً بك في Egboot! محتاج تعرف الأسعار ولا المقاسات المتاحة؟";
}

// --- [ باقي الكود (الأدمن والويب هوك) ] ---
app.get('/admin', (req, res) => {
    const currentData = getKnowledge();
    res.send(`<html dir="rtl"><body style="font-family:sans-serif; padding:20px; background:#f4f7f6;">
        <div style="max-width:800px; margin:auto; background:white; padding:25px; border-radius:15px; box-shadow:0 4px 15px rgba(0,0,0,0.1);">
            <h2 style="color:#007bff; text-align:center;">🧠 تطوير ردود Egboot</h2>
            <p style="color:#666;">نصيحة: اكتب كل معلومة في سطر مستقل (مثلاً: سطر للسعر، سطر للشحن).</p>
            <form action="/admin/save" method="POST">
                <textarea name="content" style="width:100%; height:400px; padding:15px; font-size:16px;">${currentData}</textarea>
                <button type="submit" style="width:100%; padding:15px; background:#28a745; color:white; border:none; border-radius:10px; cursor:pointer; font-weight:bold; margin-top:10px;">حفظ وتدريب</button>
            </form>
        </div>
    </body></html>`);
});

app.post('/admin/save', (req, res) => {
    fs.writeFileSync(KNOWLEDGE_FILE, req.body.content);
    res.send('<script>alert("تم التحديث!"); window.location.href="/admin";</script>');
});

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
                    } catch (e) { console.error("FB Error"); }
                }
            }
        }
        res.sendStatus(200);
    }
});

app.get('/webhook', (req, res) => res.send(req.query['hub.challenge']));
app.listen(process.env.PORT || 8080);
