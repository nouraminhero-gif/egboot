// apps/worker/sales.js
// Sales bot (Messenger) with:
// ✅ Friendly seller persona (Egyptian Arabic + emojis)
// ✅ Simple product flow (tshirt/hoodie)
// ✅ Gemini fallback for "out of flow" questions
// ✅ Uses Redis session via ./session.js
// ✅ Compatible with queue.js calling: salesReply({ senderId, text, event, pageAccessToken })

import dotenv from "dotenv";
import axios from "axios";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { catalog } from "./brain/catalog.js";
import { FAQ } from "./brain/faq.js";
import { getSession, setSession, clearSession, createDefaultSession } from "./session.js";

dotenv.config();

// =====================
// Gemini Setup (Auto-pick model that actually works)
// =====================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL_ENV = process.env.GEMINI_MODEL || "";

let geminiModel = null;
let geminiReady = false;

// موديلات شائعة/حديثة — هنختار أول واحد يشتغل عندك
const GEMINI_CANDIDATES = [
  GEMINI_MODEL_ENV,
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
].filter(Boolean);

async function initGemini() {
  if (geminiReady) return;
  geminiReady = true;

  if (!GEMINI_API_KEY) {
    console.warn("⚠️ GEMINI_API_KEY missing. Gemini disabled.");
    return;
  }

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

    for (const name of GEMINI_CANDIDATES) {
      try {
        const m = genAI.getGenerativeModel({ model: name });
        // ping صغير للتأكد إن الاسم شغال
        await m.generateContent("ping");
        geminiModel = m;
        console.log(`🤖 Gemini ready: ${name}`);
        return;
      } catch (e) {
        console.warn(`⚠️ Gemini model failed (${name}):`, e?.message || e);
      }
    }

    console.warn("⚠️ No Gemini model worked. Gemini disabled.");
  } catch (e) {
    console.error("❌ Gemini init failed:", e?.message || e);
  }
}

// =====================
// Helpers
// =====================
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

function isCancel(text) {
  const s = normalize(text);
  return ["الغاء", "إلغاء", "cancel", "stop", "إيقاف"].includes(s);
}

function isYes(text) {
  const s = normalize(text);
  return ["تأكيد", "تاكيد", "confirm", "ok", "تمام", "موافق", "yes", "y"].includes(s);
}

function detectProduct(text) {
  const s = normalize(text);
  if (s.includes("تيشيرت") || s.includes("تشيرت") || s.includes("تي شيرت") || s.includes("tshirt") || s.includes("t-shirt")) return "tshirt";
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
  if (["xxl", "2xl", "اكس اكس ال", "2اكسل", "xx-large"].includes(s)) return "XXL";
  return null;
}

function detectColor(text) {
  const s = normalize(text);
  if (s.includes("اسود") || s.includes("black")) return "أسود";
  if (s.includes("ابيض") || s.includes("white")) return "أبيض";
  if (s.includes("رمادي") || s.includes("gray") || s.includes("grey")) return "رمادي";
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
  return "منتج";
}

function getProductInfo(key) {
  return catalog?.categories?.[key] || null;
}

function buildProductCard(productKey) {
  const prod = getProductInfo(productKey);
  if (!prod) return "مش لاقي المنتج ده عندي دلوقتي 😅";

  const price = prod.price;
  const sizes = (prod.sizes || []).join(" / ");
  const colors = (prod.colors || []).join(" / ");
  const shipping = catalog?.shipping || "الشحن حسب المحافظة";

  return (
    `تمام يا جميل 😄\n` +
    `📦 ${prettyProductName(productKey)}\n` +
    `💰 السعر: ${price} جنيه\n` +
    `📏 المقاسات المتاحة: ${sizes}\n` +
    `🎨 الألوان: ${colors}\n\n` +
    `🚚 ${shipping}\n\n` +
    `تحب تختار مقاس إيه؟\n` +
    `ولو مش متأكد قولي وزنك وطولك وأنا أرشّح لك 👌`
  );
}

function buildConfirmMessage(order) {
  return (
    `جميل جدًا 😍 خلينا نراجع بسرعة:\n` +
    `✅ المنتج: ${prettyProductName(order.product)}\n` +
    `✅ المقاس: ${order.size}\n` +
    `✅ اللون: ${order.color}\n\n` +
    `تحب نثبت الطلب كده؟\n` +
    `لو تمام قولّي "تأكيد" ✅\n` +
    `ولو عايز نعدّل ولا يهمك قولّي "إلغاء" 🙏`
  );
}

