// รูปที่ลูกค้าส่งมา (สลิป ฯลฯ) → ส่งต่อให้ LINE แสดงในแชทแอดมิน
// รับเฉพาะลิงก์ที่บอทเซ็นไว้ (lib/slip.ts) · ดึงจาก LINE ด้วย LINE_CHANNEL_ACCESS_TOKEN · &p=1 = รูปย่อ
import { verifySlip } from "@/lib/slip.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const id = verifySlip(params.get("t") ?? "", process.env.LINE_CHANNEL_SECRET ?? "");
  if (!id) return new Response("not found", { status: 404 });

  const path = params.get("p") === "1" ? "content/preview" : "content";
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${id}/${path}`, {
    headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN ?? ""}` },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  const type = res?.headers.get("content-type") ?? "";
  if (!res?.ok || !type.startsWith("image/")) {
    console.warn(`[slip] ดึงรูปจาก LINE ไม่ได้ status=${res?.status} type=${type}`);
    return new Response("image not available", { status: 404 });
  }
  // สลิปเป็นข้อมูลส่วนตัว → ไม่ให้ CDN เก็บสำเนา
  return new Response(await res.arrayBuffer(), { headers: { "Content-Type": type, "Cache-Control": "private, no-store" } });
}
