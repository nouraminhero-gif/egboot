// sales.js
import { catalog } from "./brain/catalog.js";

/**
 * الرد البيعي الأساسي (مرحلة A)
 * @param {string} text - رسالة العميل
 * @param {string} senderId - PSID
 */
export async function salesReply(text, senderId) {
  const msg = text.toLowerCase();

  // 👕 tshirt
  if (msg.includes("تيشيرت") || msg.includes("tshirt")) {
    const tshirt = catalog.categories.tshirt;
    return `
👕 تيشيرتاتنا المتاحة:
💰 السعر: ${tshirt.price} جنيه
📏 المقاسات: ${tshirt.sizes.join(" - ")}
🎨 الألوان: ${tshirt.colors.join(" - ")}
${catalog.shipping}
`;
  }

  // 🧥 hoodie
  if (msg.includes("هودي") || msg.includes("hoodie")) {
    const hoodie = catalog.categories.hoodie;
    return `
🧥 هوديز متاحة:
💰 السعر: ${hoodie.price} جنيه
📏 المقاسات: ${hoodie.sizes.join(" - ")}
🎨 الألوان: ${hoodie.colors.join(" - ")}
${catalog.shipping}
`;
  }

  // ❓ fallback
  return `
أهلاً بيك 👋  
احنا عندنا:
• تيشيرتات  
•
