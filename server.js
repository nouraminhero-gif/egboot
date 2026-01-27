require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const app = express();
app.use(express.json());

// 1. الاتصال بقاعدة بيانات Egboot
const DB_URI = "mongodb://nouraminhero:nour2010@ac-u6m8v7y-shard-00-00.mongodb.net:27017,ac-u6m8v7y-shard-00-02.mongodb.net:27017/egboot?ssl=true&replicaSet=atlas-13o8p5-shard-0&authSource=admin";
mongoose.connect(DB_URI).then(() => console.log('✅ Connected to Egboot Database'));

// 2. تعريف شكل الردود في الداتا بيز (عشان تقدر تطورها)
const ReplySchema = new mongoose.Schema({
    keyword: String, // الكلمة اللي العميل هيقولها (مثل: سعر، مقاس، شحن)
    response: String // الرد اللي البوت هيقوله
});
const Reply = mongoose.model('Reply', ReplySchema, 'replies');

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of (entry.messaging || [])) {
                if (event.message && event.message.text) {
                    const userText = event.message.text.toLowerCase();
                    const senderId = event.sender.id;

                    try {
                        // 3. البحث الذكي في قاعدة بياناتك
                        const match = await Reply.findOne({ keyword: { $regex: userText, $options: 'i' } });
                        
                        let finalReply = "";
                        if (match) {
                            finalReply = match.response; // الرد من تعبك ومجهودك في الداتا بيز
                        } else {
                            finalReply = "أهلاً بك في Egboot! 🚀 جاري تحويلك لأحد ممثلي خدمة العملاء للرد على استفسارك.";
                        }

                        // 4. إرسال الرد للفيسبوك
                        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
                            recipient: { id: senderId },
                            message: { text: finalReply }
                        });
                        console.log(`✅ Responded to "${userText}" from Database`);

                    } catch (err) { console.log("❌ Error:", err.message); }
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

app.listen(process.env.PORT || 8080, () => console.log('🚀 EGBOOT DATABASE-BOT IS READY'));
