// ออเดอร์อยู่ขั้นไหน: รอสลิป → ได้สลิปแล้ว (รอแอดมินเช็คยอด) → แอดมินยืนยันรับเงินแล้ว
// ลูกค้าทำสลับลำดับได้ (ส่งสลิปก่อนกรอกที่อยู่) → ข้อความหลังกรอกที่อยู่ต้องไม่ขอสลิปซ้ำ
// และใบปะหน้าต้องออกให้แอดมินเมื่อครบทั้งที่อยู่ + ยืนยันสลิป ไม่ว่าอะไรมาก่อน
import { adminAddressText, adminOrderMessage, type Address, type PricedOrder } from "./order.ts";
import { addressCheckMessage, getLabel, labelReadyText, labelUrl, type LabelData } from "./label.ts";
import type { uploadedSlipMessage } from "./slip-upload.ts";
import type { StateStore } from "./state.ts";

export type OrderStage = "wait" | "slip" | "paid";

const STAGE_SECONDS = 30 * 24 * 60 * 60;
const paidKey = (code: string) => `paid:${code}`;
const slipKey = (code: string) => `slip:${code}`;

export const isPaid = async (state: StateStore, code: string) => (await state.get(paidKey(code)).catch(() => null)) !== null;
export const markPaid = (state: StateStore, code: string) => state.set(paidKey(code), "1", STAGE_SECONDS);
export const markSlip = (state: StateStore, code: string) => state.set(slipKey(code), "1", STAGE_SECONDS);
export const clearSlip = (state: StateStore, code: string) => state.set(slipKey(code), "", 1); // ยอดไม่ตรง → กลับไปรอสลิปใหม่

export async function orderStage(state: StateStore, code: string): Promise<OrderStage> {
  if (await isPaid(state, code)) return "paid";
  return (await state.get(slipKey(code)).catch(() => null)) ? "slip" : "wait";
}

// ตอบลูกค้าหลังกรอกที่อยู่ — ขอสลิปเฉพาะตอนที่ยังไม่ได้ส่งมา
export function addressReplyText(stage: OrderStage, code: string, total: string): string {
  if (stage === "slip") return `รับที่อยู่และสลิปแล้วครับ ✅ ออเดอร์ ${code}\nแอดมินกำลังเช็คยอดให้ครับ ไม่ต้องส่งสลิปซ้ำนะครับ 🙏`;
  const head = `รับที่อยู่จัดส่งแล้วครับ ✅ ออเดอร์ ${code}`;
  if (stage === "paid") return `${head}\nข้อมูลครบแล้ว จัดส่งรอบถัดไปครับ ขอบคุณที่อุดหนุนครับ 🙏`;
  return `${head}\nโอนยอด ${total}.- แล้วส่งสลิปในแชทนี้ได้เลยครับ 🙏`;
}

// ตอบลูกค้าหลังกรอกที่อยู่ + การ์ดใบปะหน้าให้เช็คความถูกต้อง
// การ์ดมีชื่อ/เบอร์/ที่อยู่ → ส่งเฉพาะเจ้าของ (ข้อความ "ส่งที่อยู่แล้ว" ใครพิมพ์เลียนแบบด้วยรหัสคนอื่นก็ได้)
export async function addressReplies(state: StateStore, code: string, total: string, userId: string, secret = "", ownsOrder = false) {
  const text = addressReplyText(await orderStage(state, code), code, total);
  const label = secret ? await getLabel(state, code).catch(() => null) : null;
  return label && (ownsOrder || label.user === userId) ? [text, addressCheckMessage(label, secret)] : [text];
}

// ลูกค้ากรอกแบบฟอร์มซ้ำด้วยข้อมูลผู้รับที่ต่างจากเดิม = แก้ที่อยู่
export const addressChanged = (before: LabelData | null, after: LabelData) =>
  before !== null && (["name", "phone", "address", "zip", "note"] as const).some((k) => before[k] !== after[k]);

// แจ้งแอดมินหลังลูกค้ากรอกที่อยู่ — ยืนยันเงินไปแล้ว → ไม่มีปุ่มซ้ำ ส่งใบปะหน้าให้เลย
export function addressAdminMessages(stage: OrderStage, o: PricedOrder, a: Address, customerName: string, userId: string, secret: string, edited = false, slipImage: ReturnType<typeof uploadedSlipMessage> | null = null) {
  const warn = edited ? [`✏️ ลูกค้าแก้ที่อยู่ออเดอร์ ${o.code} — ถ้าพิมพ์ใบปะหน้าเดิมไปแล้ว ให้ทิ้งแล้วใช้ใบใหม่นะครับ`] : [];
  // แนบสลิปในแบบฟอร์ม → รูปสลิป + การ์ดออเดอร์ (มีปุ่ม ✅/❌) มาพร้อมกัน
  const pic = slipImage ? [slipImage] : [];
  if (stage !== "paid") return [...warn, ...pic, adminOrderMessage(o, a, customerName, userId, stage === "slip")];
  return [...warn, ...pic, adminAddressText(o, a, customerName, userId), ...(secret ? [labelReadyText(o.code, a.name, labelUrl(o.code, secret))] : [])];
}

// ข้อความใบปะหน้าถึงแอดมิน (null = ลูกค้ายังไม่กรอกแบบฟอร์มที่อยู่)
export async function labelMessage(state: StateStore, code: string, secret = ""): Promise<string | null> {
  const label = secret ? await getLabel(state, code).catch(() => null) : null;
  return label ? labelReadyText(code, label.name, labelUrl(code, secret)) : null;
}

// แอดมินพิมพ์ขอใบปะหน้า เช่น "ใบปะหน้า XR-AB12" (สะกด ใบประหน้า ก็ได้) หรือพิมพ์แค่รหัสออเดอร์ → รหัสออเดอร์ที่ขอ · null = ไม่ใช่คำขอ
export function parseLabelRequest(text: string): string[] | null {
  const onlyCode = /^[\s(]*XR-[A-Z0-9]{2,12}[\s)]*$/i.test(text);
  if (!onlyCode && !/ใบ\s*ปร?ะ\s*หน้า/.test(text)) return null;
  return [...new Set((text.match(/XR-[A-Z0-9]{2,12}/gi) ?? []).map((c) => c.toUpperCase()))].slice(0, 10);
}
