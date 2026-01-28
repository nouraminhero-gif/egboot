import fs from 'fs';

const LOGIC_DB = './sales_logic.json';

// وظيفة لحفظ كل حركة بيع عشان الذكاء يذاكرها
export function saveSaleExperience(userId, message, response) {
    let data = [];
    if (fs.existsSync(LOGIC_DB)) {
        data = JSON.parse(fs.readFileSync(LOGIC_DB, 'utf8') || "[]");
    }
    data.push({
        time: new Date().toLocaleString('en-EG'),
        customer: userId,
        input: message,
        output: response
    });
    // حفظ الداتا في ملفك على السيرفر مباشرة
    fs.writeFileSync(LOGIC_DB, JSON.stringify(data, null, 2));
}

// وظيفة لجلب "الخبرات السابقة" عشان الـ AI يطور نفسه
export function getPastExperiences() {
    if (!fs.existsSync(LOGIC_DB)) return "لا توجد خبرات سابقة.";
    const data = JSON.parse(fs.readFileSync(LOGIC_DB, 'utf8') || "[]");
    return data.slice(-10).map(d => `الزبون قال: ${d.input} -> الرد الناجح كان: ${d.output}`).join('\n');
}
