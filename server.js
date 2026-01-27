require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

// الاتصال بـ MongoDB - مع تجاهل الأخطاء تماماً
mongoose.connect("mongodb://nouraminhero:nour2010@ac-u6m8v7y-shard-00-00.mongodb.net:27017,ac-u6m8v7y-shard-00-01.mongodb.net:27017,ac-u6m8v7y-shard-00-02.mongodb.net:27017/egboot?ssl=true&replicaSet=atlas-13o8p5-shard-0&authSource=admin", {
    serverSelectionTimeoutMS: 2000
}).then(() => console.log('✅ DB Connected'))
  .catch(err => console.log('⚠️ DB Connection ignored to keep server alive'));

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            if (entry.messaging) {
                for (let event of entry.messaging) {
                    if (event.message && event.message.text) {
                        try {
                            // نداء OpenAI بدون استخدام .trim() نهائياً
                            const response = await axios.post('https://api.openai.com/v1/chat/completions', {
                                model: "gpt-3.5-turbo",
                                messages: [{ role: "user", content: event.message.text }]
                            }, {
                                headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
                            });

                            const reply = response.data.choices[0].message.content;

                            // إرسال الرد لفيسبوك بدون .trim() نهائياً
                            await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
                                recipient: { id: event.sender.id },
                                message: { text: reply }
                            });
                        } catch (e) { 
                            console.log("❌ Error occurred: " + (e.response ? JSON.stringify(e.response.data) : e.message)); 
                        }
                    }
                }
            }
        }
        res.sendStatus(200);
    }
});

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
        res.send(req.query['hub.challenge']);
    } else { res.send('Wrong Token'); }
});

app.listen(process.env.PORT || 8080, () => console.log('🚀 SERVER IS RUNNING WITHOUT TRIM'));
