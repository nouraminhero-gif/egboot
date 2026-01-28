require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs'); 
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const KNOWLEDGE_FILE = path.join(__dirname, 'egboot_knowledge.txt');

// --- [ محرك الذكاء الاصطناعي للبياع الشاطر ] ---
class EgbootAI {
    constructor(knowledge) {
        this.data = knowledge.split('\n').filter(line => line.trim().length > 5);
    }

    // 1. تحليل "نية" العميل (Intent Analysis)
    analyzeIntent(msg) {
        if (/(سعر|بكام|فلوس|جنيه|تكلفة|بكم)/.test(msg)) return "PRICE";
        if (/(شحن|توصيل|محافظة|سوهاج|صعيد|قاهرة|فين|عنوان)/.test(msg)) return "SHIPPING";
        if (/(مقاس|وزن|طول|يلبس|كيلو)/.test(msg)) return "SIZE";
        if (/(أوردر|طلب|اشتري|احجز|عايز)/.test(msg)) return "ORDER";
        if (/(سلام|أهلا|هاي|نورت)/.test(msg)) return "GREETING";
        return "GENERAL";
    }

    // 2. البحث الذكي المبني على السياق
    findResponse(userMsg) {
        const msg = userMsg.toLowerCase();
        const intent = this.analyzeIntent(msg);
        let bestMatch = "";
        let maxScore = 0;

        for (let line of this.data) {
            let score = 0;
            const lineLow = line.toLowerCase();

            // ذكاء التخصيص: لو النية شحن، نركز فقط على سطور الشحن ونرفع قوتها
            if (intent === "SHIPPING" && (lineLow.includes("شحن") || lineLow.includes("توصيل"))) score += 30;
            if (intent === "PRICE" && lineLow.includes("جنيه")) score += 30;
            if (intent === "SIZE" && lineLow.includes("مقاس")) score += 30;

            // نظام "النقاط" للكلمات المتقاطعة
            const keywords = msg.split(/\s+/);
            keywords.forEach(word => {
                if (word.length > 2 && lineLow.includes(word)) score += 10;
            });

            // حل مشكلة "سوهاج" والصعيد (أولوية قصوى)
            if (/(سوهاج|صعيد|قنا|اسيوط|منيا|أسوان)/.test(msg) && lineLow.includes("70")) score += 100;
            if (/(قاهرة|جيزة|مهندسين|تجمع)/.test(msg) && lineLow.includes("50")) score += 100;

            if (score > maxScore) {
                maxScore = score;
                bestMatch = line;
            }
        }

        // 3. صياغة الرد النهائي (بناءً على الذكاء)
        if (intent === "GREETING") {
            return "وعليكم السلام يا فندم، نورت Egboot! 👔\n" + (bestMatch || "أؤمرني يا ذوق، محتاج تعرف إيه عن موديلاتنا؟");
        }
        
        return bestMatch || "نورتنا يا فندم! 👔 سؤالك بخصوص إيه في Egboot عشان أقدر أفيدك؟";
    }
}

// --- [ مسارات السيرفر ] ---
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of (entry.messaging || [])) {
                if (event.message && event.message.text) {
                    const knowledge = fs.readFileSync(KNOWLEDGE_FILE, 'utf8');
                    const bot = new EgbootAI(knowledge);
                    const reply = bot.findResponse(event.message.text);

                    try {
                        await axios.post('https://graph.facebook.com/v18.0/me/messages?access_token=' + process.env.PAGE_ACCESS_TOKEN, {
                            recipient: { id: event.sender.id },
                            message: { text: reply }
                        });
                    } catch (e) { console.error("API Error"); }
                }
            }
        }
        res.sendStatus(200);
    }
});

// صفحة الأدمن (مخ البوت)
app.get('/admin', (req, res) => {
    const data = fs.readFileSync(KNOWLEDGE_FILE, 'utf8');
    res.send(`<html dir="rtl"><body style="font-family:sans-serif; background:#f0f2f5; padding:20px;">
        <div style="max-width:800px; margin:auto; background:white; padding:30px; border-radius:15px; box-shadow:0 4px 10px rgba(0,0,0,0.1);">
            <h2 style="color:#1877f2; text-align:center;">🧠 نظام تدريب البائع (Egboot AI)</h2>
            <form action="/admin/save" method="POST">
                <textarea name="content" style="width:100%; height:400px; padding:15px; border-radius:10px; border:1px solid #ddd; font-size:16px;">${data}</textarea>
                <button type="submit" style="width:100%; padding:15px; background:#42b72a; color:white; border:none; border-radius:10px; cursor:pointer; font-weight:bold; margin-top:10px; font-size:18px;">تحديث عقل البوت</button>
            </form>
        </div>
    </body></html>`);
});

app.post('/admin/save', (req, res) => {
    fs.writeFileSync(KNOWLEDGE_FILE, req.body.content);
    res.send('<script>alert("تم تحديث الذكاء!"); window.location.href="/admin";</script>');
});

app.get('/webhook', (req, res) => res.send(req.query['hub.challenge']));
app.listen(process.env.PORT || 8080);
