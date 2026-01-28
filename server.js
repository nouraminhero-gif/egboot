import express from 'express';
import axios from 'axios';
import { askAI } from './ai.js';

const app = express();
app.use(express.json());

app.post('/webhook', async (req, res) => {
    // أهم سطر: بنرد على فيسبوك في أقل من ثانية عشان نوقف التكرار
    res.status(200).send('EVENT_RECEIVED'); 

    const body = req.body;
    if (body.object === 'page') {
        const entry = body.entry[0];
        const messaging = entry.messaging[0];
        
        if (messaging && messaging.message && messaging.message.text) {
            const sender_psid = messaging.sender.id;
            const userMessage = messaging.message.text;

            // بنشغل الذكاء في الخلفية
            try {
                const aiResponse = await askAI(sender_psid, userMessage);
                await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
                    recipient: { id: sender_psid },
                    message: { text: aiResponse }
                });
            } catch (e) {
                console.error("Error sending message");
            }
        }
    }
});

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === "egboot_token_2026") {
        res.status(200).send(req.query['hub.challenge']);
    }
});

app.listen(process.env.PORT || 8080);
