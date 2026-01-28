import fs from 'fs';

// دالة لحفظ "خبرة" جديدة بعد كل محادثة
export function updateExperience(userId, situation, result) {
    const dbPath = './sales_logic.json';
    let data = JSON.parse(fs.readFileSync(dbPath, 'utf8') || "[]");

    // إضافة الموقف الجديد للذاكرة
    data.push({
        timestamp: new Date(),
        userId: userId,
        situation: situation, // (مثلاً: العميل قال "احا غالي")
        result: result        // (الرد اللي جاب نتيجة)
    });

    // حفظ التحديث محلياً
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

// دالة لجلب "الدروس المستفادة" عشان الـ AI يذاكرها
export function getLessons() {
    const data = JSON.parse(fs.readFileSync('./sales_logic.json', 'utf8') || "[]");
    // بنرجع آخر 5 مواقف ناجحة عشان الـ AI يتعلم منهم
    return data.slice(-5).map(d => `موقف: ${d.situation} -> النتيجة: ${d.result}`).join('\n');
}
