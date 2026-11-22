// Facebook Messenger + Instagram DM webhook → สมองบอทตัวเดียวกับ LINE
// GET  = Meta ยืนยัน URL ตอนกด "Verify and save" (ต้องตรงกับ META_VERIFY_TOKEN)
// POST = ข้อความลูกค้า: ตรวจลายเซ็น (META_APP_SECRET) → ตอบ Meta "ได้รับแล้ว" ทันที → ประมวลผลต่อเบื้องหลัง
import { waitUntil } from "@vercel/functions";
import { handleEvent, MUTE_SECONDS, type LinePort } from "@/lib/bot.ts";
import { line, paymentInfo } from "@/lib/line.ts";
import { metaPort, routedPort, toLineEvents, verifyMetaSignature, type MetaWebhookBody } from "@/lib/meta.ts";
import { defaultState } from "@/lib/state.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const expected = process.env.META_VERIFY_TOKEN ?? "";
  if (q.get("hub.mode") === "subscribe" && expected && q.get("hub.verify_token") === expected) {
    return new Response(q.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("XERR Meta webhook ✅ (Facebook/Instagram จะส่งข้อความมาแบบ POST)", { status: q.has("hub.mode") ? 403 : 200 });
}

export async function POST(req: Request) {
  const body = await req.text();
  if (!verifyMetaSignature(body, req.headers.get("x-hub-signature-256"), (process.env.META_APP_SECRET ?? "").trim())) {
    // มีลายเซ็นมาแต่ไม่ตรง = META_APP_SECRET ใน Vercel ไม่ตรงกับแอป → บันทึกไว้ให้ /api/health บอก
    if (req.headers.get("x-hub-signature-256")) await note("meta:badsig", { at: new Date().toISOString() });
    return new Response("invalid signature", { status: 401 });
  }
  let parsed: MetaWebhookBody;
  try {
    parsed = JSON.parse(body);
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const events = toLineEvents(parsed);
  await note("meta:last", { at: new Date().toISOString(), object: parsed.object ?? "", events: events.length });

  const deps = {
    line: routedPort(line, recordErrors(metaPort())), // ลูกค้า → Meta · แจ้งแอดมิน → LINE ของแอดมิน
    adminUserId: process.env.ADMIN_LINE_USER_ID,
    paymentInfo: paymentInfo(),
    orderSecret: process.env.LINE_CHANNEL_SECRET, // เซ็นลิงก์สลิป/ใบปะหน้า (แบบฟอร์มที่อยู่ใช้ได้เฉพาะ LINE → ลูกค้า FB/IG พิมพ์ที่อยู่ในแชท)
    reviewPromo: true,
  };
  const jobs = events.map((e) =>
    e.kind === "human"
      ? defaultState.set(`mute:${e.userId}`, "1", MUTE_SECONDS) // แอดมินตอบเองในกล่องข้อความ → บอทเงียบกับลูกค้าคนนั้นสักพัก
      : handleEvent(e.event, deps),
  );
  waitUntil(Promise.all(jobs.map((j) => Promise.resolve(j).catch(async (err) => {
    console.error("[meta-webhook] error:", err);
    await note("meta:crash", { at: new Date().toISOString(), error: String((err as Error)?.message ?? err).slice(0, 300) });
  }))));
  return new Response("EVENT_RECEIVED");
}

// ---------- บันทึกสถานะล่าสุด (ไม่เก็บรหัส/ข้อความลูกค้า) → ดูได้ที่ /api/health ส่วน meta ----------
const NOTE_SECONDS = 7 * 24 * 60 * 60;
async function note(key: string, value: Record<string, unknown>) {
  await defaultState.set(key, JSON.stringify(value), NOTE_SECONDS).catch(() => {});
}
function recordErrors(port: LinePort): LinePort {
  const wrap = <A extends unknown[]>(fn: (...a: A) => Promise<void>) => async (...a: A) => {
    try {
      await fn(...a);
      await note("meta:sent", { at: new Date().toISOString() });
    } catch (err) {
      await note("meta:error", { at: new Date().toISOString(), error: (err as Error).message.slice(0, 300) });
      throw err;
    }
  };
  return { ...port, reply: wrap(port.reply), push: wrap(port.push) };
}
