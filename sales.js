// sales.js
import { buildSystemPrompt } from "./brain/prompt.js";
import { catalog } from "./brain/catalog.js";
import { aiReply } from "./ai.js"; // لازم ai.js يكون فيه export اسمه aiReply

// ================== Main entry ==================
export async function handleIncomingText({ text, senderId }) {
  const cleaned = (text || "").trim();
  if (!cleaned) {
    return {
      replyText: "ابعتلي رسالتك تاني 🙏",
      meta: { intent: "empty" },
    };
  }

  // 1) قواعد سريعة (من غير AI) عشان سرعة وفلوس أقل
  const quick = quickRules(cleaned);
  if (quick) return quick;

  // 2) رد بالـ AI (SaaS-ready)
  const systemPrompt = buildSystemPrompt();

  const userPrompt = `
رسالة العميل:
"${cleaned}"

مطلوب:
- رد مختصر وواضح باللهجة المصرية
- استخدم الكتالوج فقط
- لو العميل بيسأل عن سعر/مقاس/لون/شحن: جاوب من الكتالوج
- لو المنتج مش موجود: قول غير متوفر واقترح بديل من الموجود
- اختم بسؤال واحد يساعد تقفل الطلب (المقاس؟ اللون؟ المحافظة؟)

كتالوج (للتأكيد):
${JSON.stringify(catalog, null, 2)}
`;

  const replyText = await aiReply({
    system: systemPrompt,
    user: userPrompt,
    // تقدر تزود options هنا حسب ai.js
  });

  return {
    replyText: replyText || "تمام! تحب تقولّي مقاسك ولونك؟ 😊",
    meta: { intent: "ai" },
  };
}

// ================== Quick Rules (no AI) ==================
function quickRules(text) {
  const t = text.toLowerCase();

  // help / hi
  if (/(^|\s)(hi|hello|هاي|هلا|السلام|ازيك|أزيك)(\s|$)/.test(t)) {
    return {
      replyText:
        "أهلاً بيك 👋 تحب تيشيرت ولا هودي؟ وقولي مقاسك (M/L/XL).",
      meta: { intent: "greeting" },
    };
  }

  // shipping
  if (t.includes("شحن") || t.includes("توصيل") || t.includes("shipping")) {
    const shipping = catalog?.shipping || "الشحن متاح ✅";
    return {
      replyText: `🚚 ${shipping}\nقولي محافظتك والمقاس اللي عايزه؟`,
      meta: { intent: "shipping" },
    };
  }

  // show catalog
  if (t.includes("الكتالوج") || t.includes("المتاح") || t.includes("عندك ايه")) {
    const items = catalog?.categories || {};
    const lines = Object.keys(items).map((k) => {
      const p = items[k]?.price;
      const sizes = (items[k]?.sizes || []).join("/");
      const colors = (items[k]?.colors || []).join("، ");
      return `• ${k}: ${p} جنيه | مقاسات: ${sizes} | ألوان: ${colors}`;
    });

    return {
      replyText:
        `ده المتاح عندنا ✅\n\n${lines.join("\n")}\n\nتحب تختار أنهي واحد؟`,
      meta: { intent: "catalog" },
    };
  }

  return null;
}
