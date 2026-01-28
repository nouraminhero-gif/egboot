import express from 'express';
import axios from 'axios';
import { askAI } from './ai.js';

const app = express();
app.use(express.json());

app.post('/webhook', async (req, res) => {
    // 1. رد فوراً على فيسبوك عشان نوقف التكرار (أهم خطوة)
    res.status(200).send('EVENT_RECEIVED'); 

    const body = req.body;
    if (body.object === 'page') {
        for (const entry of body.entry) {
            const webhook_event = entry.messaging[0];
            if (webhook_event.message && webhook_event.message.text) {
                const sender_psid = webhook_event.sender.id;
                // 2. شغل الذكاء
                const aiReply = await askAI(sender_psid, webhook_event.message.text);
                // 3. ابعت الرد
                await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
                    recipient: { id: sender_psid },
                    message: { text: aiReply }
                }).catch(e => console.log("FB Error"));
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
