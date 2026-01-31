// brain/catalog.js

export const catalog = {
  categories: {
    tshirt: {
      name: "تيشيرت",
      price: 299,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أسود", "أبيض", "كحلي", "رمادي", "زيتي"],
      material: "قطن 100% تقيل",
      fit: "قصة مريحة تناسب الاستخدام اليومي",
      notes: "مناسب للخروج والشغل اليومي"
    },

    hoodie: {
      name: "هودي",
      price: 599,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أسود", "رمادي", "كحلي"],
      material: "قطن مبطن من الداخل",
      fit: "دافئ ومريح للشتاء",
      notes: "مناسب للشتا والخروج"
    },

    shirt: {
      name: "قميص",
      price: 449,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أبيض", "أزرق", "أسود"],
      material: "قطن ناعم",
      fit: "قصة كلاسيك",
      notes: "مناسب للشغل والمناسبات"
    },

    pants: {
      name: "بنطلون",
      price: 499,
      sizes: ["M", "L", "XL", "2XL"],
      colors: ["أسود", "كحلي", "بيج"],
      material: "قطن مع نسبة ليكرا",
      fit: "مريح في الحركة",
      notes: "مناسب للخروج والشغل"
    }
  },

  shipping: {
    cairo_giza: "70 جنيه",
    other_governorates: "90 جنيه",
    note: "التوصيل خلال 2–4 أيام عمل"
  }
};
