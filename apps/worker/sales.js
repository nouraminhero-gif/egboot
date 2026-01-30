// apps/worker/sales.js
// Redis Sessions via ./session.js + Gemini fallback
// Compatible with:
// 1) salesReply(event, pageAccessToken)
// 2) salesReply({ senderId, text, event, pageAccessToken, postbackPayload })

import { GoogleGenerativeAI } from "@google/generative-ai";
import { catalog } from "./brain/catalog.js";
import { FAQ } from "./brain/faq.js";
import {
  getSession,
  setSession,
  clearSession,
  createDefaultSession,
} from "./session.js";

// =====================
// ENV
// =====================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL_ENV = process.env.GEMINI_MODEL || ""; // optional override

let geminiModel = null;
let geminiReady = false;

// هنجرّب أسماء موديلات شائعة (لو اسم معين مش شغال)
const GEMINI_CANDIDATES = [
  GEMINI_MODEL_ENV,
  "gemini-1.5-flash",
  "gemini-1.5-flash-latest",
  "gemini-1.5-flash-001",
  "gemini-1.5-pro",
  "gemini-1.5-pro-latest",
  "gemini-1.5-pro-001",
].filter(Boolean);

// init مرة واحدة
async function initGemini() {
  if (geminiReady) return;
  geminiReady = true;

  if (!GEMINI_API_KEY) {
    console.warn("⚠️ GEMINI_API_KEY is missing. AI fallback disabled.");
    return;
  }

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

    for (const name of GEMINI_CANDIDATES) {
      try {
        const model = genAI.getGenerativeModel({ model: name });

        // اختبار خفيف جدًا
        await model.generateContent("ping");
        geminiModel = model;

        console.log(`✅ Gemini model ready: ${name}`);
        return;
      } catch (e) {
        const msg = e?.message || String(e);
        console.warn(`⚠️ Gemini model failed (${name}): ${msg}`);
        continue;
      }
    }

    console.warn("⚠️ No Gemini model worked. Fallback disabled.");
  } catch (e) {
    console.warn("⚠️ Gemini init failed:", e?.message || e);
  }
}

// =====================
// Helpers
// =====================

