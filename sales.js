// sales.js
import { catalog } from "./brain/catalog.js";
import { FAQ } from "./brain/faq.js";
import { aiFallbackAnswer } from "./ai.js";

/**
 * session example:
 * {
 *   step: "product" | "size" | "color" | "confirm",
 *   product: null,
 *   size: null,
 *   color: null
 * }
 */

export async function salesReply(message, session) {
  const text = message.trim();

  // لو مفيش session نبدأ من الأول
  if (!session.step) {
    session.step = "product";
    return "تحب تطلب ايه؟ 👕 تيشيرت ولا 🧥 هودي؟";
  }

  /* ================= PRODUCT ================= */
  if (session.step === "product") {
    if (text.includes("تيشير")) {
      session.product = "tshirt";
    } else if (text.includes("هودي")) {
      session.product = "hoodie";
    } else {
      return await aiFallbackAnswer({
        question: text,
        sessionSummary: "العميل لسه بيختار المنتج",
      });
    }

    session.step = "size";
    return `تمام 👍  
المقاسات المتاحة: ${catalog.categories[session.product].sizes.join(" / ")}
ابعِت المقاس`;
  }

  /* ================= SIZE ================= */
  if (session.step === "size") {
    if (!catalog.categories[session.product].sizes.includes(text)) {
      return "المقاس ده مش متاح ❌ ابعت M أو L أو XL";
    }

    session.size = text;
    session.step = "color";
    return `حلو 👌  
الألوان المتاحة: ${catalog.categories[session.product].colors.join(" / ")}
تحب لون ايه؟`;
  }

  /* ================= COLOR ================= */
  if (session.step === "color") {
    if (!catalog.categories[session.product].colors.includes(text)) {
      return "اللون ده مش متاح ❌ اختار من المتاح";
    }

    session.color = text;
    session.step = "confirm";

    const price = catalog.categories[session.product].price;

    return `✅ تأكيد الطلب:
- المنتج: ${session.product === "tshirt" ? "تيشيرت" : "هودي"}
- المقاس: ${session.size}
- اللون: ${session.color}
- السعر: ${price} جنيه
- ${FAQ.shipping_price}

اكتب *تأكيد* عشان نكمل 📝`;
  }

  /* ================= CONFIRM ================= */
  if (session.step === "confirm") {
    if (text.includes("تأكيد")) {
      session.step = "done";
      return "🎉 تم تأكيد الطلب  
ابعت الاسم ورقم الموبايل والعنوان 📦";
    }

    return "لو حابب تعدل حاجة قول ✏️ أو اكتب *تأكيد*";
  }

  /* ================= FALLBACK ================= */
  return await aiFallbackAnswer({
    question: text,
    sessionSummary: `العميل اختار ${session.product}, مقاس ${session.size}, لون ${session.color}`,
  });
}
