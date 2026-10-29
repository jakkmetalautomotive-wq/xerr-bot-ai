// Rich Menu 2 แถว × 3 ช่อง (รูป public/richmenu.png ขนาด 2500 × 1686)
// แถวบน: 🛒 สั่งซื้อ · 💰 ราคา · 🔧 วิธีติดตั้ง  ·  แถวล่าง: ⭐ รีวิวสินค้า · 💬 คุยกับแอดมิน · (ช่องที่ 6 ว่างไว้ก่อน)
import type { messagingApi } from "@line/bot-sdk";
import { MENU } from "./shop.ts";

export const RICH_MENU_NAME = "XERR เมนูหลัก";
export const RICH_MENU_SIZE = { width: 2500, height: 1686 };
export const RICH_MENU_LAYOUT: (string | null)[][] = [
  [MENU.order, MENU.price, MENU.install],
  [MENU.review, MENU.admin, null], // null = ช่องว่าง กดแล้วไม่มีอะไรเกิดขึ้น
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
