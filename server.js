require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

// مفتاح الجمناي بتاعك اللي بعتهولي
const GEMINI_KEY = "AIzaSyD6uS6-538W1FpP26X57S0S20W66M48"; 
const PAGE_TOKEN = process.env.PAGE_ACCESS_TOKEN; 
const VERIFY_TOKEN = "egboot_2026"; 

// رابط الداتا بيز Egboot
const DB_URI = "mongodb://nouraminhero:nour2010@ac-u6m8v7y-shard-00-00.mongodb.net:27017,ac-u6m8v7y-shard-00-01.mongodb.net:27017,ac-u6m8v7y-shard-00-02.mongodb.net:27017/egboot?ssl=true&replicaSet=atlas-13o8p5-shard-0&authSource=admin";

mongoose.connect(DB_URI)
  .then(() => console.log('✅ DATABASE CONNECTED!'))
  .catch(err => console.log('❌ DB ERROR:', err.message));

app.get('/', (req, res) => res.send('Egboot Cloud Server is Active! 🚀'));

app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else {
    res.send('Verify Token Mismatch');
  }
});

app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object === 'page') {
    for (let entry of body.entry) {
      if (entry.messaging) {
        for (let event of entry.messaging) {
          if (event.message && event.message.text) {
            try {
              // طلب الرد من Gemini النسخة v1beta اللي بتحل مشكلة الـ API القديم
              const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
                { contents: [{ parts: [{ text: `أنت مساعد ذكي لمتجر Nour Fashion في مصر. رد بلهجة مصرية ودودة على: ${event.message.text}` }] }] }
              );

              const aiReply = response.data.candidates[0].content.parts[0].text;
              console.log("🤖 AI Reply:", aiReply);

              // إرسال الرد للعميل على ماسنجر
              await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_TOKEN}`, {
                recipient: { id: event.sender.id },
                message: { text: aiReply }
              });
            } catch (error) {
              console.error("⚠️ Error:", error.response?.data?.error?.message || error.message);
            }
          }
        }
      }
    }
    res.sendStatus(200);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server is LIVE on port ${PORT}`));
