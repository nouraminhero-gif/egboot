import fs from 'fs';

const DB_PATH = './sales_logic.json';

// حفظ الموقف عشان الـ AI يذاكره
export function saveExperience(userId, input, output) {
    let data = [];
    if (fs.existsSync(DB_PATH)) {
        data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8') || "[]");
    }
    data.push({ time: new Date().toLocaleString('en-EG'), userId, input, output });
    // بيحفظ الخبرة محلياً في مشروعك
    fs.writeFileSync(DB_PATH, JSON.stringify(data.slice(-50), null, 2)); 
}

// جلب الخبرات السابقة عشان الـ AI يطور نفسه
export function getKnowledge() {
    if (!fs.existsSync(DB_PATH)) return "لا توجد خبرات سابقة بعد.";
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8') || "[]");
    return data.slice(-5).map(d => `الزبون: ${d.input} -> الرد الناجح: ${d.output}`).join('\n');
}
