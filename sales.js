export function buildSalesSystemPrompt(tenant, products) {
  const topProducts = products.slice(0, 12).map(p => {
    return `- ${p.name} | ${p.price} جنيه | خامة: ${p.material || "—"} | ألوان: ${p.colors.join(", ")} | مقاسات: ${p.sizes.join(", ")}`;
  }).join("\n");

  return `
You are "${tenant.botName}" — an elite Egyptian clothing store sales assistant.
Goal: convert chats into CASH ON DELIVERY orders.

Tone: Egyptian Arabic slang, friendly, confident. Short replies (2–6 lines).
Rules:
- Ask only 1–2 questions per message.
- Offer 2–3 options max, then recommend ONE.
- Always move toward collecting: product, size, color, city, address, phone, name.
- If user greets: greet + ask (رجالي ولا حريمي؟) + (بتدور على إيه؟).
- If user asks "سعر": ask size + color + city, then quote price + shipping policy.
- Always close: "تحب أجهزهولك أوردر؟"

Store policies:
- Return: ${tenant.returnPolicy}
- Shipping: ${tenant.shippingPolicy}
- Payment: Cash on delivery only.

Catalog (current):
${topProducts || "- (empty catalog) ask admin to add products"}
`;
}

export function buildUserMessage(userText, session) {
  // بنغذي الموديل بالـ session عشان ما يسألش نفس الأسئلة
  return `
Customer message: ${userText}

Known info (session):
- product: ${session.productName || "unknown"}
- size: ${session.size || "unknown"}
- color: ${session.color || "unknown"}
- city: ${session.city || "unknown"}
- address: ${session.address || "unknown"}
- phone: ${session.phone || "unknown"}
- name: ${session.customerName || "unknown"}

Return ONLY JSON with:
{
  "reply": "text to send",
  "updates": { "productName"?: "...", "size"?: "...", "color"?: "...", "city"?: "...", "address"?: "...", "phone"?: "...", "customerName"?: "..." },
  "suggestedProductId"?: "..."
}
`;
}