// normalize: نشيل quotes والرموز عشان "ابدأ" وابدأ!!! وابدأ 😊 تبقى "ابدا"
function normalize(text = "") {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isArabicYes(t) {
  const s = normalize(t);
  return ["تاكيد", "confirm", "ok", "تمام", "موافق", "yes", "y"].includes(s);
}

function isArabicNo(t) {
  const s = normalize(t);
  return ["لا", "لأ", "no", "n", "مش", "مش عايز", "الغاء", "cancel"].includes(s);
}

function detectProduct(text) {
  const s = normalize(text);
  if (
    s.includes("تيشيرت") ||
    s.includes("تشيرت") ||
    s.includes("تي شيرت") ||
    s.includes("tshirt") ||
    s.includes("t-shirt")
  )
    return "tshirt";
  if (s.includes("هودي") || s.includes("هودى") || s.includes("hoodie")) return "hoodie";
  if (s === "1") return "tshirt";
  if (s === "2") return "hoodie";
  return null;
}

function detectSize(text) {
  const s = normalize(text).replace(/\s/g, "");
  if (["m", "medium", "ميديم", "مديم", "م"].includes(s)) return "M";
  if (["l", "large", "لارج", "ل"].includes(s)) return "L";
  if (["xl", "xlarge", "اكسل", "إكسل", "x-l"].includes(s)) return "XL";
  return null;
}

function detectColor(text) {
  const s = normalize(text);
  if (s.includes("اسود") || s.includes("black")) return "أسود";
  if (s.includes("ابيض") || s.includes("white")) return "أبيض";
  if (s.includes("كحلي") || s.includes("navy")) return "كحلي";
  return null;
}

function looksLikePhone(text) {
  const digits = String(text).replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

function prettyProductName(key) {
  if (key === "tshirt") return "تيشيرت";
  if (key === "hoodie") return "هودي";
  return key || "منتج";
}

function getProductInfo(productKey) {
  return catalog?.categories?.[productKey] || null;
}

function buildProductCard(productKey) {
  const prod = getProductInfo(productKey);
  if (!prod) return "مش لاقي المنتج ده في الكتالوج 😅";

  const price = prod.price;
  const sizes = (prod.sizes || []).join(" / ");
  const colors = (prod.colors || []).join(" / ");
  const shipping = catalog?.shipping || "الشحن حسب المحافظة";

  return (
    `📦 ${prettyProductName(productKey)}\n` +
    `💰 السعر: ${price} جنيه\n` +
    `📏 المقاسات: ${sizes}\n` +
    `🎨 الألوان: ${colors}\n\n` +
    `🚚 ${shipping}\n\n` +
    `اكتب المقاس اللي تحبه (M / L / XL) ✅`
  );
}

function buildConfirmMessage(order) {
  return (
    `✅ تأكيد الطلب:\n` +
    `- المنتج: ${prettyProductName(order.product)}\n` +
    `- المقاس: ${order.size}\n` +
    `- اللون: ${order.color}\n\n` +
    `اكتب "تأكيد" عشان نكمل ✍️\n` +
    `أو اكتب "إلغاء" لو عايز تعدّل.`
  );
}

function faqAnswer(text) {
  const s = normalize(text);

  if (s.includes("شحن") || s.includes("سعر الشحن") || s.includes("shipping"))
    return `🚚 ${FAQ.shipping_price}`;

  if (
    s.includes("يوصل") ||
    s.includes("توصيل") ||
    s.includes("مده") ||
    s.includes("مدة") ||
    s.includes("delivery")
  )
    return `⏱️ ${FAQ.delivery_time}`;

  if (s.includes("دفع") || s.includes("payment") || s.includes("كاش"))
    return `💵 ${FAQ.payment}`;

  if (
    s.includes("استبدال") ||
    s.includes("استرجاع") ||
    s.includes("exchange") ||
    s.includes("return")
  )
    return `🔁 ${FAQ.exchange}`;

  return null;
}

// =====================
// Gemini fallback
// =====================
async function geminiFallback({ session, userText }) {
  await initGemini();
  if (!geminiModel) return null;

  const allowed = Object.keys(catalog?.categories || {});
  const shipping = catalog?.shipping || "";

  const priceInfo = allowed
    .map((k) => {
      const p = getProductInfo(k);
      if (!p) return "";
      return `${prettyProductName(k)}: السعر ${p.price} - مقاسات ${(p.sizes || []).join(
        "/"
      )} - ألوان ${(p.colors || []).join("/")}`;
    })
    .filter(Boolean)
    .join("\n");

  const system = `
أنت مساعد مبيعات لمتجر ملابس على فيسبوك ماسنجر.
ردودك قصيرة وواضحة وبالعامية المصرية.
ممنوع تخترع أسعار/منتجات غير موجودة.
لو السؤال عن الشحن/التوصيل/الدفع/الاستبدال استخدم FAQ.
لو المستخدم في مرحلة طلب، ارشده للخطوة الجاية فقط.
لو السؤال خارج نطاق المتجر: اعتذر بلطف وارجعه للخيارات المتاحة.

الكتالوج:
${priceInfo}

سياسة الشحن:
${shipping}

FAQ:
- الشحن: ${FAQ.shipping_price}
- التوصيل: ${FAQ.delivery_time}
- الدفع: ${FAQ.payment}
- الاستبدال: ${FAQ.exchange}

حالة الطلب:
product=${session?.order?.product || "none"}
size=${session?.order?.size || "none"}
color=${session?.order?.color || "none"}
step=${session?.step || "idle"}
`.trim();

  const history = (session.history || [])
    .slice(-6)
    .map((m) => `${m.role === "user" ? "User" : "Bot"}: ${m.text}`)
    .join("\n");

  const prompt = `${system}\n\nالمحادثة السابقة:\n${history}\n\nUser: ${userText}\nBot:`;

  try {
    const res = await geminiModel.generateContent(prompt);
    const out = res?.response?.text?.() || "";
    return String(out).trim() || null;
  } catch (e) {
    console.error("Gemini fallback error:", e?.message || e);
    return null;
  }
}

// =====================
// Send message helper (FB)
// =====================
async function sendTextMessage(psid, text, token) {
  if (!psid || !token) return;

  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/me/messages?access_token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: psid },
          messaging_type: "RESPONSE",
          message: { text },
        }),
      }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("❌ FB send failed:", res.status, body);
    }
  } catch (err) {
    console.error("❌ sendTextMessage error:", err?.message || err);
  }
}

