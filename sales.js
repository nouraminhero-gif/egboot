// Catalog بسيط كبداية (المرحلة 1)
// بعد كده هنخليه dynamic من App العميل (SaaS)
export const CATALOG = {
  tshirt: {
    title: "تيشيرت",
    prices: [
      { name: "قطن", price: 250 },
      { name: "قطن تقيل", price: 320 }
    ],
    colors: ["أسود", "أبيض", "كحلي", "رمادي"],
    sizes: ["S", "M", "L", "XL", "XXL"]
  },
  hoodie: {
    title: "هودي",
    prices: [{ name: "شتوي تقيل", price: 550 }],
    colors: ["أسود", "كحلي", "رمادي"],
    sizes: ["M", "L", "XL", "XXL"]
  },
  pants: {
    title: "بنطلون",
    prices: [{ name: "جينز", price: 650 }],
    colors: ["أسود", "أزرق"],
    sizes: ["30", "32", "34", "36", "38"]
  }
};

export function detectIntent(userText) {
  const t = userText.toLowerCase();

  if (t.includes("تيشيرت") || t.includes("tshirt") || t.includes("t-shirt")) return "tshirt";
  if (t.includes("هودي") || t.includes("hoodie")) return "hoodie";
  if (t.includes("بنطلون") || t.includes("جينز") || t.includes("pants")) return "pants";

  if (t.includes("سعر") || t.includes("بكام") || t.includes("كام")) return "price";
  if (t.includes("مقاس") || t.includes("size")) return "size";
  if (t.includes("لون") || t.includes("color")) return "color";
  if (t.includes("شحن") || t.includes("توصيل")) return "shipping";
  if (t.includes("عنوان") || t.includes("العنوان")) return "address";
  if (t.includes("رقم") || t.includes("موبايل") || t.includes("تليفون")) return "phone";

  return "general";
}

export function buildSalesContext(userText) {
  const intent = detectIntent(userText);

  const common = `
أنت "Egboot" بياع مصري تقيل لمحل ملابس.
هدفك: تقفل بيع بأدب وبسرعة بدون رغي.
قواعد:
- رد مختصر 2-4 سطور.
- اسأل سؤال واحد واضح في آخر الرد علشان تحرك العميل للخطوة الجاية.
- لو العميل قال "السلام عليكم" رد ترحيب وخليه يختار منتج.
- ممنوع تتكلم في سياسة/طب/أي حاجة خارج الملابس، حوله للملابس بلُطف.
`;

  const shipping = `
الشحن:
- داخل القاهرة: 50 جنيه
- باقي المحافظات: 70 جنيه
الدفع: كاش عند الاستلام.
`;

  if (intent === "tshirt" || intent === "hoodie" || intent === "pants") {
    const item = CATALOG[intent];
    const prices = item.prices.map((p) => `- ${p.name}: ${p.price} جنيه`).join("\n");
    return `
${common}

المنتج المطلوب: ${item.title}
الأسعار:
${prices}
الألوان المتاحة: ${item.colors.join(" - ")}
المقاسات: ${item.sizes.join(" - ")}

${shipping}

اطلب من العميل المقاس واللون.
`;
  }

  if (intent === "price") {
    return `
${common}
عندنا:
- تيشيرت قطن: 250
- تيشيرت قطن تقيل: 320
- هودي شتوي: 550
- بنطلون جينز: 650
${shipping}
اسأل العميل: "تحب إيه فيهم + مقاسك؟"
`;
  }

  return `
${common}
${shipping}
ابدأ بتحديد احتياج العميل: (تيشيرت/هودي/بنطلون) + رجالي ولا حريمي + المقاس.
`;
}
