require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const KNOWLEDGE_FILE = path.join(__dirname, 'egboot_knowledge.txt');
const sessions = {}; // ذاكرة إدارة الحالة والشخصية

// --- [ محرك الشخصية والذكاء الاصطناعي ] ---
class EgbootAI {
    constructor(userId) {
        this.userId = userId;
        if (!sessions[userId]) {
            sessions[userId] = { 
                step: "WELCOME", 
                product: "", 
                greeted: false 
            };
        }
        this.session = sessions[userId];
    }

    process(msg) {
        const text = msg.toLowerCase();
        const data = fs.readFileSync(KNOWLEDGE_FILE, 'utf8').split('\n').filter(l => l.trim().length > 5);

        // 1. إدارة الشخصية: الترحيب الذكي (مرة واحدة فقط)
        if (/(سلام|أهلا|هاي|نورت)/.test(text) && !this.session.greeted) {
            this.session.greeted = true;
            this.session.step = "DISCOVERY";
            return "وعليكم السلام يا ذوق، نورت Egboot! 👔 أنا مساعدك الشخصي، تحب تتفرج على موديلات التيشيرتات الصيفي ولا بتدور على قميص كاجوال شيك؟";
        }

        // 2. إدارة السياق: تثبيت المنتج (عشان ميتوهش بين القميص والبنطلون)
        if (text.includes("قميص")) this.session.product = "قميص";
        else if (text.includes("تيشيرت")) this.session.product = "تيشيرت";
        else if (text.includes("بنطلون")) this.session.product = "بنطلون";

        // 3. محرك الترجيح المنطقي (Logic Scoring)
        let bestMatch = "";
        let maxScore = -1;

        for (let line of data) {
            let score = 0;
            const lineLow = line.toLowerCase();

            // مطابقة المنتج الحالي (أهمية قصوى لمنع التداخل)
            if (this.session.product && lineLow.includes(this.session.product)) score += 100;

            // ذكاء الأرقام: حل مشكلة الـ 100 كيلو (أعلى أولوية)
            const weightMatch = text.match(/\d+/);
            if (weightMatch && (text.includes("كيلو") || text.includes("وزن") || text.includes("البس"))) {
                if (lineLow.includes(weightMatch[0])) score += 300; 
            }

            // تحليل النية (سعر، مقاس، شحن)
            if (/(سعر|بكام|جنيه)/.test(text) && lineLow.includes("جنيه")) score += 50;
            if (/(مقاس|البس)/.test(text) && lineLow.includes("مقاس")) score += 50;
            if (/(شحن|توصيل)/.test(text) && lineLow.includes("شحن")) score += 50;

            if (score > maxScore) {
                maxScore = score;
                bestMatch = line;
            }
        }

        // 4. تطوير المحادثة (لو العميل تاه أو سأل سؤال مبهم)
        if (maxScore < 20) {
            if (this.session.step === "DISCOVERY") {
                return "تحت أمرك يا فندم! 👔 إحنا في Egboot متخصصين في الملابس الرجالي، قولي بتدور على حاجة صيفي ولا خريفي عشان أرشحلك الأفضل؟";
            }
            return "نورتنا يا فندم! 👔 عشان أقدر أساعدك بالظبط، قولي الموديل اللي عجبك إيه أو وزنك كام عشان أقولك المقاس المظبوط؟";
        }

        return bestMatch;
    }
}

// --- [ مسارات الويب هوك والأدمن ] ---

app.get('/admin', (req, res) => {
    const content = fs.existsSync(KNOWLEDGE_FILE) ? fs.readFileSync(KNOWLEDGE_FILE, 'utf8') : "";
    res.send(`<html dir="rtl"><body style="font-family:sans-serif; background:#f0f2f5; padding:40px;">
        <div style="max-width:800px; margin:auto; background:white; padding:30px; border-radius:15px; box-shadow:0 10px 20px rgba(0,0,0,0.1);">
            <h2 style="text-align:center; color:#2c3e50;">🖋️ تدريب شخصية بياع Egboot الذكي</h2>
            <form action="/admin/save" method="POST">
                <textarea name="content" style="width:100%; height:400px; padding:15px; border-radius:10px; border:1px solid #ddd; font-size:16px;">${content}</textarea>
                <button type="submit" style="width:100%; padding:15px; background:#1abc9c; color:white; border:none; border-radius:10px; font-weight:bold; cursor:pointer; margin-top:15px;">تحديث وتطوير الشخصية</button>
            </form>
        </div>
    </body></html>`);
});

app.post('/admin/save', (req, res) => {
    fs.writeFileSync(KNOWLEDGE_FILE, req.body.content);
    res.send('<script>alert("تم تحديث عقل البياع بنجاح!"); window.location.href="/admin";</script>');
});

app.post('/webhook', async (req, res) => {
    const { object, entry } = req.body;
    if (object === 'page') {
        for (let e of entry) {
            for (let m of (e.messaging || [])) {
                if (m.message && m.message.text) {
                    const brain = new EgbootAI(m.sender.id);
                    const reply = brain.process(m.message.text);
                    if (reply) {
                        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
                            recipient: { id: m.sender.id },
                            message: { text: reply }
                        }).catch(err => console.error("Error sending message"));
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

app.listen(process.env.PORT || 8080, () => console.log('Egboot AI Seller is Active!'));
