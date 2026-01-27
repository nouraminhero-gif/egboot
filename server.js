const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const PAGE_TOKEN = process.env.PAGE_ACCESS_TOKEN;

app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of (entry.messaging || [])) {
                if (event.message && event.message.text) {
                    const text = event.message.text.toLowerCase();
                    let reply = "أهلاً بك في Egboot! 🚀 أسألني عن السعر أو العنوان.";

                    // ردود ذكية مؤقتة للتجربة
                    if (text.includes("سعر")) reply = "أسعارنا بتبدأ من 200 جنيه يا فندم! 🔥";
                    if (text.includes("عنوان")) reply = "فرعنا في القاهرة، وسط البلد.";

                    try {
                        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_TOKEN}`, {
                            recipient: { id: event.sender.id },
                            message: { text: reply }
                        });
                        console.log("✅ الرد وصل للعميل");
                    } catch (e) { console.log("❌ خطأ في فيسبوك"); }
                }
            }
        }
        res.sendStatus(200);
    }
});

app.get('/webhook', (req, res) => {
    res.send(req.query['hub.challenge']);
});

app.listen(process.env.PORT || 8080, () => console.log('🚀 TEST BOT IS LIVE'));
