const PHONE_REGEX = /(\+?2?01[0-2,5]\d{8})/g;

export function extractOrderFields(text) {
  const phoneMatch = text.match(PHONE_REGEX)?.[0];

  // مقاس/لون/محافظة بشكل بسيط (نوسعها بعدين)
  const sizeMatch = text.match(/\b(XXL|XL|L|M|S|3XL|2XL)\b/i)?.[0];
  const colorMatch = text.match(/(أسود|ابيض|أبيض|كحلي|رمادي|بيج|أحمر|أزرق|أخضر)/)?.[0];

  return {
    phone: phoneMatch || null,
    size: sizeMatch ? sizeMatch.toUpperCase() : null,
    color: colorMatch || null
  };
}

export function buildOrderSheet({ tenant, session, product, shippingCost = null }) {
  const price = product?.price ?? null;
  const ship = shippingCost != null ? `${shippingCost} جنيه` : "حسب المحافظة";
  const total = price != null && shippingCost != null ? price + shippingCost : null;

  return [
    "🧾 Order Sheet",
    `المتجر: ${tenant.name}`,
    `العميل: ${session.customerName || "—"}`,
    `موبايل: ${session.phone || "—"}`,
    `المنتج: ${session.productName || product?.name || "—"}`,
    `المقاس: ${session.size || "—"}`,
    `اللون: ${session.color || "—"}`,
    `المحافظة/المدينة: ${session.city || "—"}`,
    `العنوان: ${session.address || "—"}`,
    `السعر: ${price != null ? price + " جنيه" : "—"}`,
    `الشحن: ${ship}`,
    `الإجمالي: ${total != null ? total + " جنيه" : "—"}`,
    `الدفع: ${tenant.cashOnly ? "كاش عند الاستلام" : "—"}`,
    `ملاحظات: —`
  ].join("\n");
}
