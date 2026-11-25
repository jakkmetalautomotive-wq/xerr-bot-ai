// QR พร้อมเพย์ใส่ยอดเงิน (มาตรฐาน EMVCo ของธนาคารแห่งประเทศไทย) → ลูกค้าสแกนด้วยแอปธนาคารไหนก็ได้ ยอดขึ้นเอง
// PROMPTPAY_ID ตั้งใน Vercel: เบอร์มือถือ 10 หลัก / เลขบัตรประชาชน หรือเลขนิติบุคคล 13 หลัก · ไม่ตั้ง = ไม่ส่ง QR
import { baseUrl } from "./images.ts";

const field = (id: string, value: string) => `${id}${String(value.length).padStart(2, "0")}${value}`;

// CRC16-CCITT (poly 0x1021, init 0xFFFF) ตามสเปก
export function crc16(s: string): string {
  let crc = 0xffff;
  for (const ch of Buffer.from(s, "utf8")) {
    crc ^= ch << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// เบอร์มือถือ → 0066 + ตัด 0 ข้างหน้า (13 หลัก) · 13 หลัก = เลขบัตร/นิติบุคคล
export function promptPayTarget(raw: string): { tag: "01" | "02"; value: string } | null {
  const id = raw.replace(/\D/g, "");
  if (/^0\d{9}$/.test(id)) return { tag: "01", value: `0066${id.slice(1)}` };
  if (/^\d{13}$/.test(id)) return { tag: "02", value: id };
  return null;
}

export function promptPayPayload(rawId: string, amount: number): string | null {
  const target = promptPayTarget(rawId);
  if (!target || !(amount > 0)) return null;
  const merchant = field("00", "A000000677010111") + field(target.tag, target.value);
  const body = [
    field("00", "01"),
    field("01", "12"), // 12 = ใช้ครั้งเดียว (มียอดเงิน)
    field("29", merchant),
    field("53", "764"), // บาท
    field("54", amount.toFixed(2)),
    field("58", "TH"),
  ].join("") + "6304";
  return body + crc16(body);
}

export const promptPayId = () => (process.env.PROMPTPAY_ID ?? "").trim();
export const promptPayEnabled = () => promptPayTarget(promptPayId()) !== null;

// รูป QR ของออเดอร์ (ลิงก์มีลายเซ็นออเดอร์ → ยอดแก้ไม่ได้)
export function promptPayImageMessage(orderToken: string) {
  const url = `${baseUrl()}/api/qr?o=${encodeURIComponent(orderToken)}`;
  return { type: "image", originalContentUrl: url, previewImageUrl: url };
}

// เลขบัญชีทุกบัญชีใน PAYMENT_INFO (เช่น "ธนาคารกรุงไทย : 054-0-20552-4") พร้อมชื่อธนาคารที่เขียนไว้หน้าเลข
export function bankAccounts(paymentInfo: string): { bank: string; number: string }[] {
  const out: { bank: string; number: string }[] = [];
  let from = 0;
  for (const m of paymentInfo.matchAll(/\d[\d -]{7,}\d/g)) {
    const number = m[0].trim();
    // ข้อความระหว่างเลขก่อนหน้ากับเลขนี้ → บรรทัดสุดท้ายที่มีตัวอักษร ตัดอีโมจิ/เครื่องหมายออก
    const last = paymentInfo.slice(from, m.index).split("\n")
      .map((l) => l.replace(/เลขที่บัญชี|เลขบัญชี|เลขที่/g, "").replace(/^[^\p{L}]+|[^\p{L}\p{M})]+$/gu, ""))
      .filter(Boolean)
      .at(-1) ?? "";
    const bank = (last.match(/ธนาคาร.*$/)?.[0] ?? (/ชื่อบัญชี/.test(last) ? "" : last)).slice(0, 60);
    from = m.index + m[0].length;
    if (!out.some((a) => a.number === number)) out.push({ bank, number });
  }
  return out.slice(0, 3);
}
