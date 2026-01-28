import express from 'express';
import axios from 'axios';
import { askAI } from './ai.js';

const app = express();
app.use(express.json());

app.post('/webhook', async (req, res) => {
    const entry = req.body.entry;
    if (entry && entry[0].messaging) {
        const { sender, message } = entry[0].messaging[0];
        if (message && message.text) {
            const reply = await askAI(sender.id, message.text);
            await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
                recipient: { id: sender.id },
                message: { text: reply }
            }).catch(err => console.log("Error FB Send"));
        }
    }
    res.sendStatus(200);
});

app.listen(process.env.PORT || 8080);
