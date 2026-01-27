require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// 1. تعريف المتغيرات مع حماية ضد الـ Undefined (عشان نخلص من خطأ الـ trim)
const OPENAI_KEY = (process.env.OPENAI_API_KEY || "").trim();
const PAGE_TOKEN = (process.env.PAGE_ACCESS_TOKEN || "").trim();
const VERIFY_TOKEN = (process.env.VERIFY_TOKEN || "egboot_2026").trim();

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            if (entry.messaging) {
                for (let event of entry.messaging) {
                    if (event.message && event.message.text) {
                        try {
                            // نداء OpenAI
                            const gptRes = await axios.post('https://api.openai.com/v1/chat/completions', {
                                model: "gpt-3.5-turbo",
                                messages: [{ role: "user", content: event.message.text }]
                            }, {
                                headers: { 'Authorization': `Bearer ${OPENAI_KEY}` }
                            });

                            const aiReply = gptRes.data.choices[0].message.content;

                            // رد الفيسبوك
                            await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_TOKEN}`, {
                                recipient: { id: event.sender.id },
                                message: { text: aiReply }
                            });
                        } catch (e) {
                            console.log("❌ Loop Error: " + (e.response ? JSON.stringify(e.response.data) : e.message));
                        }
                    }
                }
            }
        }
        res.sendStatus(200);
    }
});

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.send(req.query['hub.challenge']);
    } else { res.send('Wrong Token'); }
});

app.listen(process.env.PORT || 8080, () => console.log('🚀 BOT DEPLOYED SUCCESSFULLY WITHOUT ERRORS'));
