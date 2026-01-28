require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs'); 
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const KNOWLEDGE_FILE = './egboot_knowledge.txt';

const getKnowledge = () => {
    try {
        if (fs.existsSync(KNOWLEDGE_FILE)) return fs.readFileSync(KNOWLEDGE_FILE, 'utf8');
    } catch (e) { return ""; }
    return "";
};

// --- [ محرك الردود الذكي جداً ] ---
function findSmartResponse(userMsg, knowledge) {
    const msg = userMsg.toLowerCase().trim();
    // تقسيم النص لسطور وتجاهل العناوين اللي بين أقواس مربعة []
    const lines = knowledge.split('\n').filter(line => line.trim().length > 5 && !line.startsWith('['));
    
    let greeting = "";
    // 1. رد السلام أولاً بشكل منفصل
    if (msg.includes("سلام") || msg.includes("عليكم") || msg.includes("أهلا") || msg.includes("هاى") || msg.includes("صباح") || msg.includes("مساء")) {
        greeting = "وعليكم السلام يا فندم، نورت Egboot لملابس الرجال! 👔\n";
    }

    let bestMatch = "";
    let highestScore = 0;

    // 2. البحث عن أدق إجابة (على قد السؤال)
    for (let line of lines) {
        let score = 0;
        const keywords = msg.split(' ');
        keywords.forEach(word => {
            if (word.length > 2 && line.toLowerCase().includes(word)) score += 10;
        });

        if (score > highestScore) {
            highestScore = score;
            bestMatch = line;
        }
    }

    // بناء الرد النهائي
    if (highestScore >= 10) {
        return greeting + bestMatch;
    } else if (greeting !== "") {
        return greeting + "أؤمرني يا فندم، محتاج تعرف إيه عن الأسعار أو المقاسات أو الشحن؟";
    }

    return "نورتنا في Egboot يا فندم! 👔 إحنا براند ملابس رجالي، محتاج تسأل عن الأسعار ولا المقاسات المتاحة؟";
}

// --- [ استقبال رسائل فيسبوك ] ---
app.post('/webhook', async (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        for (let entry of body.entry) {
            for (let event of (entry.messaging || [])) {
                if (event.message && event.message.text) {
                    const userMsg = event.message.text;
                    const knowledge = getKnowledge();
                    const reply = findSmartResponse(userMsg, knowledge);

                    try {
                        await axios.post('https://graph.facebook.com/v18.0/me/messages?access_token=' + process.env.PAGE_ACCESS_TOKEN, {
                            recipient: { id: event.sender.id },
                            message: { text: reply }
                        });
                    } catch (e) { console.error("FB Send Error"); }
                }
            }
        }
        res.sendStatus(200);
    }
});

app.get('/webhook', (req, res) => res.send(req.query['hub.challenge']));
app.listen(process.env.PORT || 8080);
