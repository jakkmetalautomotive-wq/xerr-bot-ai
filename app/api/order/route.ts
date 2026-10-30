// รับแบบฟอร์มที่อยู่จากหน้า /order (LIFF)
// ตรวจ 2 อย่าง: ลูกค้าเป็นใครจริง (ID token จาก LINE) + ออเดอร์ไม่ถูกแก้ (ลายเซ็น) → คิดยอดใหม่ฝั่งเรา → แจ้งแอดมิน
import { getImageSets } from "@/lib/images.ts";
import { verifyOrder, priceOrder, validateAddress, adminOrderMessage, orderLines } from "@/lib/order.ts";
import { line } from "@/lib/line.ts";
import { logOrder, newOrderEvent } from "@/lib/orderlog.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const bad = (error: string, status = 400) => Response.json({ ok: false, error }, { status });

async function lineUserFromIdToken(idToken: string): Promise<{ sub: string; name?: string } | null> {
  const clientId = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!clientId || !idToken) return null;
  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: clientId }),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const data = (await res.json()) as { sub?: string; name?: string };
  return data.sub ? { sub: data.sub, name: data.name } : null;
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("ข้อมูลไม่ถูกต้อง");
  }

  const draft = verifyOrder(String(body.token ?? ""), process.env.LINE_CHANNEL_SECRET ?? "");
  if (!draft) return bad("ลิงก์ออเดอร์ไม่ถูกต้องหรือหมดอายุ กรุณากดปุ่มจากแชทอีกครั้งครับ");

  const user = await lineUserFromIdToken(String(body.idToken ?? ""));
  if (!user) return bad("ยืนยันตัวตน LINE ไม่ได้ กรุณาเปิดแบบฟอร์มจากในแอป LINE ครับ", 401);

  const addr = validateAddress(body as Record<string, string>);
  if (!addr.ok) return bad(addr.error);

  const order = priceOrder(await getImageSets(), draft);
  if (!order) return bad("ข้อมูลสินค้าเปลี่ยนไปแล้ว กรุณาเลือกสินค้าใหม่ในแชทครับ");

  const adminId = process.env.ADMIN_LINE_USER_ID;
  if (adminId) {
    await line.push(adminId, [adminOrderMessage(order, addr.value, user.name ?? "", user.sub)]).catch((err) => console.error("[order] แจ้งแอดมินไม่สำเร็จ:", err));
  } else {
    console.warn(`[order] ยังไม่ได้ตั้ง ADMIN_LINE_USER_ID — ออเดอร์ ${order.code}:\n${orderLines(order)}\n${JSON.stringify(addr.value)}`);
  }

  // ถ้าแบบฟอร์มส่งข้อความในแชทแทนลูกค้าไม่ได้ (เปิดนอกแชท) → บอทยืนยันให้เอง
  if (!body.chatMessageSent) {
    await line.push(user.sub, [`รับที่อยู่จัดส่งแล้วครับ ✅ ออเดอร์ ${order.code}\nโอนยอด ${order.total.toLocaleString("en-US")}.- แล้วส่งสลิปในแชทนี้ได้เลยครับ 🙏`]).catch(() => {});
  }

  // ลงชีทออเดอร์ (สถานะ รอตรวจสลิป) — ชีทล่มก็ไม่กระทบลูกค้า
  await logOrder(newOrderEvent(order, addr.value, user.name ?? "", user.sub));

  console.log(`[order] ${order.code} total=${order.total} picks=${order.picks.join("/")} tax=${order.tax}`);
  return Response.json({ ok: true, code: order.code, total: order.total });
}
