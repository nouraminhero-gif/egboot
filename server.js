require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

const DB_URI = "mongodb://nouraminhero:nour2010@ac-u6m8v7y-shard-00-00.mongodb.net:27017,ac-u6m8v7y-shard-00-01.mongodb.net:27017,ac-u6m8v7y-shard-00-02.mongodb.net:27017/egboot?ssl=true&replicaSet=atlas-13o8p5-shard-0&authSource=admin";

mongoose.connect(DB_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas'))
    .catch(err => console.log('❌ Database Error:', err.message));

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of entry.messaging) {
                if (event.message && event.message.text) {
                    try {
                        // الرابط ده تم تحديثه ليناسب النسخة الجديدة من Gemini
                        const geminiRes = await axios.post(
                            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${process.env.GEMINI_API_KEY.trim()}`,
                            { contents: [{ parts: [{ text: `رد بمصري: ${event.message.text}` }] }] }
                        );

                        const aiReply = geminiRes.data.candidates[0].content.parts[0].text;

                        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN.trim()}`, {
                            recipient: { id: event.sender.id },
                            message: { text: aiReply }
                        });
                    } catch (error) {
                        console.error("⚠️ Error Detail:", error.response?.data?.error?.message || error.message);
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

app.listen(process.env.PORT || 3000, () => console.log("🚀 Server is Ready"));
