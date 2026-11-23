// อ่าน postback ของปุ่มในการ์ดชวนเพิ่มป้ายภาษี (0 = ✅ เพิ่ม, 1 = ❌ ไม่เพิ่ม)
export const upsellChoice = (msg: any, i: 0 | 1): string => msg.contents.footer.contents[i].action.data;
// ข้อความ (string หรือ {type:"text", text, quickReply}) → ตัวหนังสือ · ข้อความแจ้งแอดมินมีปุ่ม 🤫/▶️ ติดมา
export const msgText = (m: any): string => (typeof m === "string" ? m : m?.text ?? "");
