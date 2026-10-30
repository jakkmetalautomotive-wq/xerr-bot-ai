// ข้อมูลร้าน + ข้อความมาตรฐาน (ตามที่จักรตกลงไว้ — แก้ข้อความที่นี่ที่เดียว)

export const SHOP = {
  name: "XERR AUTOTEAM",
  persona: "แอดมินผู้ชายของร้าน XERR AUTOTEAM (ร้านกรอบป้ายทะเบียนรถ ขายตรงจากโรงงาน ส่งจากกรุงเทพ)",
  adminDays: [1, 2, 3, 4, 5, 6], // จันทร์–เสาร์
  adminOpen: 9 * 60,
  adminClose: 18 * 60,
};

// ค่าส่ง + ราคาป้ายภาษี (ตามใบประหน้า 2026 ที่จักรยืนยัน) — ใช้คิดยอดออเดอร์ด้วยโค้ด
export const SHIPPING = { default: 30, freeWithTaxCar: 0, taxOnly: 15 };
export const TAX_CAR = { name: "กรอบป้ายภาษี พรบ. รถยนต์", price: 69 };

// ข้อ 3: ถามเรื่องที่ไม่มีใน FAQ → ข้อความนี้ + แจ้งแอดมิน
export const DEFAULT_REPLY = "ขอบคุณที่สอบถามครับ 🙏 เรื่องนี้ขอให้แอดมินตรวจสอบให้ก่อนนะครับ";

// ข้อความเมื่อระบบขัดข้อง (Sheet / Gemini ล่ม)
export const ERROR_REPLY = "ขออภัยครับ ตอนนี้ระบบตอบคำถามอัตโนมัติขัดข้องชั่วคราว 🙏 ดูราคา สั่งซื้อ วิธีติดตั้ง หรือรีวิว กดปุ่มด้านล่างได้เลยครับ";

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
  // นอกเวลา: ไม่บอกเวลาเปิด (จักรขอ 30 ต.ค. 2026) — ชวนทิ้งข้อความ แอดมินรีบตอบให้เร็วที่สุด
  return open ? "เดี๋ยวแอดมินตอบกลับสักครู่ครับ" : "ทิ้งข้อความไว้ได้เลยครับ แอดมินจะรีบติดต่อกลับให้เร็วที่สุด 🙏";
}

// ปุ่ม Rich Menu → ข้อความที่ลูกค้าส่งเข้ามา (บอทจับคำเหล่านี้ตอบด้วยโค้ด ไม่ต้องรอ AI)
export const MENU = {
  order: "🛒 สั่งซื้อ",
  price: "💰 ราคา",
  install: "🔧 วิธีติดตั้ง",
  review: "⭐ รีวิวสินค้า",
  admin: "💬 คุยกับแอดมิน",
  promo: "🎉 โปรโมชั่น",
  design: "🎨 ออกแบบสินค้า",
};

// ปุ่ม 🎉 โปรโมชั่น — ข้อมูลจากแท็บ "ค่าส่ง โปร ชำระเงิน" ใน Google Sheet (30 ต.ค. 2026)
// เขียนเป็น template ก้อนเดียว: ถ้าใช้ [...].join("\n") ตัวย่อโค้ดของ Next (SWC) จะรวมเป็น template เองแล้วเก็บอีโมจิเป็น "\\uD83C..."
// ลูกค้าเห็นเป็นตัวหนังสือ (เจอจริง 30 ต.ค.) — scripts/check-build.mjs กันไว้แล้ว
export function promoText(): string {
  return `🎉 โปรโมชั่นสั่งตรงทาง LINE
🔺 ราคาพิเศษ สั่งตรงกับร้าน ลดสูงสุด 40%
🚚 ซื้อกรอบป้ายทะเบียน + ${TAX_CAR.name} ${TAX_CAR.price}.- ส่งฟรีทั้งออเดอร์ (ปกติค่าส่ง ${SHIPPING.default}.-)
📸 ส่งรูปก่อน-หลังติดตั้ง หรือคลิปสั้น ๆ มาอวดแอดมิน รับส่วนลด 50.- ใช้ออเดอร์ถัดไป

กด "🛒 สั่งซื้อ" เพื่อเลือกแบบได้เลยครับ 😊`;
}

// ปุ่ม 🎨 ออกแบบสินค้า — รูปเมนูเขียนว่า COMING SOON
export const DESIGN_TEXT = "🎨 บริการออกแบบสินค้า เร็ว ๆ นี้ครับ (Coming soon) 😊\nระหว่างนี้ดูกรอบป้ายรุ่นที่มีได้ที่ปุ่ม 🛒 สั่งซื้อ เลยครับ";
