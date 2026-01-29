// sales.js
import { getSession, saveSession, clearSession } from "./session.js";
import { catalog } from "./brain/catalog.js";

// =============== Helpers ===============
const SHIPPING_PRICE = 50;

function norm(s = "") {
  return String(s).trim().toLowerCase();
}

function includesAny(text, arr) {
  return arr.some((w) => text.includes(w));
}

function pickProduct(text) {
  const t = norm(text);
  if (includesAny(t, ["تيشيرت", "tshirt", "t-shirt"])) return "tshirt";
  if (includesAny(t, ["هودي", "hoodie"])) return "hoodie";
  return null;
}

function pickSize(text) {
  const t = norm(text).replace(/\s+/g, "");
  if (t.includes("xl")) return "XL";
  if (t.includes("l")) return "L";
  if (t.includes("m")) return "M";
  return null;
}

function pickColor(text) {
  const t = norm(text);
  if (includesAny(t, ["اسود", "black"])) return "أسود";
  if (includesAny(t, ["ابيض", "white"])) return "أبيض";
  if (includesAny(t, ["كحلي", "navy"])) return "كحلي";
  if (includesAny(t, ["رمادي", "gray", "grey"])) return "رمادي";
  return null;
}

function isAskingShipping(text) {
  const t = norm(text);
  return includesAny(t, ["شحن", "سعر الشحن", "delivery", "shipping"]);
}

function isConfirm(text) {
  const t = norm(text);
  return includesAny(t, ["تأكيد", "confirm", "ok", "تمام"]);
}

function isRestart(text) {
  const t = norm(text);
  return includesAny(t, ["ابدأ", "start", "restart", "من الاول", "الغاء", "إلغاء"]);
}

// =============== Messenger Send ===============
async function sendTextMessage(psid, text, token) {
  if (!token || !psid) return;
  await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: psid }, message: { text } }),
  });
}

