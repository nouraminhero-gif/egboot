// sales.js
import { aiFallbackAnswer } from "./ai.js";
import { catalog } from "./brain/catalog.js";

const sessions = new Map(); // SaaS حقيقي: خليه Redis/DB بعدين

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      step: "product", // product -> size -> color -> confirm -> phone -> address
      cart: {},
    });
  }
  return sessions.get(userId);
}

function normalize(t) {
  return (t || "").toString().trim().toLowerCase();
}

function isValidSize(t) {
  return ["m", "l", "xl"].includes(normalize(t));
}

function isValidColor(t) {
  const x = normalize(t);
  return ["اسود", "أبيض", "ابيض", "كحلي", "رمادي"].includes(x);
}

function isConfirm(t) {
  const x = normalize(t);
  return ["تأكيد", "تاكيد", "confirm"].map(normalize).includes(x);
}

function isOutOfFlow(text, session) {
  const t = normalize(text);

  if (session.step === "size" && !isValidSize(t)) return true;
  if (session.step === "color" && !isValidColor(t)) return true;
  if (session.step === "confirm" && !isConfirm(t)) return true;

  return false;
}

function stepPrompt(session) {
  if (session.step === "size") return "تمام ✅ ابعت المقاس: M / L / XL";
  if (session.step === "color") return "تمام ✅ ابعت اللون: أسود / أبيض / كحلي";
  if (session.step === "confirm") return "لو تحب نكمّل اكتب *تأكيد* ✅";
  return "قولّي تحب تيشيرت ولا هودي؟";
}

export async function salesReply({ senderId, text, send }) {
  const session = getSession(senderId);

  // ✅ لو السؤال برة الفلو → AI fallback
  if (isOutOfFlow(text, session)) {
    const sessionSummary = `العميل في خطوة: ${session.step}، الطلب الحالي: ${JSON.stringify(
      session.cart
    )}`;

    const ai = await aiFallbackAnswer({
      question: text,
      sessionSummary,
    });

    await send(ai.answer);
    // ✅ رجّعه لنفس الخطوة
    await send(stepPrompt(session));
    return;
  }

  // ✅ الفلو الأساسي (مختصر مثال)
  if (session.step === "product") {
    session.cart.product = text;
    session.step = "size";
    await send("تمام ✅ اختر المقاس: M / L / XL");
    return;
  }

  if (session.step === "size") {
    session.cart.size = normalize(text).toUpperCase();
    session.step = "color";
    await send("تمام ✅ اختر اللون: أسود / أبيض / كحلي");
    return;
  }

  if (session.step === "color") {
    session.cart.color = text;
    session.step = "confirm";
    await send(
      `✅ تأكيد الطلب:\n- المنتج: ${session.cart.product}\n- المقاس: ${session.cart.size}\n- اللون: ${session.cart.color}\nاكتب *تأكيد* عشان نكمّل`
    );
    return;
  }

  if (session.step === "confirm") {
    await send("تم ✅ استلمت التأكيد. ابعت رقم الموبايل 📱");
    session.step = "phone";
    return;
  }
}
