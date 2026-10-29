// LINE Webhook: ตรวจลายเซ็น → ตอบ LINE ว่า "ได้รับแล้ว" ทันที → ประมวลผลต่อเบื้องหลัง
import { validateSignature, type webhook } from "@line/bot-sdk";
import { waitUntil } from "@vercel/functions";
import { handleEvent } from "@/lib/bot.ts";
import { line, paymentInfo } from "@/lib/line.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // รอ Gemini ลองซ้ำ + รุ่นสำรองได้ (lib/gemini.ts BUDGET_MS 48 วิ)

export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get("x-line-signature") ?? "";
  const secret = process.env.LINE_CHANNEL_SECRET ?? "";
  if (!secret || !signature || !validateSignature(body, secret, signature)) {
    return new Response("invalid signature", { status: 401 });
  }

  let events: webhook.Event[] = [];
  try {
    events = (JSON.parse(body) as webhook.CallbackRequest).events ?? [];
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const deps = {
    line,
    adminUserId: process.env.ADMIN_LINE_USER_ID,
    liffId: process.env.LIFF_ID || process.env.NEXT_PUBLIC_LIFF_ID,
    paymentInfo: paymentInfo(),
    orderSecret: secret,
  };
  waitUntil(
    Promise.all(events.map((e) => handleEvent(e, deps).catch((err) => console.error("[webhook] error:", err)))),
  );
  return new Response("ok");
}

// เปิด URL นี้ในเบราว์เซอร์เพื่อเช็คว่า endpoint ขึ้นแล้ว
export function GET() {
  return new Response("XERR LINE webhook ✅ (LINE จะส่งข้อความมาแบบ POST)");
}
