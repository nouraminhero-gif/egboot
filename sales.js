// sales.js
import { catalog } from "./brain/catalog.js";
import { FAQ } from "./brain/faq.js";

/**
 * ✅ Session store (in-memory) — مناسب للتجربة
 * لو SaaS/Production قوي: هننقله Redis (عشان السيرفر لما يعمل restart ماينساش)
 */
const sessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min

function now() {
  return Date.now();
}

function getSession(userId) {
  const s = sessions.get(userId);
  if (!s) return null;
  if (s.expiresAt <= now()) {
    sessions.delete(userId);
    return null;
  }
  return s;
}

function setSession(userId, data) {
  sessions.set(userId, { ...data, expiresAt: now() + SESSION_TTL_MS });
}

function resetSession(userId) {
  sessions.delete(userId);
}

/** Utils */
function norm(txt = "") {
  return String(txt)
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function hasAny(text, arr) {
  return arr.some((w) => text.includes(w));
}

function isSizeToken(t) {
  const x = t.toUpperCase();
  return ["S", "M", "L", "XL", "XXL"].includes(x);
}

function extractSize(text) {
  const tokens = String(text).toUpperCase().split(/[\s,\/-]+/);
  const found = tokens.find((t) => isSizeToken(t));
  return found || null;
}

function extractColor(text) {
  const t = norm(text);
  if (t.includes("اسود") || t.includes("أسود")) return "أسود";
  if (t.includes("ابيض") || t.includes("أبيض")) return "أبيض";
  if (t.includes("كحلي")) return "كحلي";
  if (t.includes("رمادي") || t.includes("رمادى")) return "رمادي";
  return null;
}

function extractProduct(text) {
  const t = norm(text);
  // منتجاتك الحالية في الكتالوج: tshirt + hoodie
  if (hasAny(t, ["تيشيرت", "tshirt", "تي شيرت"])) return "tshirt";
  if (hasAny(t, ["هودي", "hoodie", "هودى"])) return "hoodie";
  return null;
}

function formatProductCard(productKey) {
  const p = catalog?.categories?.[productKey];
  if (!p) return null;

  const nameAr = productKey === "tshirt" ? "تيشيرت" : productKey === "hoodie" ? "هودي" : productKey;

  const sizes = Array.isArray(p.sizes) ? p.sizes.join(" / ") : "";
  const colors = Array.isArray(p.colors) ? p.colors.join(" / ") : "";

  return (
    `📦 ${nameAr}\n` +
    `💰 السعر: ${p.price} جنيه\n` +
    `📏 المقاسات: ${sizes}\n` +
    `🎨 الألوان: ${colors}\n\n` +
    `تحب تطلب؟ ابعت المقاس واللون 👌`
  );
}

function formatFAQ(key) {
  const v = FAQ?.[key];
  if (!v) return null;
  return `✅ ${v}`;
}

/**
 * ✅ الرد الرئيسي اللي queue.js بيناديه
 * @param {Object} args
 * @param {string} args.senderId
 * @param {string} args.text
 * @returns {string} reply
 */
export async function salesReply({ senderId, text }) {
  const raw = String(text || "");
  const t = norm(raw);

  // تنظيف sessions القديمة بشكل بسيط
  // (مش ضروري قوي بس يساعد)
  if (Math.random() < 0.01) {
    for (const [k, s] of sessions.entries()) {
      if (s.expiresAt <= now()) sessions.delete(k);
    }
  }

  // أوامر عامة
  if (hasAny(t, ["ابدأ من جديد", "ريست", "reset", "start over", "الغاء", "إلغاء"])) {
    resetSession(senderId);
    return "تمام ✅ رجّعنا من الأول. تحب **تيشيرت** ولا **هودي**؟";
  }

  // FAQ
  if (hasAny(t, ["سعر الشحن", "الشحن", "توصيل", "shipping"])) {
    return formatFAQ("shipping_price") || "سعر الشحن: 50 جنيه لكل المحافظات.";
  }
  if (hasAny(t, ["مدة التوصيل", "يوصل امتى", "يوصل في قد ايه", "delivery"])) {
    return formatFAQ("delivery_time") || "مدة التوصيل عادة من 2 لـ 4 أيام عمل حسب المحافظة.";
  }
  if (hasAny(t, ["الدفع", "payment", "كاش", "عند الاستلام"])) {
    return formatFAQ("payment") || "الدفع عند الاستلام متاح ✅";
  }
  if (hasAny(t, ["استبدال", "استرجاع", "exchange", "return"])) {
    return formatFAQ("exchange") || "الاستبدال خلال 14 يوم بشرط المنتج يكون بحالته ✅";
  }

  // “أسعار” أو “المنتجات”
  if (hasAny(t, ["اسعار", "الأسعار", "المنتجات", "catalog", "كتالوج"])) {
    const tshirt = formatProductCard("tshirt");
    const hoodie = formatProductCard("hoodie");
    return (
      `تمام ✅ دي المنتجات المتاحة:\n\n` +
      `${tshirt}\n\n` +
      `${hoodie}\n\n` +
      `قولّي عايز انهي واحد؟ (تيشيرت / هودي)`
    );
  }

  // Session flow
  const session = getSession(senderId) || {
    step: "choose_product", // choose_product -> choose_size -> choose_color -> confirm -> phone -> address -> done
    order: {
      product: null,
      size: null,
      color: null,
      phone: null,
      address: null,
    },
  };

  // لو المستخدم كتب منتج مباشرة
  const detectedProduct = extractProduct(raw);
  const detectedSize = extractSize(raw);
  const detectedColor = extractColor(raw);

  // Shortcut: لو كتب “تيشيرت” فقط
  if (session.step === "choose_product") {
    if (detectedProduct) {
      session.order.product = detectedProduct;
      session.step = "choose_size";
      setSession(senderId, session);
      const nameAr = detectedProduct === "tshirt" ? "تيشيرت" : "هودي";
      return `تمام ✅ اخترت ${nameAr}. ابعت المقاس (M / L / XL)`;
    }

    return "تمام ✅ بس قولّي تحب **تيشيرت** ولا **هودي**؟";
  }

  // اختيار المقاس
  if (session.step === "choose_size") {
    if (detectedSize) {
      session.order.size = detectedSize;
      session.step = "choose_color";
      setSession(senderId, session);
      return "تمام ✅ اللون إيه؟ (أسود / أبيض / كحلي)";
    }

    // لو كتب لون وهو لسه في المقاس
    if (detectedColor) {
      return "وصلت اللون ✅ بس محتاج المقاس الأول (M / L / XL).";
    }

    return "ممكن تبعت المقاس بشكل واضح؟ مثال: M أو L أو XL";
  }

  // اختيار اللون
  if (session.step === "choose_color") {
    if (detectedColor) {
      session.order.color = detectedColor;
      session.step = "confirm";
      setSession(senderId, session);

      const productAr = session.order.product === "tshirt" ? "تيشيرت" : "هودي";
      return (
        `✅ تأكيد الطلب:\n` +
        `- المنتج: ${productAr}\n` +
        `- المقاس: ${session.order.size}\n` +
        `- اللون: ${session.order.color}\n\n` +
        `اكتب "تأكيد" عشان نكمل ✍️`
      );
    }

    // لو كتب مقاس تاني وهو في اللون
    if (detectedSize) {
      session.order.size = detectedSize;
      setSession(senderId, session);
      return "تمام ✅ المقاس اتحدث. دلوقتي اللون؟ (أسود / أبيض / كحلي)";
    }

    return "قولّي اللون من دول: أسود / أبيض / كحلي";
  }

  // تأكيد
  if (session.step === "confirm") {
    if (hasAny(t, ["تأكيد", "تاكيد", "confirm", "ok", "تمام"])) {
      session.step = "phone";
      setSession(senderId, session);
      return "تمام ✅ ابعت رقم الموبايل 📱";
    }
    if (hasAny(t, ["تعديل", "غير", "change"])) {
      session.step = "choose_product";
      session.order.size = null;
      session.order.color = null;
      setSession(senderId, session);
      return "ولا يهمك ✅ تحب **تيشيرت** ولا **هودي**؟";
    }

    return 'اكتب "تأكيد" لإرسال الطلب ✅ أو "تعديل" لو عايز تغيّر حاجة.';
  }

  // الموبايل
  if (session.step === "phone") {
    // استخراج رقم بسيط
    const digits = raw.replace(/[^\d]/g, "");
    if (digits.length >= 10) {
      session.order.phone = digits;
      session.step = "address";
      setSession(senderId, session);
      return "تمام ✅ ابعت العنوان بالتفصيل 🏠";
    }
    return "ابعت رقم موبايل صحيح (مثال: 01xxxxxxxxx) 📱";
  }

  // العنوان
  if (session.step === "address") {
    if (raw.trim().length < 8) return "العنوان قصير شوية 😅 ابعت تفاصيل أكتر (محافظة/منطقة/شارع/رقم منزل).";

    session.order.address = raw.trim();
    session.step = "done";
    setSession(senderId, session);

    const productAr = session.order.product === "tshirt" ? "تيشيرت" : "هودي";
    const shipping = catalog?.shipping || "الشحن: 50 جنيه لكل المحافظات";

    // هنا المفروض في SaaS حقيقي: تسجّل الأوردر DB / Sheet / CRM
    // حاليا مجرد تأكيد
    return (
      `🎉 تم تأكيد الطلب بنجاح!\n\n` +
      `📦 المنتج: ${productAr}\n` +
      `📏 المقاس: ${session.order.size}\n` +
      `🎨 اللون: ${session.order.color}\n` +
      `📱 الموبايل: ${session.order.phone}\n` +
      `🏠 العنوان: ${session.order.address}\n\n` +
      `🚚 ${shipping}\n` +
      `لو عايز تعمل طلب جديد اكتب: "ابدأ من جديد"`
    );
  }

  // done
  if (session.step === "done") {
    return 'طلبك متسجل ✅ لو عايز طلب جديد اكتب: "ابدأ من جديد"';
  }

  // fallback
  return "مش فاهم قصدك قوي 😅 تحب **تيشيرت** ولا **هودي**؟";
}
