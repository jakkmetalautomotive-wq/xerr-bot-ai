// Rich Menu 2 แถว × 3 ช่อง ตามรูปที่จักรทำ (public/richmenu.jpg ขนาด 2000 × 1349 — 30 ต.ค. 2026)
// แถวบน: 🎉 โปรโมชั่น · 🛒 สั่งซื้อสินค้า · 💬 ติดต่อแอดมิน  ·  แถวล่าง: 🔧 วิธีติดตั้ง · ⭐ รีวิวสินค้า · 🎨 ออกแบบสินค้า
// เปลี่ยนรูปเมนู: ขนาดต้องตรง RICH_MENU_SIZE (สัดส่วนกว้าง:สูง ≥ 1.45) · JPG ไม่เกิน 1 MB
import type { messagingApi } from "@line/bot-sdk";
import { MENU } from "./shop.ts";

export const RICH_MENU_NAME = "XERR เมนูหลัก";
export const RICH_MENU_IMAGE = { path: "/richmenu.jpg", type: "image/jpeg" };
export const RICH_MENU_SIZE = { width: 2000, height: 1349 };
export const RICH_MENU_LAYOUT: (string | null)[][] = [
  [MENU.promo, MENU.order, MENU.admin],
  [MENU.install, MENU.review, MENU.design], // null = ช่องว่าง กดแล้วไม่มีอะไรเกิดขึ้น
];

// ช่องที่มีปุ่ม → พื้นที่กดบนรูป (ช่องสุดท้ายของแถว/คอลัมน์เก็บเศษพิกเซลให้ครบขอบรูป)
export function richMenuRequest(): messagingApi.RichMenuRequest {
  const { width: W, height: H } = RICH_MENU_SIZE;
  const rows = RICH_MENU_LAYOUT.length;
  const edge = (i: number, n: number, total: number) => Math.round((i * total) / n);
  return {
    size: RICH_MENU_SIZE,
    selected: true, // เปิดเมนูค้างไว้ตอนลูกค้าเข้าแชท
    name: RICH_MENU_NAME,
    chatBarText: "เมนู",
    areas: RICH_MENU_LAYOUT.flatMap((row, r) =>
      row.flatMap((text, c) => {
        if (!text) return [];
        const x = edge(c, row.length, W), y = edge(r, rows, H);
        return [{
          bounds: { x, y, width: edge(c + 1, row.length, W) - x, height: edge(r + 1, rows, H) - y },
          action: { type: "message" as const, label: text, text },
        }];
      }),
    ),
  };
}
