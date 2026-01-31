// apps/worker/clientProfile.js
import dotenv from "dotenv";
import Redis from "ioredis";

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL || "";
const redis = REDIS_URL
  ? new Redis(REDIS_URL, { enableReadyCheck: false, maxRetriesPerRequest: null })
  : null;

const CLIENT_PREFIX = "egboot:client:";

export function defaultClientProfile() {
  return {
    brand: "Nour Fashion",
    tone: { emoji: true, style: "friendly" },
    policies: {
      shipping: {
        cairo_giza: 70,
        other_governorates: 90,
        note: "الشحن بيتحسب حسب المحافظة",
      },
      payment: "الدفع عند الاستلام ✅",
      exchange: "استبدال خلال 7 أيام بشرط المنتج يكون بحالته.",
      delivery_time: "التوصيل خلال 2-4 أيام عمل.",
    },
    catalog: {
      categories: {
        tshirt: {
          name: "تيشيرت",
          price: 299,
          sizes: ["M", "L", "XL", "2XL"],
          colors: ["أسود", "أبيض", "كحلي", "رمادي", "بيج"],
          material: "قطن تقيل مريح",
        },
        hoodie: {
          name: "هودي",
          price: 599,
          sizes: ["L", "XL", "2XL"],
          colors: ["أسود", "رمادي", "كحلي", "زيتي", "بيج"],
          material: "خامة دفا وتقفيل ممتاز",
        },
        shirt: {
          name: "قميص",
          price: 449,
          sizes: ["M", "L", "XL", "2XL"],
          colors: ["أسود", "أبيض", "كحلي", "رمادي", "بيج"],
          material: "قماش عملي ومريح",
        },
        pants: {
          name: "بنطلون",
          price: 499,
          sizes: ["30", "32", "34", "36", "38"],
          colors: ["أسود", "كحلي", "رمادي", "بيج", "زيتي"],
          material: "خامة قوية ومريحة",
        },
      },
    },
  };
}

export async function getClientProfile(pageId) {
  if (!pageId || !redis) return defaultClientProfile();

  try {
    const raw = await redis.get(CLIENT_PREFIX + pageId);
    return raw ? JSON.parse(raw) : defaultClientProfile();
  } catch (e) {
    console.error("❌ getClientProfile error:", e?.message || e);
    return defaultClientProfile();
  }
}

// لو حبيت لاحقًا من الداشبورد تعمل set
export async function setClientProfile(pageId, profile) {
  if (!pageId || !redis) return;
  await redis.set(CLIENT_PREFIX + pageId, JSON.stringify(profile));
}
