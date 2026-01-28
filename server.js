require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs'); 
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const KNOWLEDGE_FILE = path.join(__dirname, 'egboot_knowledge.txt');

const getKnowledge = () => {
    if (!fs.existsSync(KNOWLEDGE_FILE)) {
        fs.writeFileSync(KNOWLEDGE_FILE, "أهلاً بك في Egboot.");
        return "أهلاً بك في Egboot.";
    }
    return fs.readFileSync(KNOWLEDGE_FILE, 'utf8');
};

// --- [ عقل البياع الشاطر ] ---
function smartSalesman(userMsg, knowledge) {
    const msg = userMsg.toLowerCase().trim();
    const lines = knowledge.split('\n').filter(l => l.trim().length > 3);
    
    // 1. تحديد "موضوع" السؤال (Intent Identification)
    let intent = "عام";
    if (/(سعر|بكام|فلوس|جنيه|تكلفة|بكم)/.test(msg)) intent = "أسعار";
    if (/(شحن|توصيل|محافظة|مكان|عنوان|سوهاج|صعيد|قاهرة|فين)/.test(msg)) intent = "شحن";
    if (/(مقاس|وزن|طول|يلبس|كبير|صغير)/.test(msg)) intent = "مقاسات";
    if (/(خامة|نوع|قطن|قماش|بتوبر|بتكش)/.test(msg)) intent = "خامات";
    if (/(أوردر|طلب|اشتري|احجز)/.test(msg)) intent = "طلب";

    // 2. تصفية "السبورة" بناءً على الموضوع عشان ميردش رد عشوائي
    let relevantLines = lines.filter(line => {
        const l = line.toLowerCase();
        if (intent === "أسعار") return l.includes("جنيه") || l.includes("سعر");
        if (intent === "شحن") return l.includes("شحن") || l.includes("توصيل") || l.includes("جنيه");
        if (intent === "مقاسات") return l.includes("مقاس") || l.includes("كيلو") || l.includes("يلبس");
        return true;
    });

    // 3. اختيار أدق سطر داخل الموضوع
    let bestMatch = "";
    let highestScore = 0;
    
    relevantLines.forEach(line => {
        let score = 0;
        const words = msg.split(/\s+/);
        words.forEach(word => {
            if (word.length > 2 && line.toLowerCase().includes(word)) score += 10;
        });

        // ميزة إضافية: لو الزبون سأل عن محافظة بعيدة، بنعلي سطر الـ 70 جنيه فوراً
        if (intent === "شحن" && /(سوهاج|صعيد|منيا|اسيوط|قنا)/.test(msg) && line.includes("70")) score += 100;
        if (intent === "شحن" && /(قاهرة|جيزة|قاهره)/.test(msg) && line.includes("50")) score += 100;

        if (score > highestScore) {
            highestScore = score;
            bestMatch = line;
        }
    });

    // 4. إضافة السلام "مرة واحدة فقط" لو الرسالة فيها تحية
    let reply = bestMatch || "نورتنا يا فندم! 👔 سؤالك بخصوص إيه في Egboot عشان أقدر أفيدك؟";
    if (/^(سلام|أهلا|هاي|صباح|مساء)/.test(msg)) {
        reply = "وعليكم السلام يا فندم، نورت Egboot! 👔\n" + (bestMatch ? bestMatch : "أؤمرني يا ذوق، محتاج تعرف إيه عن موديلاتنا؟");
    }

    return reply;
}

// --- [ الويب هوك ولوحة الإدارة ] ---
app.get('/admin', (req, res) => {
    res.send(`<html dir="rtl"><body style="font-family:sans-serif; background:#f4f7f6; padding:20px;">
        <div style="max-width:800px; margin:auto; background:white; padding:25px; border-radius:15px; box-shadow:0 4px 15px rgba(0,0,0,0.1);">
            <h2 style="color:#007bff; text-align:center;">🧠 مخ البياع الشاطر (Egboot)</h2>
            <form action="/admin/save" method="POST">
                <textarea name="content" style="width:100%; height:450px; padding:15px; font-size:16px;">${getKnowledge()}</textarea>
                <button type="submit" style="width:100%; padding:15px; background:#28a745; color:white; border:none; border-radius:10px; cursor:pointer;">تحديث بيانات المنتجات</button>
            </form>
        </div>
    </body></html>`);
});

app.post('/admin/save', (req, res) => {
    fs.writeFileSync(KNOWLEDGE_FILE, req.body.content);
    res.send('<script>alert("تم تحديث ذكاء البياع!"); window.location.href="/admin";</script>');
});

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of (entry.messaging || [])) {
                if (event.message && event.message.text) {
                    const reply = smartSalesman(event.message.text, getKnowledge());
                    try {
                        await axios.post('https://graph.facebook.com/v18.0/me/messages?access_token=' + process.env.PAGE_ACCESS_TOKEN, {
                            recipient: { id: event.sender.id },
                            message: { text: reply }
                        });
                    } catch (e) { console.error("Send Error"); }
                }
            }
        }
        res.sendStatus(200);
    }
});

app.get('/webhook', (req, res) => res.send(req.query['hub.challenge']));
app.listen(process.env.PORT || 8080);
