import express from 'express';
import axios from 'axios';
import { askAI } from './ai.js';

const app = express();
app.use(express.json());

// الرد الفوري لإيقاف تكرار فيسبوك (أهم سطر لاستقرار السيرفر)
app.post('/webhook', async (req, res) => {
    res.status(200).send('EVENT_RECEIVED');

    const body = req.body;
    if (body.object === 'page') {
        const entry = body.entry[0];
        const messaging = entry.messaging[0];
        
        if (messaging && messaging.message && messaging.message.text) {
            const sender_psid = messaging.sender.id;
            const userMessage = messaging.message.text;

            try {
                // استدعاء ذكاء Gemini
                const aiResponse = await askAI(sender_psid, userMessage);
                
                await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
                    recipient: { id: sender_psid },
                    message: { text: aiResponse }
                });
            } catch (e) {
                console.error("خطأ في إرسال الرد:", e.message);
            }
        }
    }
});

app.get('/webhook', (req, res) => {
    const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "egboot_token_2026";
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Egboot Server is running on port ${PORT}`));
