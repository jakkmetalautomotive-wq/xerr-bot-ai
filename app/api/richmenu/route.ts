// ติดตั้ง Rich Menu (เมนูด้านล่างแชท) 4 ปุ่ม: 🛒 สั่งซื้อ · 💰 ราคา · 🔧 วิธีติดตั้ง · 💬 คุยกับแอดมิน
// /api/richmenu?key=HEALTH_KEY          → ดูว่าตอนนี้ตั้งเมนูไหนไว้
// /api/richmenu?key=HEALTH_KEY&apply=1  → สร้างเมนูใหม่ (รูป public/richmenu.png) ตั้งเป็นเมนูหลัก แล้วลบเมนูชื่อเดียวกันที่สร้างไว้ก่อนหน้า
// ใช้ LINE_CHANNEL_ACCESS_TOKEN ใน Vercel — ไม่แสดงคีย์ใด ๆ
import { messagingApi } from "@line/bot-sdk";
import { MENU } from "@/lib/shop.ts";
import { baseUrl } from "@/lib/images.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NAME = "XERR เมนูหลัก";
const W = 2500, H = 843; // ขนาดรูป public/richmenu.png
const errMsg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 500);

function richMenuRequest(): messagingApi.RichMenuRequest {
  const texts = [MENU.order, MENU.price, MENU.install, MENU.admin];
  const cell = W / texts.length;
  return {
    size: { width: W, height: H },
    selected: true, // เปิดเมนูค้างไว้ตอนลูกค้าเข้าแชท
    name: NAME,
    chatBarText: "เมนู",
    areas: texts.map((text, i) => ({
      bounds: { x: Math.round(i * cell), y: 0, width: Math.round(cell), height: H },
      action: { type: "message", label: text, text },
    })),
  };
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const key = process.env.HEALTH_KEY ?? "";
  if (key.length < 8 || params.get("key") !== key) return Response.json({ ok: false, note: key ? "ต้องแนบ key ให้ถูกต้อง" : "ปิดอยู่ (ตั้ง HEALTH_KEY ใน Vercel เพื่อเปิด)" }, { status: 401 });

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";
  const api = new messagingApi.MessagingApiClient({ channelAccessToken: token });
  const blob = new messagingApi.MessagingApiBlobClient({ channelAccessToken: token });

  try {
    const before = (await api.getRichMenuList()).richmenus;
    const defaultId = await api.getDefaultRichMenuId().then((r) => r.richMenuId, () => "");
    if (params.get("apply") !== "1") {
      return Response.json({ ok: true, defaultId, menus: before.map((m) => ({ id: m.richMenuId, name: m.name, isDefault: m.richMenuId === defaultId })) });
    }

    const img = await fetch(`${baseUrl()}/richmenu.png`, { cache: "no-store" });
    if (!img.ok) throw new Error(`โหลดรูปเมนูไม่ได้ (${img.status})`);
    const { richMenuId } = await api.createRichMenu(richMenuRequest());
    await blob.setRichMenuImage(richMenuId, new Blob([await img.arrayBuffer()], { type: "image/png" }));
    await api.setDefaultRichMenu(richMenuId);

    // ลบเฉพาะเมนูที่หน้านี้สร้างไว้รอบก่อน (ชื่อเดียวกัน) — เมนูอื่นไม่แตะ
    const removed: string[] = [];
    for (const m of before.filter((m) => m.name === NAME)) {
      await api.deleteRichMenu(m.richMenuId).then(() => removed.push(m.richMenuId), () => {});
    }
    return Response.json({ ok: true, richMenuId, isDefault: true, removedOld: removed.length });
  } catch (e) {
    return Response.json({ ok: false, error: errMsg(e) }, { status: 500 });
  }
}
