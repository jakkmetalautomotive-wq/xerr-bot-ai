// บันทึกออเดอร์ลง Google Sheet ส่วนตัวของร้าน ผ่าน Apps Script เว็บแอป (apps-script/order-log.gs)
// ตั้งใน Vercel: ORDER_LOG_URL (URL เว็บแอป) + ORDER_LOG_SECRET (รหัสเดียวกับ SECRET ใน Script Properties)
// ไม่ได้ตั้ง / ชีทล่ม → ข้ามเงียบ ๆ (log ไว้) ไม่ให้กระทบการสั่งซื้อของลูกค้า
import type { Address, PricedOrder } from "./order.ts";

export const ORDER_STATUS = { waiting: "รอตรวจสลิป", paid: "ชำระแล้ว", mismatch: "ยอดไม่ตรง" } as const;

export type OrderLogEvent =
  | { action: "new"; status: string; order: Record<string, string | number | boolean> }
  | { action: "status"; code: string; status: string };

// แถวออเดอร์ใหม่ (ลำดับคอลัมน์จัดใน Apps Script)
export function newOrderEvent(o: PricedOrder, a: Address, lineName: string, lineUserId: string): OrderLogEvent {
  return {
    action: "new",
    status: ORDER_STATUS.waiting,
    order: {
      code: o.code,
      product: o.productLabel,
      picks: o.picks.join(" / "),
      tax: o.tax,
      base: o.base,
      taxPrice: o.taxPrice,
      shipping: o.shipping,
      total: o.total,
      name: a.name,
      phone: a.phone,
      address: a.address,
      zip: a.zip,
      note: a.note,
      lineName,
      lineUserId,
    },
  };
}

export const statusEvent = (code: string, status: string): OrderLogEvent => ({ action: "status", code, status });

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export async function logOrder(
  event: OrderLogEvent,
  { url = process.env.ORDER_LOG_URL ?? "", secret = process.env.ORDER_LOG_SECRET ?? "", fetchFn = fetch as FetchFn } = {},
): Promise<boolean> {
  if (!url || !secret) {
    console.warn("[orderlog] ยังไม่ได้ตั้ง ORDER_LOG_URL / ORDER_LOG_SECRET — ไม่ได้บันทึกลงชีท:", event.action === "new" ? event.order.code : event.code);
    return false;
  }
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // Apps Script อ่านจาก e.postData.contents เป็นข้อความ JSON
      body: JSON.stringify({ ...event, secret }),
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!res.ok || !data?.ok) {
      console.error(`[orderlog] บันทึกไม่สำเร็จ status=${res.status} error=${data?.error ?? "-"}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[orderlog] บันทึกไม่สำเร็จ:", (err as Error).message);
    return false;
  }
}
