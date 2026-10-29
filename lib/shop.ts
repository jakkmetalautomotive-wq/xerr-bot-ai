// ข้อมูลร้าน + ข้อความมาตรฐาน (ตามที่จักรตกลงไว้ — แก้ข้อความที่นี่ที่เดียว)

export const SHOP = {
  name: "XERR AUTOTEAM",
  persona: "แอดมินผู้ชายของร้าน XERR AUTOTEAM (ร้านกรอบป้ายทะเบียนรถ ขายตรงจากโรงงาน ส่งจากกรุงเทพ)",
  adminDays: [1, 2, 3, 4, 5, 6], // จันทร์–เสาร์
  adminOpen: 9 * 60,
  adminClose: 18 * 60,
  adminOpenText: "09:00",
};

// ค่าส่ง + ราคาป้ายภาษี (ตามใบประหน้า 2026 ที่จักรยืนยัน) — ใช้คิดยอดออเดอร์ด้วยโค้ด
export const SHIPPING = { default: 30, freeWithTaxCar: 0 };
export const TAX_CAR = { name: "กรอบป้ายภาษี พรบ. รถยนต์", price: 69 };

// ข้อ 3: ถามเรื่องที่ไม่มีใน FAQ → ข้อความนี้ + แจ้งแอดมิน
export const DEFAULT_REPLY = "ขอบคุณที่สอบถามครับ 🙏 เรื่องนี้ขอให้แอดมินตรวจสอบให้ก่อนนะครับ";

// ข้อความเมื่อระบบขัดข้อง (Sheet / Gemini ล่ม)
export const ERROR_REPLY = "ขออภัยครับ ระบบตอบอัตโนมัติขัดข้องชั่วคราว 🙏";

// ลูกค้าส่งรูป (มักเป็นสลิป / รูปของเสียหาย) → ให้แอดมินดู
export const IMAGE_REPLY = "ได้รับรูปแล้วครับ 🙏 แอดมินตรวจสอบให้นะครับ";

export function bangkokClock(date = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Bangkok", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  const day = ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[p.weekday];
  const minutes = Number(p.hour) * 60 + Number(p.minute);
  const thaiDay = ["", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"][day];
  return { day, minutes, label: `วัน${thaiDay} ${p.hour}:${p.minute} น.` };
}

// ต่อท้ายข้อความเมื่อส่งต่อแอดมิน: บอกลูกค้าว่าแอดมินจะตอบเมื่อไหร่
export function adminNotice(date = new Date()): string {
  const { day, minutes } = bangkokClock(date);
  const open = SHOP.adminDays.includes(day) && minutes >= SHOP.adminOpen && minutes < SHOP.adminClose;
  return open ? "เดี๋ยวแอดมินตอบกลับสักครู่ครับ" : `ตอนนี้นอกเวลาทำการ แอดมินจะตอบกลับช่วง ${SHOP.adminOpenText} น. ครับ`;
}
