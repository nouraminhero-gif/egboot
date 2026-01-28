require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs'); 
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const KNOWLEDGE_FILE = path.join(__dirname, 'egboot_knowledge.txt');

// ضمان استقرار البيانات لصفحة الأدمن
const getKnowledge = () => {
    if (!fs.existsSync(KNOWLEDGE_FILE)) {
        fs.writeFileSync(KNOWLEDGE_FILE, "أهلاً بك في Egboot.\nسعر القميص 450 جنيه.");
    }
    return fs.readFileSync(KNOWLEDGE_FILE, 'utf8');
};

// --- [ عقل الـ AI بائع المنصة ] ---
class ProfessionalSellerAI {
    constructor(knowledge) {
        // تنظيف البيانات من أي عناوين أقسام أو رموز قد تشوش الرد
        this.data = knowledge.split('\n').filter(l => l.trim().length > 3 && !l.includes('['));
    }

    // تحليل نية العميل (Intent Classification)
    identifyIntent(msg) {
        if (/(سعر|بكام|فلوس|جنيه|تكلفة)/.test(msg)) return "PRICE";
        if (/(شحن|توصيل|محافظة|فين|عنوان|سوهاج|اسيوط|قاهرة|جيزة)/.test(msg)) return "SHIPPING";
        if (/(مقاس|وزن|طول|يلبس|كيلو)/.test(msg)) return "SIZE";
        if (/(أوردر|طلب|اشتري|احجز)/.test(msg)) return "ORDER";
        if (/(سلام|أهلا|هاي|نورت)/.test(msg)) return "GREETING";
        return "GENERAL";
    }

    // المنطق العصبي لاختيار الرد الأدق
    findBestReply(userMsg) {
        const msg = userMsg.toLowerCase();
        const intent = this.identifyIntent(msg);
        let winner = "";
        let maxScore = 0;

        for (let line of this.data) {
            let score = 0;
            const lineLow = line.toLowerCase();

            // رفع الأولوية حسب النية
            if (intent === "PRICE" && lineLow.includes("جنيه")) score += 40;
            if (intent === "SHIPPING" && (lineLow.includes("شحن") || lineLow.includes("توصيل"))) score += 40;
            if (intent === "SIZE" && lineLow.includes("مقاس")) score += 40;

            // ذكاء المحافظات (سوهاج والصعيد vs القاهرة)
            if (/(سوهاج|اسيوط|قنا|منيا|صعيد)/.test(msg) && lineLow.includes("70")) score += 100;
            if (/(قاهرة|جيزة|مهندسين|تجمع)/.test(msg) && lineLow.includes("50")) score += 100;

            // تطابق الكلمات المفتاحية
            msg.split(/\s+/).forEach(word => {
                if (word.length > 2 && lineLow.includes(word)) score += 15;
            });

            if (score > maxScore) {
                maxScore = score;
                winner = line;
            }
        }

        // معالجة الترحيب (مرة واحدة فقط)
        if (intent === "GREETING") {
            return "وعليكم السلام يا فندم، نورت Egboot! 👔\n" + (winner || "أؤمرني يا ذوق، حابب تعرف إيه عن موديلاتنا؟");
        }
        
        return winner || "نورتنا يا فندم! 👔 سؤالك بخصوص إيه عشان أقدر أفيدك؟";
    }
}

// --- [ المسارات: الإدارة والويب هوك ] ---

app.get('/admin', (req, res) => {
    const data = getKnowledge();
    res.send(`<html dir="rtl"><body style="font-family:sans-serif; background:#f0f2f5; padding:20px;">
        <div style="max-width:800px; margin:auto; background:white; padding:30px; border-radius:15px; box-shadow:0 4px 10px rgba(0,0,0,0.1);">
            <h2 style="color:#1877f2; text-align:center;">🧠 لوحة تحكم بياع المنصة (AI)</h2>
            <form action="/admin/save" method="POST">
                <textarea name="content" style="width:100%; height:450px; padding:15px; font-size:16px; border-radius:10px; border:1px solid #ddd;">${data}</textarea>
                <button type="submit" style="width:100%; padding:15px; background:#42b72a; color:white; border:none; border-radius:10px; cursor:pointer; font-weight:bold; margin-top:10px;">حفظ وتدريب البائع</button>
            </form>
        </div>
    </body></html>`);
});

app.post('/admin/save', (req, res) => {
    fs.writeFileSync(KNOWLEDGE_FILE, req.body.content);
    res.send('<script>alert("تم تحديث ذكاء البوت!"); window.location.href="/admin";</script>');
});

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of (entry.messaging || [])) {
                if (event.message && event.message.text) {
                    const bot = new ProfessionalSellerAI(getKnowledge());
                    const reply = bot.findBestReply(event.message.text);
                    try {
                        await axios.post('https://graph.facebook.com/v18.0/me/messages?access_token=' + process.env.PAGE_ACCESS_TOKEN, {
                            recipient: { id: event.sender.id },
                            message: { text: reply }
                        });
                    } catch (e) { console.error("Error"); }
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
