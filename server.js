require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs'); 
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const KNOWLEDGE_FILE = './egboot_knowledge.txt';

// دالة لجلب الشرح من السبورة
const getKnowledge = () => {
    try {
        if (fs.existsSync(KNOWLEDGE_FILE)) return fs.readFileSync(KNOWLEDGE_FILE, 'utf8');
    } catch (e) { return ""; }
    return "";
};

// --- [ محرك الذكاء الداخلي - البحث بالتشابه المنطقي ] ---
function findSmartResponse(userMsg, knowledge) {
    const msg = userMsg.toLowerCase().trim();
    const lines = knowledge.split('\n').filter(line => line.trim().length > 5);
    
    let bestMatch = null;
    let highestScore = 0;

    for (let line of lines) {
        let score = 0;
        const words = msg.split(' ');
        
        // بيحسب "درجة الذكاء" بناءً على توافق الكلمات ومعناها القريب
        words.forEach(word => {
            if (line.toLowerCase().includes(word)) score += 10; // كلمة مطابقة
            if (word.length > 3 && line.toLowerCase().includes(word.substring(0, 4))) score += 5; // جزء من كلمة
        });

        if (score > highestScore) {
            highestScore = score;
            bestMatch = line;
        }
    }

    // لو ملقاش تشابه عالي، بيحلل "نية" الزبون (Intent)
    if (highestScore < 10) {
        if (msg.includes("سعر") || msg.includes("كام") || msg.includes("بكم") || msg.includes("قيمة")) 
            return "بالنسبة للأسعار في Egboot، التيشيرت بـ 250 والقميص بـ 450 جنيه يا فندم. تحب أحجزلك حاجة؟";
        if (msg.includes("مقاس") || msg.includes("لبس") || msg.includes("مقاسي"))
            return "عندنا مقاسات من M لـ 3XL، لو قلتلي طولك ووزنك هعرف مقاسك فوراً.";
        return "أهلاً بك في Egboot! 👔 أنا مساعدك الذكي، تقدر تسألني عن الأسعار، المقاسات، أو أماكن الشحن وهرد عليك من خبرتي بالمحل.";
    }

    return bestMatch; // بيرجع السطر الأكثر ذكاءً وتوافقاً من "السبورة"
}

// --- [ لوحة الإدارة ] ---
app.get('/admin', (req, res) => {
    const currentData = getKnowledge();
    res.send(`
        <html dir="rtl"><body style="font-family:sans-serif; background:#f4f7f6; padding:20px;">
            <div style="max-width:800px; margin:auto; background:white; padding:25px; border-radius:15px; box-shadow:0 4px 15px rgba(0,0,0,0.1);">
                <h2 style="color:#007bff; text-align:center;">🧠 تطوير "عقل" Egboot الداخلي</h2>
                <p style="color:#666;">اكتب المعلومات في سطور واضحة. كل سطر بيمثل "معلومة" البوت هيفهمها ويستخدمها.</p>
                <form action="/admin/save" method="POST">
                    <textarea name="content" style="width:100%; height:400px; padding:15px; border-radius:10px; border:1px solid #ccc; font-size:16px;">${currentData}</textarea>
                    <button type="submit" style="width:100%; padding:15px; background:#28a745; color:white; border:none; border-radius:10px; cursor:pointer; font-weight:bold; margin-top:10px;">تحديث ذاكرة البوت</button>
                </form>
            </div>
        </body></html>
    `);
});

app.post('/admin/save', (req, res) => {
    fs.writeFileSync(KNOWLEDGE_FILE, req.body.content);
    res.send('<script>alert("تم تحديث الذكاء!"); window.location.href="/admin";</script>');
});

// --- [ استقبال رسائل فيسبوك ] ---
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
                    } catch (e) { console.error("FB API Error"); }
                }
            }
        }
        res.sendStatus(200);
    }
});

app.get('/webhook', (req, res) => res.send(req.query['hub.challenge']));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('🚀 Egboot Internal AI is Live!'));
