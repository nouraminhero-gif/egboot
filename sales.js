// sales.js
import { catalog } from "./brain/catalog.js";

// ================== Main Sales Reply ==================
export async function salesReply(text, senderId) {
  try {
    const msg = normalize(text);

    // ===== Greetings =====
    if (includesAny(msg, ["السلام", "اهلا", "هاي", "مرحبا"])) {
      return "أهلاً بيك 👋 تحب تشوف التيشيرتات ولا الهوديز؟";
    }

    // ===== T-SHIRT =====
    if (includesAny(msg, ["تيشيرت", "tshirt", "t-shirt"])) {
      return formatProduct("tshirt");
    }

    // ===== HOODIE =====
    if (includesAny(msg, ["هودي", "hoodie"])) {
      return formatProduct("hoodie");
    }

    // ===== PRICE =====
    if (includesAny(msg, ["سعر", "بكام", "كام"])) {
      return priceList();
    }

    // ===== SHIPPING =====
    if (includesAny(msg, ["شحن", "توصيل"])) {
      return catalog.shipping;
    }

    // ===== FALLBACK =====
    return "ممكن توضح أكتر؟ 😊\nتيشيرت 👕 | هودي 🧥 | أسعار 💰";

  } catch (err) {
    console.error("❌ salesReply error:", err.message);
    return "حصل خطأ بسيط 😅 جرب تاني بعد ثانية";
  }
}

// ================== Helpers ==================
function formatProduct(type) {
  const item = catalog.categories[type];
  if (!item) return "المنتج غير متوفر حاليًا ❌";

  return (
    `📦 ${type === "tshirt" ? "تيشيرت" : "هودي"}\n` +
    `💰 السعر: ${item.price} جنيه\n` +
    `📏 المقاسات: ${item.sizes.join(" / ")}\n` +
    `🎨 الألوان: ${item.colors.join(" / ")}\n\n` +
    `تحب تطلب؟ ابعت المقاس واللون 👌`
  );
}

function priceList() {
  return (
    `💰 الأسعار:\n` +
    `👕 تيشيرت: ${catalog.categories.tshirt.price} جنيه\n` +
    `🧥 هودي: ${catalog.categories.hoodie.price} جنيه\n\n` +
    `${catalog.shipping}`
  );
}

function normalize(text = "") {
  return text.toLowerCase().trim();
}

function includesAny(text, keywords = []) {
  return keywords.some((k) => text.includes(k));
}
