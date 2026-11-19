// หน้าใบปะหน้าสำหรับพิมพ์: /api/label?t=<รหัสออเดอร์>.<ลายเซ็น> (ลิงก์ที่บอทส่งให้แอดมินหลังกด ✅)
import { verifyLabel, getLabel, labelHtml } from "@/lib/label.ts";
import { defaultState } from "@/lib/state.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const page = (body: string, status: number) =>
  new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Tahoma,sans-serif;padding:24px;font-size:18px">${body}</body>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" },
  });

export async function GET(req: Request) {
  const code = verifyLabel(new URL(req.url).searchParams.get("t") ?? "", process.env.LINE_CHANNEL_SECRET ?? "");
  if (!code) return page("ลิงก์ใบปะหน้าไม่ถูกต้อง", 403);
  const data = await getLabel(defaultState, code);
  if (!data) return page(`ไม่พบข้อมูลที่อยู่ของออเดอร์ ${code} (เก็บไว้ 60 วัน) — ดูที่อยู่ในชีทออเดอร์แทนนะครับ`, 404);
  return new Response(labelHtml(data), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" },
  });
}
