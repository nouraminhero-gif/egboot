require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json());

const KNOWLEDGE_FILE = path.join(__dirname, 'egboot_knowledge.txt');
const memory = {}; // ذاكرة ذكية لكل مستخدم

// دالة جلب البيانات من الدستور
const getStoredData = () => fs.readFileSync(KNOWLEDGE_FILE, 'utf8').split('\n').filter(l => l.trim().length > 5);

// --- [ محرك الذكاء الاصطناعي الخارق ] ---
class EgbootBrain {
    constructor(userId) {
        this.userId = userId;
        if (!memory[userId]) memory[userId] = { lastProduct: "", greeted: false };
        this.data = getStoredData();
    }

    // تنظيف وتحليل نية الزبون
    analyzeIntent(msg) {
        if (/(سلام|اهلا|نورت|صباح|مساء)/.test(msg)) return "GREET";
        if (/(بكام|سعر|فلوس|جنيه)/.test(msg)) return "PRICE";
        if (/(مقاس|وزن|طول|كيلو|البس)/.test(msg)) return "SIZE";
        if (/(شحن|توصيل|فين|محافظة)/.test(msg)) return "SHIPPING";
        return "INFO";
    }

    process(userMsg) {
        const msg = userMsg.toLowerCase();
        const intent = this.analyzeIntent(msg);

        // 1. إدارة الترحيب (منع التكرار المزعج)
        if (intent === "GREET") {
            if (memory[this.userId].greeted) return ""; 
            memory[this.userId].greeted = true;
            return "وعليكم السلام يا فندم، نورت Egboot! 👔 أؤمرني أساعدك إزاي؟";
        }

        // 2. تحديث "سياق المنتج" (عشان ميتوهش بين القميص والبنطلون)
        if (msg.includes("قميص")) memory[this.userId].lastProduct = "قميص";
        else if (msg.includes("تيشيرت")) memory[this.userId].lastProduct = "تيشيرت";
        else if (msg.includes("بنطلون")) memory[this.userId].lastProduct = "بنطلون";

        let candidates = [];

        for (let line of this.data) {
            let score = 0;
            const lineLow = line.toLowerCase();

            // مكافأة مطابقة المنتج (Context Match)
            if (memory[this.userId].lastProduct && lineLow.includes(memory[this.userId].lastProduct)) score += 150;

            // مكافأة مطابقة الأرقام (الوزن)
            const foundNumbers = msg.match(/\d+/g);
            if (foundNumbers) {
                foundNumbers.forEach(n => {
                    if (lineLow.includes(n)) score += 300; // أولوية مطلقة للرقم
                });
            }

            // مطابقة النية (سعر مع سعر، شحن مع شحن)
            if (intent === "PRICE" && lineLow.includes("جنيه")) score += 100;
            if (intent === "SHIPPING" && (lineLow.includes("شحن") || lineLow.includes("توصيل"))) score += 100;

            candidates.push({ line, score });
        }

        // ترتيب النتائج واختيار الأقوى
        candidates.sort((a, b) => b.score - a.score);
        const bestMatch = candidates[0];

        if (bestMatch && bestMatch.score > 20) {
            return bestMatch.line;
        }

        return "نورتنا يا فندم! 👔 ممكن توضح محتاج تيشيرت ولا قميص عشان أساعدك بدقة؟";
    }
}

// --- [ مسارات النظام ] ---

app.get('/admin', (req, res) => {
    const content = fs.readFileSync(KNOWLEDGE_FILE, 'utf8');
    res.send(`<html dir="rtl"><body style="background:#f4f7f6; font-family:sans-serif; padding:40px;">
        <div style="max-width:900px; margin:auto; background:white; padding:30px; border-radius:20px; box-shadow:0 10px 30px rgba(0,0,0,0.1);">
            <h1 style="color:#2c3e50; text-align:center;">🚀 لوحة تحكم Egboot Ultra AI</h1>
            <p style="text-align:center; color:#7f8c8d;">نظام ذكي يفهم السياق والأرقام (أقوى من موجيب)</p>
            <form action="/admin/save" method="POST">
                <textarea name="content" style="width:100%; height:450px; padding:20px; border-radius:15px; border:2px solid #eee; font-size:16px;">${content}</textarea>
                <button type="submit" style="width:100%; padding:18px; background:#1abc9c; color:white; border:none; border-radius:15px; font-size:18px; font-weight:bold; cursor:pointer; margin-top:20px;">تحديث عقل النظام</button>
            </form>
        </div>
    </body></html>`);
});

app.post('/admin/save', express.urlencoded({ extended: true }), (req, res) => {
    fs.writeFileSync(KNOWLEDGE_FILE, req.body.content);
    res.send('<script>alert("تم التحديث بنجاح!"); window.location.href="/admin";</script>');
});

app.post('/webhook', async (req, res) => {
    const { object, entry } = req.body;
    if (object === 'page') {
        for (let e of entry) {
            for (let m of (e.messaging || [])) {
                if (m.message && m.message.text) {
                    const brain = new EgbootBrain(m.sender.id);
                    const reply = brain.process(m.message.text);
                    if (reply) {
                        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
                            recipient: { id: m.sender.id },
                            message: { text: reply }
                        });
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
