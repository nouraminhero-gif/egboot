require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const KNOWLEDGE_FILE = path.join(__dirname, 'egboot_knowledge.txt');
const memory = {}; // ذاكرة ذكية تمنع التوهان

// دالة تأكد من وجود الملف وقراءته عشان الأدمن ميقفش
const safeRead = () => {
    if (!fs.existsSync(KNOWLEDGE_FILE)) fs.writeFileSync(KNOWLEDGE_FILE, "أهلاً بك في Egboot.");
    return fs.readFileSync(KNOWLEDGE_FILE, 'utf8');
};

// --- [ محرك الذكاء الاصطناعي المنافس لموجيب ] ---
class EgbootEngine {
    constructor(userId) {
        this.userId = userId;
        if (!memory[userId]) memory[userId] = { context: "", greeted: false };
    }

    process(userMsg) {
        const msg = userMsg.toLowerCase();
        const data = safeRead().split('\n').filter(l => l.trim().length > 3);

        // 1. إدارة الترحيب الذكي (منع التكرار)
        if (/(سلام|اهلا|نورت|صباح|مساء)/.test(msg)) {
            if (memory[this.userId].greeted) return ""; 
            memory[this.userId].greeted = true;
            return "وعليكم السلام يا فندم، نورت Egboot! 👔 أؤمرني أساعدك إزاي؟";
        }

        // 2. تحديد سياق المنتج (عشان ميردش بسعر القميص على تيشيرت)
        if (msg.includes("قميص")) memory[this.userId].context = "قميص";
        else if (msg.includes("تيشيرت")) memory[this.userId].context = "تيشيرت";
        else if (msg.includes("بنطلون")) memory[this.userId].context = "بنطلون";

        let candidates = [];
        for (let line of data) {
            let score = 0;
            const lineLow = line.toLowerCase();

            // مطابقة السياق الحالي
            if (memory[this.userId].context && lineLow.includes(memory[this.userId].context)) score += 100;

            // مطابقة الأرقام (الوزن والمقاس) - حل مشكلة الـ 100 كيلو
            const nums = msg.match(/\d+/g);
            if (nums) {
                nums.forEach(n => { if (lineLow.includes(n)) score += 250; });
            }

            // مطابقة النية (سعر، شحن)
            if (/(سعر|بكام|جنيه)/.test(msg) && lineLow.includes("جنيه")) score += 50;
            if (/(شحن|توصيل)/.test(msg) && lineLow.includes("شحن")) score += 50;

            candidates.push({ line, score });
        }

        candidates.sort((a, b) => b.score - a.score);
        return candidates[0] && candidates[0].score > 10 ? candidates[0].line : "نورتنا يا فندم! 👔 ممكن توضح سؤالك أكتر عشان أقدر أفيدك؟";
    }
}

// --- [ مسارات النظام ] ---

// مسار صفحة الأدمن (مؤمن ضد التوقف)
app.get('/admin', (req, res) => {
    try {
        const content = safeRead();
        res.send(`<html dir="rtl"><body style="background:#f4f7f6; font-family:sans-serif; padding:20px;">
            <div style="max-width:800px; margin:auto; background:white; padding:30px; border-radius:15px; box-shadow:0 5px 15px rgba(0,0,0,0.1);">
                <h2 style="color:#2c3e50; text-align:center;">🚀 لوحة Egboot Ultra AI</h2>
                <form action="/admin/save" method="POST">
                    <textarea name="content" style="width:100%; height:400px; padding:15px; border-radius:10px; border:1px solid #ddd; font-size:16px;">${content}</textarea>
                    <button type="submit" style="width:100%; padding:15px; background:#1abc9c; color:white; border:none; border-radius:10px; font-size:18px; font-weight:bold; cursor:pointer; margin-top:15px;">تحديث وتدريب البوت</button>
                </form>
            </div>
        </body></html>`);
    } catch (e) { res.status(500).send("خطأ في قراءة ملف البيانات"); }
});

app.post('/admin/save', (req, res) => {
    fs.writeFileSync(KNOWLEDGE_FILE, req.body.content);
    res.send('<script>alert("تم التحديث!"); window.location.href="/admin";</script>');
});

app.post('/webhook', async (req, res) => {
    const { object, entry } = req.body;
    if (object === 'page') {
        for (let e of entry) {
            for (let m of (e.messaging || [])) {
                if (m.message && m.message.text) {
                    const engine = new EgbootEngine(m.sender.id);
                    const reply = engine.process(m.message.text);
                    if (reply) {
                        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
                            recipient: { id: m.sender.id },
                            message: { text: reply }
                        }).catch(err => console.error("FB Error"));
                    }
                }
            }
        }
        res.sendStatus(200);
    }
});

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) res.send(req.query['hub.challenge']);
    else res.sendStatus(403);
});

app.listen(process.env.PORT || 8080);
