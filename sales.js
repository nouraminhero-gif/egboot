// sales.js (Redis Sessions + Gemini fallback)
// يعتمد على:
// - ioredis (موجود عندك)
// - @google/generative-ai (موجود عندك)
// - brain/catalog.js  (export const catalog = {...})
// - brain/faq.js      (export const FAQ = {...})

import Redis from "ioredis";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { catalog } from "./brain/catalog.js";
import { FAQ } from "./brain/faq.js";

// =====================
// ENV
// =====================
const REDIS_URL = process.env.REDIS_URL;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// TTL للسيشن (مثلا 12 ساعة)
const SESSION_TTL_SECONDS = 60 * 60 * 12;

// =====================
// Redis Client (Singleton)
// =====================
if (!REDIS_URL) {
  console.warn("⚠️ REDIS_URL is missing. Sessions will NOT persist correctly.");
}

const redis = REDIS_URL
  ? new Redis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    })
  : null;

// =====================
// Gemini Client (Optional Fallback)
// =====================
let genAI = null;
let geminiModel = null;

if (GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  // NOTE: استخدم اسم الموديل بدون "models/"
  geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
} else {
  console.warn("⚠️ GEMINI_API_KEY is missing. AI fallback disabled.");
}

// =====================
// Helpers
// =====================
const SESSION_KEY = (senderId) => `sess:${senderId}`;

function normalize(text = "") {
  return String(text).trim().toLowerCase();
}

function isArabicYes(t) {
  const s = normalize(t);
  return ["تأكيد", "تاكيد", "confirm", "ok", "تمام", "موافق", "yes", "y"].includes(s);
}

function isArabicNo(t) {
  const s = normalize(t);
  return ["لا", "لأ", "no", "n", "مش", "مش عايز", "الغاء", "إلغاء"].includes(s);
}

function detectProduct(text) {
  const s = normalize(text);

  // كلمات مفتاحية بسيطة (زود براحتك)
  if (s.includes("تيشيرت") || s.includes("tshirt") || s.includes("t-shirt")) return "tshirt";
  if (s.includes("هودي") || s.includes("hoodie")) return "hoodie";

  // كمان ممكن المستخدم يكتب: "1" أو "2"
  if (s === "1") return "tshirt";
  if (s === "2") return "hoodie";

  return null;
}

function detectSize(text) {
  const s = normalize(text).replace(/\s/g, "");
  // يقبل: m / M / medium / ميديم
  if (["m", "medium", "ميديم", "م"].includes(s)) return "M";
  if (["l", "large", "لارج", "ل"].includes(s)) return "L";
  if (["xl", "xlarge", "اكسل", "إكسل", "x-l"].includes(s)) return "XL";
  return null;
}

function detectColor(text) {
  const s = normalize(text);

  if (s.includes("اسود") || s.includes("أسود") || s.includes("black")) return "أسود";
  if (s.includes("ابيض") || s.includes("أبيض") || s.includes("white")) return "أبيض";
  if (s.includes("كحلي") || s.includes("navy")) return "كحلي";

  return null;
}

function looksLikePhone(text) {
  const digits = String(text).replace(/\D/g, "");
  // مصر غالبًا 11 رقم، بس نخليها مرنة
  return digits.length >= 10 && digits.length <= 15;
}

function prettyProductName(key) {
  if (key === "tshirt") return "تيشيرت";
  if (key === "hoodie") return "هودي";
  return key || "منتج";
}

function getProductInfo(productKey) {
  const prod = catalog?.categories?.[productKey];
  return prod || null;
}

function buildProductCard(productKey) {
  const prod = getProductInfo(productKey);
  if (!prod) return "مش لاقي المنتج ده في الكتالوج 😅";

  const price = prod.price;
  const sizes = (prod.sizes || []).join(" / ");
  const colors = (prod.colors || []).join(" / ");
  const shipping = catalog?.shipping || "الشحن حسب المحافظة";

  return (
    `📦 *${prettyProductName(productKey)}*\n` +
    `💰 السعر: *${price}* جنيه\n` +
    `📏 المقاسات: *${sizes}*\n` +
    `🎨 الألوان: *${colors}*\n\n` +
    `🚚 ${shipping}\n\n` +
    `اكتب المقاس اللي تحبه (M / L / XL) ✅`
  );
}