// =====================
// Main export
// =====================
export async function salesReply(arg1, arg2) {
  // ✅ Support both call styles
  // Style A: salesReply(event, token)
  // Style B: salesReply({ senderId, text, event, pageAccessToken, postbackPayload })
  let event = null;
  let pageAccessToken = null;
  let directText = "";
  let directSenderId = null;
  let postbackPayload = null;

  if (arg1 && typeof arg1 === "object" && (arg1.event || arg1.senderId || arg1.text)) {
    event = arg1.event || null;
    pageAccessToken = arg1.pageAccessToken || process.env.PAGE_ACCESS_TOKEN || null;
    directText = arg1.text || "";
    directSenderId = arg1.senderId || null;
    postbackPayload = arg1.postbackPayload || null;
  } else {
    event = arg1 || null;
    pageAccessToken = arg2 || process.env.PAGE_ACCESS_TOKEN || null;
  }

  // تجاهل echo/delivery/read
  if (event?.message?.is_echo) return;
  if (event?.delivery || event?.read) return;

  const senderId = directSenderId || event?.sender?.id;
  if (!senderId) return;

  const text = directText || event?.message?.text || "";
  const userText = String(text).trim();

  // لو مفيش نص (attachment مثلا) ومفيش postback
  if (!userText && !postbackPayload && !event?.postback?.payload) {
    await sendTextMessage(senderId, "ابعتلي رسالة نصية عشان أقدر أساعدك ✅", pageAccessToken);
    return;
  }

  const payload = postbackPayload || event?.postback?.payload || null;
  const sText = normalize(userText || payload || "");

  // session from Redis
  let session = (await getSession(senderId)) || createDefaultSession();

  // ensure shape
  session.step = session.step || "idle";
  session.order =
    session.order || { product: null, size: null, color: null, phone: null, address: null };
  session.history = Array.isArray(session.history) ? session.history : [];

  // save user msg (لو في postback بس، نسجله برضه)
  session.history.push({ role: "user", text: userText || `POSTBACK:${payload}` });

  // FAQ anytime
  const faq = userText ? faqAnswer(userText) : null;
  if (faq) {
    session.history.push({ role: "bot", text: faq });
    await setSession(senderId, session);
    await sendTextMessage(senderId, faq, pageAccessToken);
    return;
  }

  // سلام عليكم
  if (sText.includes("السلام") || sText.includes("سلام عليكم")) {
    const msg = `وعليكم السلام 😊 اكتب "ابدأ" عشان نبدأ الطلب ✅`;
    session.history.push({ role: "bot", text: msg });
    await setSession(senderId, session);
    await sendTextMessage(senderId, msg, pageAccessToken);
    return;
  }

  // Global commands
  if (sText.includes("ابدا") || sText.includes("start") || sText.includes("بدايه")) {
    session.step = "choose_product";
    session.order = { product: null, size: null, color: null, phone: null, address: null };

    const msg =
      `تمام ✅ تحب تطلب إيه؟\n\n` +
      `1) تيشيرت\n` +
      `2) هودي\n\n` +
      `اكتب: تيشيرت أو هودي (أو 1/2)`;

    session.history.push({ role: "bot", text: msg });
    await setSession(senderId, session);
    await sendTextMessage(senderId, msg, pageAccessToken);
    return;
  }

  if (["الغاء", "cancel"].includes(sText)) {
    await clearSession(senderId);
    const msg = `تم ✅ لغيت الطلب. لو تحب نبدأ من جديد اكتب "ابدأ"`;
    await sendTextMessage(senderId, msg, pageAccessToken);
    return;
  }

  // first time
  if (session.step === "idle") {
    session.step = "choose_product";

    const msg =
      `أهلاً بيك 👋\nتحب تطلب إيه؟\n\n` +
      `1) تيشيرت\n` +
      `2) هودي\n\n` +
      `اكتب: تيشيرت أو هودي (أو 1/2)`;

    session.history.push({ role: "bot", text: msg });
    await setSession(senderId, session);
    await sendTextMessage(senderId, msg, pageAccessToken);
    return;
  }

  // =====================
  // FLOW
  // =====================

  // choose_product
  if (session.step === "choose_product") {
    const productKey = detectProduct(userText || payload || "");

    if (!productKey || !getProductInfo(productKey)) {
      const ai = await geminiFallback({ session, userText: userText || String(payload || "") });
      const msg = ai || `تمام ✅ قولي بس: تيشيرت ولا هودي؟ (أو 1/2)`;

      session.history.push({ role: "bot", text: msg });
      await setSession(senderId, session);
      await sendTextMessage(senderId, msg, pageAccessToken);
      return;
    }

    session.order.product = productKey;
    session.step = "choose_size";

    const msg = buildProductCard(productKey);
    session.history.push({ role: "bot", text: msg });
    await setSession(senderId, session);
    await sendTextMessage(senderId, msg, pageAccessToken);
    return;
  }

  // choose_size
  if (session.step === "choose_size") {
    const size = detectSize(userText);

    if (!size) {
      const ai = await geminiFallback({ session, userText });
      const msg = ai || `اكتب المقاس كده: M أو L أو XL ✅`;

      session.history.push({ role: "bot", text: msg });
      await setSession(senderId, session);
      await sendTextMessage(senderId, msg, pageAccessToken);
      return;
    }

    session.order.size = size;
    session.step = "choose_color";

    const prod = getProductInfo(session.order.product);
    const colors = (prod?.colors || ["أسود", "أبيض", "كحلي"]).join(" / ");
    const msg = `تمام ✅ اللون إيه؟ (${colors}) 🎨`;

    session.history.push({ role: "bot", text: msg });
    await setSession(senderId, session);
    await sendTextMessage(senderId, msg, pageAccessToken);
    return;
  }

  // choose_color
  if (session.step === "choose_color") {
    const color = detectColor(userText);

    if (!color) {
      const ai = await geminiFallback({ session, userText });
      const msg = ai || `قولي اللون من دول: أسود / أبيض / كحلي 🎨`;

      session.history.push({ role: "bot", text: msg });
      await setSession(senderId, session);
      await sendTextMessage(senderId, msg, pageAccessToken);
      return;
    }

    session.order.color = color;
    session.step = "confirm";

    const msg = buildConfirmMessage(session.order);
    session.history.push({ role: "bot", text: msg });
    await setSession(senderId, session);
    await sendTextMessage(senderId, msg, pageAccessToken);
    return;
  }

  // confirm
  if (session.step === "confirm") {
    if (isArabicYes(userText)) {
      session.step = "get_phone";
      const msg = `تمام ✅ ابعت رقم الموبايل 📱`;

      session.history.push({ role: "bot", text: msg });
      await setSession(senderId, session);
      await sendTextMessage(senderId, msg, pageAccessToken);
      return;
    }

    if (isArabicNo(userText)) {
      session.step = "choose_product";
      session.order = { product: null, size: null, color: null, phone: null, address: null };

      const msg = `تمام ✅ نبدأ من الأول. تيشيرت ولا هودي؟ (أو 1/2)`;
      session.history.push({ role: "bot", text: msg });
      await setSession(senderId, session);
      await sendTextMessage(senderId, msg, pageAccessToken);
      return;
    }

    const ai = await geminiFallback({ session, userText });
    const msg = ai || `اكتب "تأكيد" عشان نكمل ✅ أو "إلغاء" لو عايز تعدّل`;

    session.history.push({ role: "bot", text: msg });
    await setSession(senderId, session);
    await sendTextMessage(senderId, msg, pageAccessToken);
    return;
  }

  // get_phone
  if (session.step === "get_phone") {
    if (!looksLikePhone(userText)) {
      const ai = await geminiFallback({ session, userText });
      const msg = ai || `رقم الموبايل مش واضح 😅 ابعته بالأرقام بس (مثال: 01012345678)`;

      session.history.push({ role: "bot", text: msg });
      await setSession(senderId, session);
      await sendTextMessage(senderId, msg, pageAccessToken);
      return;
    }

    session.order.phone = userText.replace(/\s+/g, "");
    session.step = "get_address";

    const msg = `تمام ✅ ابعت العنوان بالتفصيل 🏠 (محافظة/مدينة/شارع/رقم عمارة)`;
    session.history.push({ role: "bot", text: msg });
    await setSession(senderId, session);
    await sendTextMessage(senderId, msg, pageAccessToken);
    return;
  }

  // get_address
  if (session.step === "get_address") {
    if (userText.length < 6) {
      const msg = `العنوان قصير شوية 😅 ابعته بتفصيل أكتر 🏠`;

      session.history.push({ role: "bot", text: msg });
      await setSession(senderId, session);
      await sendTextMessage(senderId, msg, pageAccessToken);
      return;
    }

    session.order.address = userText;
    session.step = "done";

    const prod = getProductInfo(session.order.product);
    const msg =
      `✅ تم تأكيد طلبك 🎉\n\n` +
      `📦 المنتج: ${prettyProductName(session.order.product)}\n` +
      `📏 المقاس: ${session.order.size}\n` +
      `🎨 اللون: ${session.order.color}\n` +
      `💰 السعر: ${prod?.price ?? "—"} جنيه\n` +
      `📱 الموبايل: ${session.order.phone}\n` +
      `🏠 العنوان: ${session.order.address}\n\n` +
      `🚚 ${catalog?.shipping || "الشحن حسب المحافظة"}\n\n` +
      `لو تحب تعمل طلب جديد اكتب "ابدأ" ✅`;

    session.history.push({ role: "bot", text: msg });
    await setSession(senderId, session);
    await sendTextMessage(senderId, msg, pageAccessToken);
    return;
  }

  // done
  if (session.step === "done") {
    const ai = await geminiFallback({ session, userText });
    const msg = ai || `طلبك متسجل ✅ لو تحب طلب جديد اكتب "ابدأ"`;

    session.history.push({ role: "bot", text: msg });
    await setSession(senderId, session);
    await sendTextMessage(senderId, msg, pageAccessToken);
    return;
  }

  // final fallback
  const ai = await geminiFallback({ session, userText });
  const msg = ai || `مش فاهمك قوي 😅 اكتب "ابدأ" عشان نبدأ الطلب.`;

  session.history.push({ role: "bot", text: msg });
  await setSession(senderId, session);
  await sendTextMessage(senderId, msg, pageAccessToken);
}
