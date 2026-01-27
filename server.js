require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

// رابط اتصال مباشر وقوي عشان نتخطى مشاكل الـ IP والـ DNS
const DB_URI = "mongodb://nouraminhero:nour2010@ac-u6m8v7y-shard-00-00.mongodb.net:27017,ac-u6m8v7y-shard-00-01.mongodb.net:27017,ac-u6m8v7y-shard-00-02.mongodb.net:27017/egboot?ssl=true&replicaSet=atlas-13o8p5-shard-0&authSource=admin";

mongoose.connect(DB_URI)
  .then(() => console.log('✅ DATABASE CONNECTED SUCCESSFULLY!'))
  .catch(err => console.log('❌ DB CONNECTION ERROR:', err.message));

// صفحة تأكيد إن السيرفر شغال
app.get('/', (req, res) => res.send('Egboot Server is Live on Render! 🚀'));

// Webhook Verification for Facebook
app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else {
    res.send('Error, wrong validation token');
  }
});

// التعامل مع الرسائل والرد بالـ AI
app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object === 'page') {
    for (let entry of body.entry) {
      if (!entry.messaging) continue;
      for (let event of entry.messaging) {
        if (event.message && event.message.text) {
          try {
            // الرابط المحدث لـ Gemini 1.5 Flash عشان يحل خطأ الـ API Version
            const response = await axios.post(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
              { contents: [{ parts: [{ text: `أنت مساعد متجر Nour Fashion. رد بلهجة مصرية: ${event.message.text}` }] }] }
            );

            const aiReply = response.data.candidates[0].content.parts[0].text;
            console.log("🤖 AI Reply:", aiReply);

            // إرسال الرد للفيسبوك
            await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
              recipient: { id: event.sender.id },
              message: { text: aiReply }
            });
          } catch (err) {
            console.log("⚠️ AI Error Detail:", err.response?.data?.error?.message || err.message);
          }
        }
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 SERVER READY ON PORT ${PORT}`));