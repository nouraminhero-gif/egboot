require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const app = express();
app.use(express.json());

const DB_URI = "mongodb://nouraminhero:nour2010@ac-u6m8v7y-shard-00-00.mongodb.net:27017,ac-u6m8v7y-shard-00-01.mongodb.net:27017,ac-u6m8v7y-shard-00-02.mongodb.net:27017/egboot?ssl=true&replicaSet=atlas-13o8p5-shard-0&authSource=admin";

mongoose.connect(DB_URI).then(() => console.log('✅ Connected')).catch(err => console.log('❌ Error:', err.message));

app.get('/webhook', (req, res) => {
  // هنا كلمة السر اللي فيسبوك هيتأكد منها
  if (req.query['hub.verify_token'] === 'egboot_2026') {
    res.send(req.query['hub.challenge']);
  } else {
    res.send('Wrong Token');
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
              const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                { contents: [{ parts: [{ text: `أنت مساعد متجر Nour Fashion. رد بمصري: ${event.message.text}` }] }] }
              );
              const aiReply = response.data.candidates[0].content.parts[0].text;
              await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
                recipient: { id: event.sender.id },
                message: { text: aiReply }
              });
            } catch (err) { console.log("Error:", err.message); }
          }
        }
      }
    }
    res.sendStatus(200);
  }
});

app.listen(process.env.PORT || 3000);