// =============== Main ===============
export async function salesReply(event, pageAccessToken) {
  const psid = event.sender?.id;
  const tenantId = event.recipient?.id || "default";
  if (!psid) return;

  const text = event.message?.text ? String(event.message.text) : "";
  const msg = norm(text);

  // Session
  let session = await getSession(tenantId, psid);

  // Global commands
  if (isRestart(msg)) {
    await clearSession(tenantId, psid);
    session = { step: "START" };
    await sendTextMessage(psid, "تمام ✅ نبدأ من الأول… تحب *تيشيرت* ولا *هودي*؟", pageAccessToken);
    return;
  }

  // ✅ Global shipping السؤال (أهم fix)
  // لو المستخدم سأل عن الشحن في أي وقت، نرد بسعر الشحن بدون ما نبوظ الستيب
  if (isAskingShipping(msg)) {
    await sendTextMessage(psid, `🚚 سعر الشحن: ${SHIPPING_PRICE} جنيه لكل المحافظات.\n\nلو تحب نكمّل، ابعت *تأكيد* ✅`, pageAccessToken);
    // نخلي الستيب زي ما هو، أو لو كان في مرحلة متقدمة نخليها FINAL_CONFIRM
    if (session.step && session.step !== "START") {
      session.step = "FINAL_CONFIRM";
      await saveSession(tenantId, psid, session);
    }
    return;
  }

  // Router by step
  switch (session.step || "START") {
    case "START":
    case "SELECT_PRODUCT": {
      const p = pickProduct(msg);
      if (!p) {
        await sendTextMessage(psid, "قولّي بس ✅ تحب *تيشيرت* ولا *هودي*؟", pageAccessToken);
        session.step = "SELECT_PRODUCT";
        await saveSession(tenantId, psid, session);
        return;
      }

      session.productKey = p;
      session.step = "SELECT_SIZE";

      const prod = catalog.categories[p];
      await saveSession(tenantId, psid, session);

      await sendTextMessage(
        psid,
        `تمام ✅ اختر المقاس: ${prod.sizes.join(" / ")}\nمثال: M`,
        pageAccessToken
      );
      return;
    }

    case "SELECT_SIZE": {
      const s = pickSize(msg);
      if (!s) {
        const prod = catalog.categories[session.productKey];
        await sendTextMessage(psid, `مقاس إيه بالظبط؟ ✅ ${prod.sizes.join(" / ")}`, pageAccessToken);
        return;
      }
      session.size = s;
      session.step = "SELECT_COLOR";
      await saveSession(tenantId, psid, session);

      const prod = catalog.categories[session.productKey];
      await sendTextMessage(psid, `تمام ✅ اللون؟ ${prod.colors.join(" / ")}`, pageAccessToken);
      return;
    }

    case "SELECT_COLOR": {
      const c = pickColor(msg);
      if (!c) {
        const prod = catalog.categories[session.productKey];
        await sendTextMessage(psid, `اختار لون ✅ ${prod.colors.join(" / ")}`, pageAccessToken);
        return;
      }
      session.color = c;
      session.step = "CONFIRM_ORDER";
      await saveSession(tenantId, psid, session);

      const prod = catalog.categories[session.productKey];
      const nameAr = session.productKey === "tshirt" ? "تيشيرت" : "هودي";

      await sendTextMessage(
        psid,
        `✅ تأكيد الطلب:\n- المنتج: ${nameAr}\n- السعر: ${prod.price} جنيه\n- المقاس: ${session.size}\n- اللون: ${session.color}\n\nاكتب *تأكيد* عشان نكمّل ✍️`,
        pageAccessToken
      );
      return;
    }

    case "CONFIRM_ORDER": {
      if (!isConfirm(msg)) {
        await sendTextMessage(psid, "اكتب *تأكيد* ✅ عشان نكمّل (أو اكتب *ابدأ* لو عايز من الأول)", pageAccessToken);
        return;
      }

      session.step = "ASK_PHONE";
      await saveSession(tenantId, psid, session);

      await sendTextMessage(psid, "تمام ✅ ابعت رقم الموبايل 📱", pageAccessToken);
      return;
    }

    case "ASK_PHONE": {
      // رقم بسيط (مش strict قوي)
      const phone = text.replace(/\D/g, "");
      if (phone.length < 10) {
        await sendTextMessage(psid, "ابعت رقم صحيح 📱 (مثال: 010xxxxxxxx)", pageAccessToken);
        return;
      }
      session.phone = phone;
      session.step = "ASK_ADDRESS";
      await saveSession(tenantId, psid, session);

      await sendTextMessage(psid, "تمام ✅ ابعت العنوان 🏠 (محافظة / مدينة / شارع)", pageAccessToken);
      return;
    }

    case "ASK_ADDRESS": {
      if (msg.length < 5) {
        await sendTextMessage(psid, "العنوان محتاج تفاصيل أكتر شوية 🏠", pageAccessToken);
        return;
      }
      session.address = text.trim();
      session.step = "FINAL_CONFIRM";
      await saveSession(tenantId, psid, session);

      const nameAr = session.productKey === "tshirt" ? "تيشيرت" : "هودي";
      const price = catalog.categories[session.productKey].price;
      const total = price + SHIPPING_PRICE;

      await sendTextMessage(
        psid,
        `✅ ملخص الطلب:\n- المنتج: ${nameAr}\n- المقاس: ${session.size}\n- اللون: ${session.color}\n- السعر: ${price}\n- الشحن: ${SHIPPING_PRICE}\n- الإجمالي: ${total}\n\nاكتب *تأكيد* لإرسال الطلب ✅`,
        pageAccessToken
      );
      return;
    }

    case "FINAL_CONFIRM": {
      if (!isConfirm(msg)) {
        await sendTextMessage(psid, "اكتب *تأكيد* ✅ لإرسال الطلب أو *ابدأ* لو عايز تعدّل", pageAccessToken);
        return;
      }

      // هنا مكان حفظ الأوردر في DB (Prisma) أو Google Sheet أو CRM
      await sendTextMessage(psid, "تم ✅ استلام طلبك! هنتواصل معاك لتأكيد الشحن 🚚", pageAccessToken);

      await clearSession(tenantId, psid);
      return;
    }

    default: {
      // Fallback ذكي: ما يبوظش الطلب
      session.step = session.step || "START";
      await saveSession(tenantId, psid, session);
      await sendTextMessage(psid, "ممكن توضح أكتر؟ 😊 (ولو تحب تبدأ من الأول اكتب *ابدأ*)", pageAccessToken);
      return;
    }
  }
}