function buildConfirmMessage(order) {
  return (
    `✅ *تأكيد الطلب:*\n` +
    `- المنتج: ${prettyProductName(order.product)}\n` +
    `- المقاس: ${order.size}\n` +
    `- اللون: ${order.color}\n\n` +
    `اكتب *"تأكيد"* عشان نكمل ✍️\n` +
    `أو اكتب *"إلغاء"* لو عايز تعدّل.`
  );
}

function faqAnswer(text) {
  const s = normalize(text);

  // بسيط: لو فيه كلمات تخص FAQ رجّع الرد
  if (s.includes("شحن") || s.includes("سعر الشحن") || s.includes("shipping"))
    return `🚚 ${FAQ.shipping_price}`;

  if (s.includes("يوصل") || s.includes("توصيل") || s.includes("مدة") || s.includes("delivery"))
    return `⏱️ ${FAQ.delivery_time}`;

  if (s.includes("دفع") || s.includes("payment") || s.includes("كاش"))
    return `💵 ${FAQ.payment}`;

  if (s.includes("استبدال") || s.includes("استرجاع") || s.includes("exchange") || s.includes("return"))
    return `🔁 ${FAQ.exchange}`;

  return null;
}

// =====================
// Redis Session get/set
// =====================
async function getSession(senderId) {
  // default session
  const defaultSession = {
    step: "idle", // idle | choose_product | choose_size | choose_color | confirm | get_name | get_phone | get_address | done
    order: {
      product: null,
      size: null,
      color: null,
      name: null,
      phone: null,
      address: null,
    },
    // اختياري: نحتفظ بآخر 6 رسائل عشان Gemini يفهم السياق
    history: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  if (!redis) return defaultSession;

  const raw = await redis.get(SESSION_KEY(senderId));
  if (!raw) return defaultSession;

  try {
    const parsed = JSON.parse(raw);
    return {
      ...defaultSession,
      ...parsed,
      order: { ...defaultSession.order, ...(parsed.order || {}) },
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return defaultSession;
  }
}

async function setSession(senderId, session) {
  const s = {
    ...session,
    updatedAt: Date.now(),
    history: Array.isArray(session.history) ? session.history.slice(-6) : [],
  };

  if (!redis) return;

  await redis.set(SESSION_KEY(senderId), JSON.stringify(s), "EX", SESSION_TTL_SECONDS);
}

async function clearSession(senderId) {
  if (!redis) return;
  await redis.del(SESSION_KEY(senderId));
}

// =====================
// Gemini fallback (لما السؤال يبقى برا الـ flow)
// =====================
async function geminiFallback({ session, userText }) {
  if (!geminiModel) return null;

  // نبني سياق بسيط + قواعد (ما يطلعش برا الدومين بتاع المتجر)
  const allowedProducts = Object.keys(catalog?.categories || {});
  const shipping = catalog?.shipping || "";
  const priceInfo = allowedProducts
    .map((k) => {
      const p = getProductInfo(k);
      return p ? `${prettyProductName(k)}: السعر ${p.price} - مقاسات ${p.sizes?.join("/")} - ألوان ${p.colors?.join("/")}` : "";
    })
    .filter(Boolean)
    .join("\n");

  const system = `
أنت مساعد مبيعات لمتجر ملابس على فيسبوك ماسنجر.
مهمتك: ترد بوضوح وباختصار وبالعامية المصرية.
ممنوع تخترع منتجات أو أسعار غير الموجودة.
لو السؤال عن الشحن/التوصيل/الدفع/الاستبدال استخدم FAQ.
لو المستخدم محتاج يكمل الطلب: ارشده للخطوة القادمة فقط.
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

حالة الطلب الحالية (لو موجودة):
product=${session?.order?.product || "none"}
size=${session?.order?.size || "none"}
color=${session?.order?.color || "none"}
step=${session?.step || "idle"}
`;

  const history = (session.history || [])
    .map((m) => `${m.role === "user" ? "User" : "Bot"}: ${m.text}`)
    .join("\n");

  const prompt = `${system}\n\nالمحادثة السابقة:\n${history}\n\nUser: ${userText}\nBot:`;

  try {
    const res = await geminiModel.generateContent(prompt);
    const out = res?.response?.text?.() || "";
    const cleaned = String(out).trim();
    return cleaned || null;
  } catch (e) {
    console.error("Gemini fallback error:", e?.message || e);
    return null;
  }
}

// =====================
// Main Export
// =====================
// IMPORTANT: لازم اسم الـ export يبقى salesReply عشان queue.js بيستورده كده
export async function salesReply({ senderId, text }) {
  const userText = String(text || "").trim();
  const sText = normalize(userText);

  let session = await getSession(senderId);

  // حفظ history
  session.history = session.history || [];
  session.history.push({ role: "user", text: userText });

  // 1) FAQ quick answers (في أي وقت)
  const faq = faqAnswer(userText);
  if (faq) {
    session.history.push({ role: "bot", text: faq });
    await setSession(senderId, session);
    return faq;
  }

  // 2) أوامر عامة
  if (["ابدأ", "start", "بدايه", "بداية"].includes(sText)) {
    session.step = "choose_product";
    session.order = { product: null, size: null, color: null, name: null, phone: null, address: null };
    const msg =
      `تمام ✅ تحب تطلب إيه؟\n\n` +
      `1) تيشيرت\n` +
      `2) هودي\n\n` +
      `اكتب: *تيشيرت* أو *هودي* (أو 1/2)`;
    session.history.push({ role: "bot", text: msg });
    await setSession(senderId, session);
    return msg;
  }

  if (["الغاء", "إلغاء", "cancel"].includes(sText)) {
    await clearSession(senderId);
    const msg = `تم ✅ لغيت الطلب. لو تحب نبدأ من جديد اكتب *ابدأ*`;
    return msg;
  }

  // 3) لو أول رسالة ومش داخل flow
  if (session.step === "idle") {
    session.step = "choose_product";
    const msg =
      `أهلاً بيك 👋\nتحب تطلب إيه؟\n\n` +
      `1) تيشيرت\n` +
      `2) هودي\n\n` +
      `اكتب: *تيشيرت* أو *هودي* (أو 1/2)`;
    session.history.push({ role: "bot", text: msg });
    await setSession(senderId, session);
    return msg;
  }

  // =====================
  // FLOW
  // =====================

  // STEP: choose_product
  if (session.step === "choose_product") {
    const productKey = detectProduct(userText);
    if (!productKey || !getProductInfo(productKey)) {
      // fallback AI (لو المستخدم سأل سؤال برا أو مش واضح)
      const ai = await geminiFallback({ session, userText });
      if (ai) {
        session.history.push({ role: "bot", text: ai });
        await setSession(senderId, session);
        return ai;
      }

      const msg = `تمام ✅ قولي بس: *تيشيرت* ولا *هودي*؟ (أو 1/2)`;
      session.history.push({ role: "bot", text: msg });
      await setSession(senderId, session);
      return msg;
    }

    session.order.product = productKey;
    session.step = "choose_size";

    const msg = buildProductCard(productKey);
    session.history.push({ role: "bot", text: msg });
    await setSession(senderId, session);
    return msg;
  }

  // STEP: choose_size
  if (session.step === "choose_size") {
    const size = detectSize(userText);

    if (!size) {
      // AI fallback
      const ai = await geminiFallback({ session, userText });
      if (ai) {
        session.history.push({ role: "bot", text: ai });
        await setSession(senderId, session);
        return ai;
      }

      const msg = `اكتب المقاس كده: *M* أو *L* أو *XL* ✅`;
      session.history.push({ role: "bot", text: msg });
      await setSession(senderId, session);
      return msg;
    }

    session.order.size = size;
    session.step = "choose_color";

    const prod = getProductInfo(session.order.product);
    const colors = prod?.colors?.join(" / ") || "أسود / أبيض / كحلي";
    const msg = `تمام ✅ اللون إيه؟ (${colors}) 🎨`;
    session.history.push({ role: "bot", text: msg });
    await setSession(senderId, session);
    return msg;
  }

  // STEP: choose_color
  if (session.step === "choose_color") {
    const color = detectColor(userText);

    if (!color) {
      // AI fallback
      const ai = await geminiFallback({ session, userText });
      if (ai) {
        session.history.push({ role: "bot", text: ai });
        await setSession(senderId, session);
        return ai;
      }

      const msg = `قولي اللون من دول: *أسود* / *أبيض* / *كحلي* 🎨`;
      session.history.push({ role: "bot", text: msg });
      await setSession(senderId, session);
      return msg;
    }

    session.order.color = color;
    session.step = "confirm";

    const msg = buildConfirmMessage(session.order);
    session.history.push({ role: "bot", text: msg });
    await setSession(senderId, session);
    return msg;
  }

  // STEP: confirm
  if (session.step === "confirm") {
    if (isArabicYes(userText)) {
      session.step = "get_name";
      const msg = `تمام ✅ ابعت *الاسم* بتاعك ✍️`;
      session.history.push({ role: "bot", text: msg });
      await setSession(senderId, session);
      return msg;
    }

    if (isArabicNo(userText)) {
      session.step = "choose_product";
      session.order = { product: null, size: null, color: null, name: null, phone: null, address: null };
      const msg = `تمام ✅ نبدأ من الأول. تحب *تيشيرت* ولا *هودي*؟ (أو 1/2)`;
      session.history.push({ role: "bot", text: msg });
      await setSession(senderId, session);
      return msg;
    }

    // AI fallback
    const ai = await geminiFallback({ session, userText });
    if (ai) {
      session.history.push({ role: "bot", text: ai });
      await setSession(senderId, session);
      return ai;
    }

    const msg = `اكتب *"تأكيد"* عشان نكمل ✅ أو *"إلغاء"* لو عايز تعدّل`;
    session.history.push({ role: "bot", text: msg });
    await setSession(senderId, session);
    return msg;
  }

  // STEP: get_name
  if (session.step === "get_name") {
    if (userText.length < 2) {
      const msg = `الاسم قصير شوية 😅 ابعته تاني لو سمحت ✍️`;
      session.history.push({ role: "bot", text: msg });
      await setSession(senderId, session);
      return msg;
    }

    session.order.name = userText;
    session.step = "get_phone";
    const msg = `تمام يا ${userText} ✅ ابعت *رقم الموبايل* 📱`;
    session.history.push({ role: "bot", text: msg });
    await setSession(senderId, session);
    return msg;
  }

  // STEP: get_phone
  if (session.step === "get_phone") {
    if (!looksLikePhone(userText)) {
      const ai = await geminiFallback({ session, userText });
      if (ai) {
        session.history.push({ role: "bot", text: ai });
        await setSession(senderId, session);
        return ai;
      }

      const msg = `رقم الموبايل مش واضح 😅 ابعته بالأرقام بس (مثال: 01xxxxxxxxx) 📱`;
      session.history.push({ role: "bot", text: msg });
      await setSession(senderId, session);
      return msg;
    }

    session.order.phone = userText.replace(/\s+/g, "");
    session.step = "get_address";
    const msg = `تمام ✅ ابعت *العنوان بالتفصيل* 🏠 (المحافظة/المدينة/الشارع/رقم العمارة)`;
    session.history.push({ role: "bot", text: msg });
    await setSession(senderId, session);
    return msg;
  }

  // STEP: get_address
  if (session.step === "get_address") {
    if (userText.length < 6) {
      const msg = `العنوان قصير شوية 😅 ابعته بتفصيل أكتر 🏠`;
      session.history.push({ role: "bot", text: msg });
      await setSession(senderId, session);
      return msg;
    }

    session.order.address = userText;
    session.step = "done";

    // هنا تقدر: تحفظ الأوردر في DB/Prisma أو تبعته لملف order.js
    // أنا هسيبه رسالة نجاح جاهزة
    const msg =
      `✅ *تم تأكيد طلبك بنجاح!* 🎉\n\n` +
      `📦 المنتج: ${prettyProductName(session.order.product)}\n` +
      `📏 المقاس: ${session.order.size}\n` +
      `🎨 اللون: ${session.order.color}\n` +
      `👤 الاسم: ${session.order.name}\n` +
      `📱 الموبايل: ${session.order.phone}\n` +
      `🏠 العنوان: ${session.order.address}\n\n` +
      `🚚 ${catalog?.shipping || "الشحن حسب المحافظة"}\n\n` +
      `لو تحب تعمل طلب جديد اكتب *ابدأ* ✅`;

    session.history.push({ role: "bot", text: msg });
    await setSession(senderId, session);
    return msg;
  }

  // STEP: done
  if (session.step === "done") {
    const ai = await geminiFallback({ session, userText });
    if (ai) {
      session.history.push({ role: "bot", text: ai });
      await setSession(senderId, session);
      return ai;
    }
    const msg = `طلبك متسجل ✅ لو تحب تعمل طلب جديد اكتب *ابدأ*`;
    session.history.push({ role: "bot", text: msg });
    await setSession(senderId, session);
    return msg;
  }

  // fallback عام
  const ai = await geminiFallback({ session, userText });
  if (ai) {
    session.history.push({ role: "bot", text: ai });
    await setSession(senderId, session);
    return ai;
  }

  const msg = `مش فاهمك قوي 😅 اكتب *ابدأ* عشان نبدأ الطلب.`;
  session.history.push({ role: "bot", text: msg });
  await setSession(senderId, session);
  return msg;
}
