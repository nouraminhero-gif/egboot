import express from 'express';
import axios from 'axios';
import { askAI } from './ai.js'; // ربط المحرك بالعقل البياع

const app = express();
app.use(express.json());

// مفتاح الصفحة الخاص بـ Egboot (تأكد من وضعه في Variables على Railway)
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// 1. استقبال الـ Webhook من فيسبوك
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        body.entry.forEach(async (entry) => {
            const webhook_event = entry.messaging[0];
            const sender_psid = webhook_event.sender.id;

            if (webhook_event.message && webhook_event.message.text) {
                const userText = webhook_event.message.text;

                // إرسال الرسالة للـ AI عشان يفكر ويرد بناءً على الخبرة المحلية
                const aiReply = await askAI(sender_psid, userText);

                // إرسال رد الـ AI للعميل على ماسنجر
                await callSendAPI(sender_psid, aiReply);
            }
        });

        // "التكة" المهمة: نرد بـ 200 فوراً عشان فيسبوك ميبعتش الرسالة تاني ويحصل تكرار
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// 2. التحقق من الـ Webhook (لأول مرة فقط)
app.get('/webhook', (req, res) => {
    const VERIFY_TOKEN = "egboot_token_2026"; // تأكد إن ده هو اللي في إعدادات فيسبوك
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    }
});

// 3. وظيفة إرسال الرسالة لفيسبوك
async function callSendAPI(sender_psid, responseText) {
    const request_body = {
        "recipient": { "id": sender_psid },
        "message": { "text": responseText }
    };

    try {
        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, request_body);
        console.log('Message sent correctly to:', sender_psid);
    } catch (err) {
        console.error("Unable to send message:" + err);
    }
}

// تشغيل السيرفر على بورت Railway
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Egboot Server is running on port ${PORT}`));
