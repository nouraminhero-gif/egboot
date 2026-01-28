import express from 'express';
import axios from 'axios';
import { askAI } from './ai.js';

const app = express();
app.use(express.json());

app.post('/webhook', async (req, res) => {
    const entry = req.body.entry;
    if (entry && entry[0].messaging) {
        const msgEvent = entry[0].messaging[0];
        const senderId = msgEvent.sender.id;

        if (msgEvent.message && msgEvent.message.text) {
            const userText = msgEvent.message.text;
            
            // تشغيل العقل البياع
            const aiReply = await askAI(senderId, userText);

            // إرسال الرد للعميل
            await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
                recipient: { id: senderId },
                message: { text: aiReply }
            }).catch(e => console.log("FB Error"));
        }
    }
    res.sendStatus(200);
});

app.listen(process.env.PORT || 8080, () => console.log("Egboot AI System Live!"));
