require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const KNOWLEDGE_FILE = path.join(__dirname, 'egboot_knowledge.txt');
const sessions = {}; // ذاكرة "تطور الشخصية" لكل عميل

class EgbootSalesPerson {
    constructor(userId) {
        this.userId = userId;
        // حالة العميل: هل هو لسه بيسلم؟ هل حدد منتج؟ هل محتار في المقاس؟
        if (!sessions[userId]) {
            sessions[userId] = { 
                step: "GREETING", 
                product: "", 
                history: [],
                greeted: false 
            };
        }
        this.state = sessions[userId];
    }

    process(msg) {
        const text = msg.toLowerCase();
        const data = fs.readFileSync(KNOWLEDGE_FILE, 'utf8').split('\n').filter(l => l.length > 5);

        // 1. إدارة الشخصية: الترحيب الذكي
        if (/(سلام|اهلا|نورت|صباح|مساء)/.test(text) && !this.state.greeted) {
            this.state.greeted = true;
            this.state.step = "DISCOVERY";
            return "وعليكم السلام يا ذوق، نورت Egboot! 👔 أنا مساعدك الشخصي هنا، تحب نتفرج على أحدث موديلات التيشيرتات الصيفي ولا بتدور على قميص كاجوال شيك؟";
        }

        // 2. تطوير المحادثة: تحديد "هدف" العميل
        if (text.includes("قميص")) { this.state.product = "قميص"; this.state.step = "PRODUCT_DETAILS"; }
        else if (text.includes("تيشيرت")) { this.state.product = "تيشيرت"; this.state.step = "PRODUCT_DETAILS"; }

        // 3. ذكاء الرد بناءً على الشخصية والسياق
        let bestReply = "";
        let maxScore = -1;

        for (let line of data) {
            let score = 0;
            const lineLow = line.toLowerCase();

            // إذا حددنا منتج، البياع يركز عليه تماماً
            if (this.state.product && lineLow.includes(this.state.product)) score += 100;

            // حل مشكلة الأوزان "شخصية الخبير"
            const weightMatch = text.match(/\d+/);
            if (weightMatch && (text.includes("كيلو") || text.includes("وزن"))) {
                if (lineLow.includes(weightMatch[0])) score += 300; // مطابقة رقمية دقيقة
                this.state.step = "CLOSING";
            }

            // مطابقة النية (سعر، مقاس، شحن)
            if (/(سعر|بكام|جنيه)/.test(text) && lineLow.includes("جنيه")) score += 50;
            if (/(مقاس|البس)/.test(text) && lineLow.includes("مقاس")) score += 50;

            if (score > maxScore) { maxScore = score; bestReply = line; }
        }

        // 4. تطوير الحوار: إذا العميل سأل سؤال عام، البياع يوجهه
        if (maxScore < 20) {
            if (this.state.step === "DISCOVERY") return "موجود عندنا تشكيلة قمصان وتيشيرتات عالمية، قولي إيه اللي بيعجبك أكتر عشان أرشحلك موديل مناسب؟";
            return "نورتنا يا فندم! 👔 عشان أقدر أساعدك بالظبط، قولي بتدور على مقاس كام أو إيه الموديل اللي عجبك؟";
        }

        return bestReply;
    }
}

// --- [ مسارات النظام ] ---
app.post('/webhook', async (req, res) => {
    const { object, entry } = req.body;
    if (object === 'page') {
        for (let e of entry) {
            for (let m of (e.messaging || [])) {
                if (m.message && m.message.text) {
                    const seller = new EgbootSalesPerson(m.sender.id);
                    const response = seller.process(m.message.text);
                    if (response) {
                        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
                            recipient: { id: m.sender.id },
                            message: { text: response }
                        }).catch(e => console.log("Error"));
                    }
                }
            }
        }
        res.sendStatus(200);
    }
});

app.get('/admin', (req, res) => {
    const content = fs.readFileSync(KNOWLEDGE_FILE, 'utf8');
    res.send(`<html dir="rtl"><body style="font-family:sans-serif; background:#f0f2f5; padding:30px;">
        <div style="max-width:800px; margin:auto; background:white; padding:30px; border-radius:15px; box-shadow:0 10px 20px rgba(0,0,0,0.1);">
            <h2 style="text-align:center; color:#2c3e50;">🖋️ تدريب شخصية بياع Egboot</h2>
            <form action="/admin/save" method="POST">
                <textarea name="content" style="width:100%; height:400px; padding:15px; border-radius:10px; border:1px solid #ddd; font-size:16px;">${content}</textarea>
                <button type="submit" style="width:100%; padding:15px; background:#1abc9c; color:white; border:none; border-radius:10px; font-weight:bold; cursor:pointer; margin-top:15px;">تحديث الشخصية</button>
            </form>
        </div>
    </body></html>`);
});

app.post('/admin/save', express.urlencoded({extended:true}), (req, res) => {
    fs.writeFileSync(KNOWLEDGE_FILE, req.body.content);
    res.send('<script>alert("تم تحديث عقل البياع!"); window.location.href="/admin";</script>');
});

app.listen(process.env.PORT || 8080);