// FAQ quick answers
function faqAnswer(text) {
  const s = normalize(text);

  if (s.includes("شحن") || s.includes("سعر الشحن") || s.includes("shipping")) return `🚚 ${FAQ.shipping_price}`;
  if (s.includes("يوصل") || s.includes("توصيل") || s.includes("مده") || s.includes("مدة") || s.includes("delivery")) return `⏱️ ${FAQ.delivery_time}`;
  if (s.includes("دفع") || s.includes("payment") || s.includes("كاش")) return `💵 ${FAQ.payment}`;
  if (s.includes("استبدال") || s.includes("استرجاع") || s.includes("exchange") || s.includes("return")) return `🔁 ${FAQ.exchange}`;

  return null;
}

// =====================
// Messenger send helper
// =====================
async function sendTextMessage(psid, text, token) {
  if (!token || !psid) return;

  try {
    const res = await axios.post(
      "https://graph.facebook.com/v18.0/me/messages",
      {
        recipient: { id: psid },
        messaging_type: "RESPONSE",
        message: { text },
      },
      { params: { access_token: token } }
    );

    return res?.data;
  } catch (e) {
    console.error("❌ FB send failed:", e?.response?.data || e?.message || e);
  }
}

// =====================
// Gemini fallback (only when needed)
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
      return `${prettyProductName(k)}: السعر ${p.price} - مقاسات ${(p.sizes || []).join("/")} - ألوان ${(p.colors || []).join("/")}`;
    })
    .filter(Boolean)
    .join("\n");

  const system = `
أنت بائع محترم وذكي في متجر ملابس على فيسبوك ماسنجر.
أسلوبك: مصري لطيف + إيموجي بسيطة.
مهم: ماتفرضش على العميل أوامر. استخدم "تحب؟ ممكن؟ لو حابب؟"
لو العميل سأل سؤال مباشر (مقاس/شحن/خامة/سعر) جاوب فورًا وبوضوح.
لو السؤال خارج المتجر: اعتذر بلطف ورجّعه للاختيارات المتاحة.
ممنوع تخترع منتجات أو أسعار.

الكتالوج:
${priceInfo}

الشحن:
${shipping}

FAQ:
- الشحن: ${FAQ.shipping_price}
- التوصيل: ${FAQ.delivery_time}
- الدفع: ${FAQ.payment}
- الاستبدال: ${FAQ.exchange}

حالة الطلب الحالية:
product=${session?.order?.product || "none"}
size=${session?.order?.size || "none"}
color=${session?.order?.color || "none"}
phone=${session?.order?.phone || "none"}
address=${session?.order?.address || "none"}
step=${session?.step || "idle"}
`.trim();

  const history = (session.history || [])
    .slice(-8)
    .map((m) => `${m.role === "user" ? "عميل" : "بوت"}: ${m.text}`)
    .join("\n");

  const prompt = `${system}\n\nآخر المحادثة:\n${history}\n\nرسالة العميل: ${userText}\nردك:`;

  try {
    const res = await geminiModel.generateContent(prompt);
    const out = res?.response?.text?.() || "";
    return String(out).trim() || null;
  } catch (e) {
    console.error("⚠️ Gemini fallback error:", e?.message || e);
    return null;
  }
}

