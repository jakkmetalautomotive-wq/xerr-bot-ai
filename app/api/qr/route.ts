// รูป QR พร้อมเพย์ของออเดอร์ (ลิงก์จากสรุปออเดอร์) · ตรวจลายเซ็นออเดอร์ก่อน → ยอดแก้เองไม่ได้
import QRCode from "qrcode";
import { verifyOrder } from "@/lib/order.ts";
import { promptPayId, promptPayPayload } from "@/lib/promptpay.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("o") ?? "";
  const order = verifyOrder(token, process.env.LINE_CHANNEL_SECRET ?? "");
  const payload = order?.total ? promptPayPayload(promptPayId(), order.total) : null;
  if (!payload) return new Response("not found", { status: 404 });
  const png = await QRCode.toBuffer(payload, { type: "png", width: 720, margin: 3, errorCorrectionLevel: "M" });
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" } });
}
