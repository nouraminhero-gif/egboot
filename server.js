require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs'); 
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// تأمين مسار ملف البيانات لضمان عمل صفحة الأدمن دائماً
const KNOWLEDGE_FILE = path.join(__dirname, 'egboot_knowledge.txt');

// دالة لجلب البيانات والتأكد من وجود الملف
const getKnowledge = () => {
    if (!fs.existsSync(KNOWLEDGE_FILE)) {
        fs.writeFileSync(KNOWLEDGE_FILE, "أهلاً بك في Egboot.");
    }
    return fs.readFileSync(KNOWLEDGE_FILE, 'utf8');
};

// --- [ محرك الذكاء الاصطناعي للبياع الشاطر ] ---
class EgbootAI {
    constructor(knowledge) {
        this.data = knowledge.split('\n').filter(line => line.trim().length > 3);
    }

    // تحليل نية الزبون (Intent Classification)
    analyzeIntent(msg) {
        if (/(سعر|بكام|فلوس|جنيه|تكلفة|بكم)/.test(msg)) return "PRICE";
        if (/(شحن|توصيل|محافظة|سوهاج|صعيد|قاهرة|فين|عنوان|مهندسين|تجمع)/.test(msg)) return "SHIPPING";
        if (/(مقاس|وزن|طول|يلبس|كيلو)/.test(msg)) return "SIZE";
        if (/(أوردر|طلب|اشتري|احجز|عايز)/.test(msg)) return "ORDER";
        if (/(سلام|أهلا|هاي|نورت)/.test(msg)) return "GREETING";
        return "GENERAL";
    }

    // اختيار الرد الأدق بناءً على النية والسياق
    findResponse(userMsg) {
        const msg = userMsg.toLowerCase();
        const intent = this.analyzeIntent(msg);
        let bestMatch = "";
        let maxScore = 0;

        for (let line of this.data) {
            let score = 0;
            const lineLow = line.toLowerCase();

            // رفع درجة السطر لو طابق "النية" (مثلاً سطر فيه جنيه والزبون بيسأل عن السعر)
            if (intent === "PRICE" && lineLow.includes("جنيه")) score += 40;
            if (intent === "SHIPPING" && (lineLow.includes("شحن") || lineLow.includes("توصيل"))) score += 40;
            if (intent === "SIZE" && lineLow.includes("مقاس")) score += 40;

            // نظام النقاط للكلمات المفتاحية
            const keywords = msg.split(/\s+/);
            keywords.forEach(word => {
                if (word.length > 2 && lineLow.includes(word)) score += 15;
            });

            // حل مشكلة المحافظات (سوهاج والصعيد vs القاهرة)
            if (/(سوهاج|صعيد|قنا|اسيوط|منيا)/.test(msg) && lineLow.includes("70")) score += 100;
            if (/(قاهرة|جيزة|مهندسين|تجمع|معادي)/.test(msg) && lineLow.includes("50")) score += 100;

            if (score > maxScore) {
                maxScore = score;
                bestMatch = line;
            }
        }

        // إضافة السلام في أول مرة فقط
        if (intent === "GREETING") {
            return "وعليكم السلام يا فندم، نورت Egboot لملابس الرجال! 👔\n" + (bestMatch || "أؤمرني يا ذوق، محتاج تعرف إيه عن موديلاتنا؟");
        }
        
        return bestMatch || "نورتنا في Egboot يا فندم! 👔 محتاج تسأل عن الأسعار، المقاسات، ولا الشحن؟";
    }
}

// --- [ مسارات السيرفر وصفحة الأدمن ] ---

// صفحة الأدمن (مخ البوت)
app.get('/admin', (req, res) => {
    const data = getKnowledge();
    res.send(`<html dir="rtl"><body style="font-family:sans-serif; background:#f0f2f5; padding:20px;">
        <div style="max-width:800px; margin:auto; background:white; padding:30px; border-radius:15px; box-shadow:0 4px 10px rgba(0,0,0,0.1);">
            <h2 style="color:#1877f2; text-align:center;">🧠 نظام تدريب البائع (Egboot AI)</h2>
            <p style="text-align:center; color:#666;">اكتب كل معلومة في سطر مستقل بدون أقواس مربعة</p>
            <form action="/admin/save" method="POST">
                <textarea name="content" style="width:100%; height:400px; padding:15px; border-radius:10px; border:1px solid #ddd; font-size:16px;">${data}</textarea>
                <button type="submit" style="width:100%; padding:15px; background:#42b72a; color:white; border:none; border-radius:10px; cursor:pointer; font-weight:bold; margin-top:10px; font-size:18px;">تحديث عقل البوت</button>
            </form>
        </div>
    </body></html>`);
});

app.post('/admin/save', (req, res) => {
    fs.writeFileSync(KNOWLEDGE_FILE, req.body.content);
    res.send('<script>alert("تم تحديث ذكاء البوت بنجاح!"); window.location.href="/admin";</script>');
});

// الويب هوك لاستقبال رسائل فيسبوك
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of (entry.messaging || [])) {
                if (event.message && event.message.text) {
                    const knowledge = getKnowledge();
                    const bot = new EgbootAI(knowledge);
                    const reply = bot.findResponse(event.message.text);

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

app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode && token === process.env.VERIFY_TOKEN) res.status(200).send(challenge);
    else res.sendStatus(403);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
