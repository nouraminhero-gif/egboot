import { persona } from "./persona.js";
import { catalog } from "./catalog.js";

export function buildPrompt(userText) {
  return `
أنت ${persona.name}
${persona.role}
أسلوبك: ${persona.style}

المنتجات:
${JSON.stringify(catalog, null, 2)}

رد على العميل ده:
"${userText}"

قواعد:
- ما تطولش
- اقفل بيع
- اسأل سؤال واحد بس في الآخر
`;
}
