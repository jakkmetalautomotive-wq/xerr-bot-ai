// รับแบบฟอร์มที่อยู่จากหน้า /order (LIFF)
// ตรวจ 2 อย่าง: ลูกค้าเป็นใครจริง (ID token จาก LINE) + ออเดอร์ไม่ถูกแก้ (ลายเซ็น) → คิดยอดใหม่ฝั่งเรา → แจ้งแอดมิน
import { getImageSets } from "@/lib/images.ts";
import { verifyOrder, priceOrder, validateAddress, orderLines, orderFormUrl, isMetaUser } from "@/lib/order.ts";
import { line } from "@/lib/line.ts";
import { metaPort, routedPort } from "@/lib/meta.ts";
import { getTracking, logOrder, newOrderEvent } from "@/lib/orderlog.ts";
import { getLabel, labelFromOrder, saveLabel } from "@/lib/label.ts";
import { addressAdminMessages, addressChanged, addressReplies, orderStage } from "@/lib/order-stage.ts";
import { defaultState } from "@/lib/state.ts";

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

  // ลูกค้า Facebook/Instagram: ไม่มี LINE Login → ลิงก์มีลายเซ็นผูกกับลูกค้าคนนี้แล้ว (บอทส่งให้ในแชทของเขาเท่านั้น)
  const chat = routedPort(line, metaPort());
  const user = draft.u
    ? { sub: draft.u, name: await chat.displayName(draft.u).catch(() => "") }
    : await lineUserFromIdToken(String(body.idToken ?? ""));
  if (!user) return bad("ยืนยันตัวตน LINE ไม่ได้ กรุณาเปิดแบบฟอร์มจากในแอป LINE ครับ", 401);

  const addr = validateAddress(body as Record<string, string>);
  if (!addr.ok) return bad(addr.error);

  const order = priceOrder(await getImageSets(), draft);
  if (!order) return bad("ข้อมูลสินค้าเปลี่ยนไปแล้ว กรุณาเลือกสินค้าใหม่ในแชทครับ");

  const form = orderFormUrl(String(body.token), isMetaUser(user.sub), process.env.LIFF_ID || process.env.NEXT_PUBLIC_LIFF_ID || "");
  const label = labelFromOrder(order, addr.value, Date.now(), { user: user.sub, form });
  const before = await getLabel(defaultState, order.code).catch(() => null);
  const edited = addressChanged(before, label);
  // แก้ที่อยู่หลังจัดส่งแล้วไม่ได้ (มีเลขพัสดุในชีท) · ชีทล่ม → ให้แก้ได้ แอดมินได้แจ้งเตือนอยู่แล้ว
  if (edited && (await getTracking(order.code, { timeoutMs: 6_000 }).catch(() => null))?.tracking) {
    return bad("ออเดอร์นี้จัดส่งแล้ว แก้ที่อยู่ไม่ได้ครับ รบกวนทักแอดมินในแชท");
  }

  // เก็บที่อยู่ไว้ทำใบปะหน้า (ส่งให้แอดมินตอนกด ✅ ได้รับเงินแล้ว + ให้ลูกค้าเช็คความถูกต้อง)
  await saveLabel(defaultState, label).catch((err) => console.error("[order] เก็บข้อมูลใบปะหน้าไม่สำเร็จ:", err));

  // อ่านขั้นหลังเก็บที่อยู่ → แอดมินกด ✅ พร้อมกันพอดี อย่างน้อยฝั่งหนึ่งได้ใบปะหน้าแน่นอน
  const stage = await orderStage(defaultState, order.code);

  const adminId = process.env.ADMIN_LINE_USER_ID;
  if (adminId) {
    await line.push(adminId, addressAdminMessages(stage, order, addr.value, user.name ?? "", user.sub, process.env.LINE_CHANNEL_SECRET ?? "", edited)).catch((err) => console.error("[order] แจ้งแอดมินไม่สำเร็จ:", err));
  } else {
    console.warn(`[order] ยังไม่ได้ตั้ง ADMIN_LINE_USER_ID — ออเดอร์ ${order.code}:\n${orderLines(order)}\n${JSON.stringify(addr.value)}`);
  }

  // ถ้าแบบฟอร์มส่งข้อความในแชทแทนลูกค้าไม่ได้ (เปิดนอกแชท) → บอทยืนยันให้เอง
  if (!body.chatMessageSent) {
    await chat.push(user.sub, await addressReplies(defaultState, order.code, order.total.toLocaleString("en-US"), user.sub, process.env.LINE_CHANNEL_SECRET ?? "")).catch(() => {});
  }

  // ลงชีทออเดอร์ (สถานะ รอตรวจสลิป) — ชีทล่มก็ไม่กระทบลูกค้า
  await logOrder(newOrderEvent(order, addr.value, user.name ?? "", user.sub));

  console.log(`[order] ${order.code} total=${order.total} picks=${order.picks.join("/")} tax=${order.tax}`);
  return Response.json({ ok: true, code: order.code, total: order.total, stage });
}
