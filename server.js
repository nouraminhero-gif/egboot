require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs'); 
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const KNOWLEDGE_FILE = path.join(__dirname, 'egboot_knowledge.txt');
const NICHE_FILE = path.join(__dirname, 'niche_config.txt');

// ذاكرة مؤقتة لمنع تكرار السلام (Session Memory)
const greetedUsers = new Set();

const getData = (file) => {
    if (!fs.existsSync(file)) fs.writeFileSync(file, "");
    return fs.readFileSync(file, 'utf8');
};

// --- [ محرك الذكاء الاصطناعي الجوكر ] ---
class UniversalAI {
    constructor(knowledge, niche) {
        this.niche = niche.trim() || 'fashion';
        this.lines = knowledge.split('\n').filter(l => l.trim().length > 2);
    }

    // تحليل نية الزبون بناءً على نوع النشاط
    getIntent(msg) {
        if (/(سعر|بكام|فلوس|جنيه|كشف|فيزيتا|تكلفة)/.test(msg)) return "PRICE";
        if (/(شحن|توصيل|عنوان|فين|موقع|محافظة|مكان)/.test(msg)) return "LOCATION";
        
        // تغيير مفهوم "المقاس" حسب النشاط
        if (this.niche === 'medical') {
            if (/(موعد|حجز|وقت|يوم|ساعة)/.test(msg)) return "DETAILS";
        } else {
            if (/(مقاس|وزن|طول|يلبس|كيلو|مقاسات)/.test(msg)) return "DETAILS";
        }
        
        if (/(أوردر|طلب|اشتري|احجز|عايز)/.test(msg)) return "ORDER";
        if (/(سلام|أهلا|هاي|نورت)/.test(msg)) return "GREETING";
        return "GENERAL";
    }

    findResponse(userMsg, userId) {
        const msg = userMsg.toLowerCase();
        const intent = this.getIntent(msg);
        
        // 1. معالجة الترحيب الذكي (مرة واحدة فقط)
        if (intent === "GREETING") {
            if (greetedUsers.has(userId)) return ""; // تجاهل لو سلم قبل كدة
            greetedUsers.add(userId);
            return "وعليكم السلام يا فندم، نورتنا في Egboot! 👔 أؤمرني أساعدك إزاي؟";
        }

        let bestMatch = "";
        let maxScore = 0;

        // 2. البحث بنظام "عزل السياق" (Context Locking)
        for (let line of this.lines) {
            let score = 0;
            const lineLow = line.toLowerCase();

            // مطابقة اسم المنتج (لمعرفة هل يتحدث عن ساعة، قميص، أو كشف)
            const words = msg.split(/\s+/);
            words.forEach(word => {
                if (word.length > 2 && lineLow.includes(word)) score += 20;
            });

            // ربط النية بالبيانات (لو بيسأل عن سعر، السطر اللي فيه "جنيه" ياخد أولوية)
            if (intent === "PRICE" && (lineLow.includes("جنيه") || lineLow.includes("سعر"))) score += 30;
            if (intent === "DETAILS" && (lineLow.includes("مقاس") || lineLow.includes("موعد") || lineLow.includes("وزن"))) score += 30;

            // ذكاء الأرقام (لو كتب وزنه 100، يروح للسطر اللي فيه 100)
            const numMatch = msg.match(/\d+/);
            if (numMatch && lineLow.includes(numMatch[0])) score += 50;

            // ذكاء المناطق الجغرافية
            if (intent === "LOCATION") {
                if (/(سوهاج|صعيد|اسيوط|قنا|منيا)/.test(msg) && lineLow.includes("70")) score += 100;
                if (/(قاهرة|جيزة|مهندسين|تجمع)/.test(msg) && lineLow.includes("50")) score += 100;
            }

            if (score > maxScore) {
                maxScore = score;
                bestMatch = line;
            }
        }

        return bestMatch || "نورتنا يا فندم! 👔 ممكن توضح سؤالك أكتر عشان أقدر أفيدك؟";
    }
}

// --- [ مسارات السيرفر والأدمن ] ---

app.get('/admin', (req, res) => {
    const data = getData(KNOWLEDGE_FILE);
    const niche = getData(NICHE_FILE);
    res.send(`<html dir="rtl"><body style="font-family:sans-serif; background:#f0f2f5; padding:20px;">
        <div style="max-width:800px; margin:auto; background:white; padding:30px; border-radius:15px; box-shadow:0 4px 10px rgba(0,0,0,0.1);">
            <h2 style="color:#1877f2; text-align:center;">🧠 لوحة تحكم المنصة (Egboot AI)</h2>
            <form action="/admin/save" method="POST">
                <label><b>نوع النشاط:</b></label>
                <select name="niche" style="width:100%; padding:10px; margin:10px 0; border-radius:5px;">
                    <option value="fashion" ${niche==='fashion'?'selected':''}>ملابس</option>
                    <option value="medical" ${niche==='medical'?'selected':''}>عيادة طبية</option>
                    <option value="electronics" ${niche==='electronics'?'selected':''}>ساعات / إلكترونيات</option>
                    <option value="home" ${niche==='home'?'selected':''}>أدوات منزلية</option>
                </select>
                <label><b>البيانات (نظمها بسطور مباشرة):</b></label>
                <textarea name="content" style="width:100%; height:350px; padding:15px; margin-top:10px; border-radius:10px; border:1px solid #ddd;">${data}</textarea>
                <button type="submit" style="width:100%; padding:15px; background:#42b72a; color:white; border:none; border-radius:10px; cursor:pointer; font-weight:bold; margin-top:10px;">تحديث عقل البوت</button>
            </form>
        </div>
    </body></html>`);
});

app.post('/admin/save', (req, res) => {
    fs.writeFileSync(KNOWLEDGE_FILE, req.body.content);
    fs.writeFileSync(NICHE_FILE, req.body.niche);
    res.send('<script>alert("تم التحديث!"); window.location.href="/admin";</script>');
});

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of (entry.messaging || [])) {
                if (event.message && event.message.text) {
                    const ai = new UniversalAI(getData(KNOWLEDGE_FILE), getData(NICHE_FILE));
                    const reply = ai.findResponse(event.message.text, event.sender.id);
                    
                    if (reply) { // إرسال فقط لو فيه رد (منع تكرار السلام الفارغ)
                        try {
                            await axios.post('https://graph.facebook.com/v18.0/me/messages?access_token=' + process.env.PAGE_ACCESS_TOKEN, {
                                recipient: { id: event.sender.id },
                                message: { text: reply }
                            });
                        } catch (e) { console.error("FB Error"); }
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