// =====================
// Main Export (queue.js compatible)
// =====================
export async function salesReply(payloadOrEvent, maybeToken) {
  // ✅ Support both call styles:
  // 1) salesReply({ senderId, text, event, pageAccessToken })
  // 2) salesReply(event, pageAccessToken)

  let senderId, text, pageAccessToken, event;

  if (payloadOrEvent?.senderId) {
    ({ senderId, text, pageAccessToken, event } = payloadOrEvent);
  } else {
    event = payloadOrEvent;
    pageAccessToken = maybeToken;
    senderId = event?.sender?.id;
    text = event?.message?.text;
  }

  // ignore echo/delivery/read
  if (event?.message?.is_echo) return;
  if (event?.delivery || event?.read) return;

  if (!senderId) return;

  const userText = String(text || "").trim();

  // لو مفيش نص
  if (!userText) {
    await sendTextMessage(senderId, "ابعتلي رسالة نصية وأنا تحت أمرك 😊", pageAccessToken);
    return;
  }

  // session
  let session = (await getSession(senderId)) || createDefaultSession();

  // ensure shape
  session.step = session.step || "idle";
  session.order = session.order || { product: null, size: null, color: null, phone: null, address: null };
  session.history = Array.isArray(session.history) ? session.history : [];

  // cancel anytime
  if (isCancel(userText)) {
    await clearSession(senderId);
    await sendTextMessage(senderId, "تمام يا صديقي ✅ لغيت الطلب. لو تحب نبدأ تاني قولّي: ابدأ 😊", pageAccessToken);
    return;
  }

  // save user msg
  session.history.push({ role: "user", text: userText });

  // FAQ anytime (direct answer)
  const faq = faqAnswer(userText);
  if (faq) {
    session.history.push({ role: "bot", text: faq });
    await setSession(senderId, session);
    await sendTextMessage(senderId, faq, pageAccessToken);
    return;
  }

  const sText = normalize(userText);

  // =====================
  // 0) Friendly greeting on first contact / idle
  // =====================
  const isFirstMessage = session.history.length <= 1 || session.step === "idle";

  if (isFirstMessage) {
    // لو العميل بدأ بسؤال مباشر (سعر/شحن/مقاس) سيبه يكمل عادي
    // لكن لو مجرد سلام/تحية نفتح بشكل لطيف
    if (sText.includes("السلام") || sText.includes("اهلا") || sText.includes("أهلا") || sText === "hi" || sText === "hello") {
      session.step = "choose_product";
      const msg =
        `أهلًا بيك 👋 نورتنا!\n` +
        `تحب تشوف إيه النهارده؟ 😊\n\n` +
        `1) تيشيرت\n` +
        `2) هودي\n\n` +
        `اكتب (تيشيرت/هودي) أو (1/2)`;
      session.history.push({ role: "bot", text: msg });
      await setSession(senderId, session);
      await sendTextMessage(senderId, msg, pageAccessToken);
      return;
    }

    // لو كتب "ابدأ" أو "start"
    if (sText.includes("ابدا") || sText.includes("start") || sText.includes("بدايه") || sText.includes("بداية")) {
      session.step = "choose_product";
      session.order = { product: null, size: null, color: null, phone: null, address: null };

      const msg =
        `تمام يا جميل 😄 خلينا نبدأ!\n` +
        `تحب تطلب إيه؟\n\n` +
        `1) تيشيرت\n` +
        `2) هودي\n\n` +
        `اكتب (تيشيرت/هودي) أو (1/2)`;
      session.history.push({ role: "bot", text: msg });
      await setSession(senderId, session);
      await sendTextMessage(senderId, msg, pageAccessToken);
      return;
    }

    // لو أول رسالة ومش سلام ومش ابدأ: نرد رد لطيف + نخليه يختار
    session.step = "choose_product";
    const msg =
      `أهلًا بيك 👋 تحت أمرك 😊\n` +
      `تحب تشوف التيشيرتات ولا الهوديز؟\n\n` +
      `1) تيشيرت\n` +
      `2) هودي\n\n` +
      `ولو عندك سؤال عن المقاسات/الشحن قولّي براحتك 👌`;
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
    const productKey = detectProduct(userText);

    if (!productKey || !getProductInfo(productKey)) {
      // هنا Gemini مهم جدًا: أسئلة خارج الفلو/استفسارات
      const ai = await geminiFallback({ session, userText });
      const msg =
        ai ||
        `تمام 😊 تحب تيشيرت ولا هودي؟\n` +
          `اكتب (تيشيرت/هودي) أو (1/2)`;
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

    // لو قال XXL ومش موجود في الكتالوج: نرد بأدب ونقترح
    const prod = getProductInfo(session.order.product);
    const availableSizes = (prod?.sizes || ["M", "L", "XL"]).map(String);

    if (size && !availableSizes.includes(size)) {
      const msg =
        `حاضر 😄 للأسف مقاس ${size} مش متاح حاليًا.\n` +
        `المتاح عندنا: ${availableSizes.join(" / ")} ✅\n` +
        `تحب تختار أنهي واحد؟ ولو تحب قولي وزنك وطولك وأنا أساعدك تختار 👌`;
      session.history.push({ role: "bot", text: msg });
      await setSession(senderId, session);
      await sendTextMessage(senderId, msg, pageAccessToken);
      return;
    }

    if (!size) {
      // Gemini يساعد لو العميل بيحكي وزن/طول أو محتار
      const ai = await geminiFallback({ session, userText });
      const msg =
        ai ||
        `براحتك 😊 تحب تختار مقاس إيه؟\n` +
          `المتاح: ${availableSizes.join(" / ")}\n` +
          `ولو مش متأكد قولي وزنك وطولك 👌`;
      session.history.push({ role: "bot", text: msg });
      await setSession(senderId, session);
      await sendTextMessage(senderId, msg, pageAccessToken);
      return;
    }

    session.order.size = size;
    session.step = "choose_color";

    const colors = (prod?.colors || ["أسود", "أبيض", "رمادي", "كحلي"]).join(" / ");
    const msg = `تمام يا قمر 😄 تحب اللون إيه؟ 🎨\nالمتاح: ${colors}`;
    session.history.push({ role: "bot", text: msg });
    await setSession(senderId, session);
    await sendTextMessage(senderId, msg, pageAccessToken);
    return;
  }

  // choose_color
  if (session.step === "choose_color") {
    const color = detectColor(userText);
    const prod = getProductInfo(session.order.product);
    const availableColors = (prod?.colors || ["أسود", "أبيض", "رمادي", "كحلي"]).map(String);

    if (color && !availableColors.includes(color)) {
      const msg =
        `حلو 😄 اللون ده مش متاح دلوقتي للأسف.\n` +
        `المتاح: ${availableColors.join(" / ")} 🎨\n` +
        `تحب أنهي واحد؟`;
      session.history.push({ role: "bot", text: msg });
      await setSession(senderId, session);
      await sendTextMessage(senderId, msg, pageAccessToken);
      return;
    }

    if (!color) {
      const ai = await geminiFallback({ session, userText });
      const msg = ai || `تحب تختار لون من دول؟ 🎨 ${availableColors.join(" / ")}`;
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
    if (isYes(userText)) {
      session.step = "get_phone";
      const msg = `تمام 😍 ابعتلي رقم الموبايل اللي نوصّل عليه 📱 (مثال: 01012345678)`;
      session.history.push({ role: "bot", text: msg });
      await setSession(senderId, session);
      await sendTextMessage(senderId, msg, pageAccessToken);
      return;
    }

    // لو قال أي حاجة غير التأكيد: Gemini يساعد
    const ai = await geminiFallback({ session, userText });
    const msg =
      ai ||
      `ولا يهمك 😊 تحب نثبت الطلب؟\n` +
        `لو تمام قولّي "تأكيد" ✅\n` +
        `ولو عايز نعدّل قولّي أنت عايز تغيّر إيه (مقاس/لون/منتج) 👌`;
    session.history.push({ role: "bot", text: msg });
    await setSession(senderId, session);
    await sendTextMessage(senderId, msg, pageAccessToken);
    return;
  }

  // get_phone
  if (session.step === "get_phone") {
    if (!looksLikePhone(userText)) {
      const ai = await geminiFallback({ session, userText });
      const msg = ai || `معلش الرقم مش واضح 😅 ابعته بالأرقام بس (زي: 01012345678)`;
      session.history.push({ role: "bot", text: msg });
      await setSession(senderId, session);
      await sendTextMessage(senderId, msg, pageAccessToken);
      return;
    }

    session.order.phone = userText.replace(/\s+/g, "");
    session.step = "get_address";

    const msg = `تمام ✅ ابعتلي العنوان بالتفصيل 🏠 (محافظة/مدينة/شارع/رقم عمارة)`;
    session.history.push({ role: "bot", text: msg });
    await setSession(senderId, session);
    await sendTextMessage(senderId, msg, pageAccessToken);
    return;
  }

  // get_address
  if (session.step === "get_address") {
    if (userText.length < 6) {
      const msg = `العنوان قصير شوية 😄 ابعته بتفصيل أكتر عشان التوصيل يبقى مظبوط 🏠`;
      session.history.push({ role: "bot", text: msg });
      await setSession(senderId, session);
      await sendTextMessage(senderId, msg, pageAccessToken);
      return;
    }

    session.order.address = userText;
    session.step = "done";

    const prod = getProductInfo(session.order.product);
    const msg =
      `تمام كده يا باشا 😍 طلبك اتسجّل ✅\n\n` +
      `📦 المنتج: ${prettyProductName(session.order.product)}\n` +
      `📏 المقاس: ${session.order.size}\n` +
      `🎨 اللون: ${session.order.color}\n` +
      `💰 السعر: ${prod?.price ?? "—"} جنيه\n` +
      `📱 الموبايل: ${session.order.phone}\n` +
      `🏠 العنوان: ${session.order.address}\n\n` +
      `🚚 ${catalog?.shipping || "الشحن حسب المحافظة"}\n\n` +
      `لو تحب أي حاجة تانية أنا موجود 😊`;
    session.history.push({ role: "bot", text: msg });
    await setSession(senderId, session);
    await sendTextMessage(senderId, msg, pageAccessToken);
    return;
  }

  // done or unknown state -> Gemini
  const ai = await geminiFallback({ session, userText });
  const msg = ai || `تمام يا صديقي 😊 تحب تيشيرت ولا هودي؟ (اكتب 1 أو 2)`;
  session.history.push({ role: "bot", text: msg });
  await setSession(senderId, session);
  await sendTextMessage(senderId, msg, pageAccessToken);
}
