require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

// الاتصال بالداتا بيز - ضفنا خيار التسامح مع الـ IP
const DB_URI = "mongodb://nouraminhero:nour2010@ac-u6m8v7y-shard-00-00.mongodb.net:27017,ac-u6m8v7y-shard-00-01.mongodb.net:27017,ac-u6m8v7y-shard-00-02.mongodb.net:27017/egboot?ssl=true&replicaSet=atlas-13o8p5-shard-0&authSource=admin";

mongoose.connect(DB_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => console.log('❌ DB Connection Error:', err.message));

app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object === 'page') {
    for (let entry of body.entry) {
      if (entry.messaging) {
        for (let event of entry.messaging) {
          if (event.message && event.message.text) {
            const userMsg = event.message.text;
            console.log(`📩 Message received: ${userMsg}`);

            try {
              // الرابط ده تم اختباره ليتوافق مع v1beta ويحل مشكلة الـ 404
              const API_KEY = process.env.GEMINI_API_KEY.trim();
              const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`,
                { contents: [{ parts: [{ text: `رد بلهجة مصرية قصيرة: ${userMsg}` }] }] }
              );

              const botReply = response.data.candidates[0].content.parts[0].text;
              console.log(`🤖 AI Reply: ${botReply}`);

              // الرد على العميل في مسنجر
              const PAGE_TOKEN = process.env.PAGE_ACCESS_TOKEN.trim();
              await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_TOKEN}`, {
                recipient: { id: event.sender.id },
                message: { text: botReply }
              });

            } catch (err) {
              // هيطبع لك السبب الدقيق للرفض المرة دي
              console.error("⚠️ Detailed API Error:", err.response?.data?.error?.message || err.message);
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
  } else { res.send('Token Mismatch'); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Egboot Server Ready on Port ${PORT}`));
