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

// ذاكرة الجلسة لمنع تكرار السلام
const greetedUsers = new Set();

const getData = (file) => {
    if (!fs.existsSync(file)) fs.writeFileSync(file, "أهلاً بك في Egboot.");
    return fs.readFileSync(file, 'utf8');
};

// --- [ محرك الـ AI الجوكر المطور ] ---
class EgbootSmartAI {
    constructor(knowledge, niche) {
        this.niche = niche.trim() || 'fashion';
        // تنظيف الداتا من العناوين التي تظهر في الردود غلط
        this.lines = knowledge.split('\n').filter(l => l.trim().length > 2 && !l.includes(':'));
    }

    findResponse(userMsg, userId) {
        const msg = userMsg.toLowerCase();
        
        // 1. معالجة الترحيب الذكي (مرة واحدة فقط)
        const isGreeting = /(سلام|أهلا|هاي|نورت|صباح|مساء)/.test(msg);
        if (isGreeting) {
            if (greetedUsers.has(userId)) return ""; 
            greetedUsers.add(userId);
            return "وعليكم السلام يا فندم، نورت Egboot! 👔 أؤمرني أساعدك إزاي؟";
        }

        let bestMatch = "";
        let maxScore = 0;

        for (let line of this.lines) {
            let score = 0;
            const lineLow = line.toLowerCase();

            // 2. مطابقة المنتج (تيشيرت، قميص، ساعة، كشف) لمنع التداخل
            const keywords = ["تيشيرت", "قميص", "بنطلون", "ساعة", "كشف", "حجز"];
            keywords.forEach(key => {
                if (msg.includes(key) && lineLow.includes(key)) score += 60;
            });

            // 3. ذكاء الأرقام (الوزن والمقاس)
            const userNumbers = msg.match(/\d+/g);
            if (userNumbers) {
                userNumbers.forEach(num => {
                    if (lineLow.includes(num)) score += 100; // أولوية قصوى لمطابقة الرقم
                });
            }

            // 4. مطابقة الكلمات المفتاحية العامة
            const words = msg.split(/\s+/);
            words.forEach(word => {
                if (word.length > 2 && lineLow.includes(word)) score += 10;
            });

            // 5. ذكاء الشحن والمناطق
            if (/(شحن|توصيل|محافظة|فين)/.test(msg)) {
                if (/(سوهاج|صعيد|اسيوط|قنا)/.test(msg) && lineLow.includes("70")) score += 80;
                if (/(قاهرة|جيزة|مهندسين|تجمع)/.test(msg) && lineLow.includes("50")) score += 80;
            }

            if (score > maxScore) {
                maxScore = score;
                bestMatch = line;
            }
        }

        // رد افتراضي ذكي لو لم يجد نتيجة
        return bestMatch || "نورتنا يا فندم! 👔 ممكن توضح سؤالك أكتر (محتاج تيشيرت ولا قميص؟) عشان أقدر أفيدك بدقة؟";
    }
}

// --- [ مسارات الإدارة والويب هوك ] ---

app.get('/admin', (req, res) => {
    const data = getData(KNOWLEDGE_FILE);
    const niche = getData(NICHE_FILE);
    res.send(`<html dir="rtl"><body style="font-family:sans-serif; background:#f0f2f5; padding:20px;">
        <div style="max-width:850px; margin:auto; background:white; padding:30px; border-radius:15px; box-shadow:0 4px 15px rgba(0,0,0,0.1);">
            <h2 style="color:#1877f2; text-align:center;">🧠 لوحة تحكم Egboot AI الجوكر</h2>
            <form action="/admin/save" method="POST">
                <label><b>نوع النشاط التجاري:</b></label>
                <select name="niche" style="width:100%; padding:12px; margin:10px 0; border-radius:8px; border:1px solid #ddd;">
                    <option value="fashion" ${niche==='fashion'?'selected':''}>ملابس وأزياء</option>
                    <option value="medical" ${niche==='medical'?'selected':''}>عيادة / خدمات طبية</option>
                    <option value="electronics" ${niche==='electronics'?'selected':''}>ساعات / إلكترونيات</option>
                </select>
                <label><b>بيانات الردود (سطور مباشرة بدون عناوين):</b></label>
                <textarea name="content" style="width:100%; height:380px; padding:15px; margin-top:10px; border-radius:10px; border:1px solid #ddd; font-size:16px;">${data}</textarea>
                <button type="submit" style="width:100%; padding:15px; background:#42b72a; color:white; border:none; border-radius:10px; cursor:pointer; font-weight:bold; margin-top:15px; font-size:18px;">تحديث وتدريب البوت</button>
            </form>
        </div>
    </body></html>`);
});

app.post('/admin/save', (req, res) => {
    fs.writeFileSync(KNOWLEDGE_FILE, req.body.content);
    fs.writeFileSync(NICHE_FILE, req.body.niche);
    res.send('<script>alert("تم تحديث عقل البوت بنجاح!"); window.location.href="/admin";</script>');
});

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of (entry.messaging || [])) {
                if (event.message && event.message.text) {
                    const ai = new EgbootSmartAI(getData(KNOWLEDGE_FILE), getData(NICHE_FILE));
                    const reply = ai.findResponse(event.message.text, event.sender.id);
                    
                    if (reply) {
                        try {
                            await axios.post('https://graph.facebook.com/v18.0/me/messages?access_token=' + process.env.PAGE_ACCESS_TOKEN, {
                                recipient: { id: event.sender.id },
                                message: { text: reply }
                            });
                        } catch (e) { console.error("FB API Error"); }
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

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
