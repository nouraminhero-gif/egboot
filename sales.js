// sales.js
import { buildSystemPrompt } from "./brain/prompt.js";
import { persona } from "./brain/persona.js";
import { catalog } from "./brain/catalog.js";
import { askAI } from "./ai.js";

// قواعد بسيطة كبداية (تتطور بعدين)
function detectIntent(text = "") {
  const t = text.toLowerCase();

  if (/(سعر|بكام|كام|ثمن|price)/i.test(text)) return "PRICE";
  if (/(مقاس|سایز|size|لارج|سمول|ميديوم|xl|xxl)/i.test(text)) return "SIZE";
  if (/(شحن|توصيل|delivery|مدة|وقت)/i.test(text)) return "DELIVERY";
  if (/(طلب|اطلب|اشتري|purchase|order)/i.test(text)) return "ORDER";
  if (/(متاح|متوفر|available|فيه)/i.test(text)) return "AVAILABILITY";

  return "GENERAL";
}

function buildDynamicContext({ intent, text }) {
  // هنا بنحط Context مختصر + كتالوج
  // (بعدها هنضيف memory لكل user في B)
  const topProducts = Array.isArray(catalog?.items) ? catalog.items.slice(0, 10) : [];

  return `
[BUSINESS_MODE: SALES_ASSISTANT]
[INTENT: ${intent}]
[USER_MESSAGE: ${text}]

[PERSONA]
${JSON.stringify(persona, null, 2)}

[CATALOG_SAMPLE]
${JSON.stringify(topProducts, null, 2)}

[RESPONSE_RULES]
- رد مختصر ومباشر.
- اسأل سؤال واحد واضح يقرب للشراء (مقاس/لون/ميزانية/عنوان).
- لو السؤال عن سعر: اذكر السعر (لو موجود) + خيارين بدائل.
- لو المنتج مش واضح: اطلب تحديد اسم المنتج أو صورة/كود.
- ممنوع وعود كاذبة (زي “متاح 100%”) بدون بيانات.
`;
}

export async function salesReply({ text, senderId, storeId = "default" }) {
  const intent = detectIntent(text);

  // System prompt من brain/prompt.js (انت عامل ده)
  const system = buildSystemPrompt({
    storeId,
    persona,
  });

  const context = buildDynamicContext({ intent, text });

  const userPrompt = `
${context}

اكتب رد كبياع محترف باللهجة المصرية.
خلي الرد 2-4 سطور.
في آخر الرد اسأل سؤال واحد بس يكمل عملية الشراء.
`;

  const aiText = await askAI({
    system,
    user: userPrompt,
    meta: { senderId, storeId, intent },
  });

  // Fall back لو الـ AI رجع فاضي
  if (!aiText || !aiText.trim()) {
    return "تمام ✅ قولي بس إنت تقصد أي منتج بالظبط؟ (اسم/كود) وعايز مقاس إيه؟";
  }

  return aiText.trim();
}
