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
type SheetOpts = { url?: string; secret?: string; fetchFn?: FetchFn };

// ส่งคำสั่งไป Apps Script → ผลตอบกลับ (null = ยังไม่ตั้งค่า / ล่ม / รหัสผิด — log ไว้แล้ว)
async function callOrderSheet<T extends { ok?: boolean; error?: string }>(
  payload: Record<string, unknown>,
  what: string,
  { url = process.env.ORDER_LOG_URL ?? "", secret = process.env.ORDER_LOG_SECRET ?? "", fetchFn = fetch as FetchFn }: SheetOpts = {},
): Promise<T | null> {
  if (!url || !secret) {
    console.warn(`[orderlog] ยังไม่ได้ตั้ง ORDER_LOG_URL / ORDER_LOG_SECRET — ข้าม: ${what}`);
    return null;
  }
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // Apps Script อ่านจาก e.postData.contents เป็นข้อความ JSON
      body: JSON.stringify({ ...payload, secret }),
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => null)) as T | null;
    if (!res.ok || !data?.ok) {
      console.error(`[orderlog] ${what} ไม่สำเร็จ status=${res.status} error=${data?.error ?? "-"}`);
      return null;
    }
    return data;
  } catch (err) {
    console.error(`[orderlog] ${what} ไม่สำเร็จ:`, (err as Error).message);
    return null;
  }
}

export async function logOrder(event: OrderLogEvent, opts: SheetOpts = {}): Promise<boolean> {
  return Boolean(await callOrderSheet(event, `บันทึก ${event.action === "new" ? event.order.code : event.code}`, opts));
}

// ---------- เลขพัสดุ ----------
// แอดมินใส่เลข (ผ่านแชทบอท) → คอลัมน์ เลขพัสดุ + สถานะ จัดส่งแล้ว · false = ไม่พบออเดอร์ / ชีทล่ม
export const setTracking = async (code: string, tracking: string, opts: SheetOpts = {}) =>
  Boolean(await callOrderSheet({ action: "set_tracking", code, tracking }, `ใส่เลขพัสดุ ${code}`, opts));

export type TrackingInfo = { ok: boolean; found: boolean; tracking?: string; lineUserId?: string; status?: string };
// null = ชีทล่ม / ยังไม่ตั้งค่า
export const getTracking = (code: string, opts: SheetOpts = {}) => callOrderSheet<TrackingInfo>({ action: "get_tracking", code }, `ขอเลขพัสดุ ${code}`, opts);

// ข้อความที่แอดมินพิมพ์ใส่เลขพัสดุ: บรรทัดละ "XR-ABCD SPXTH0123456789" (คั่นด้วยเว้นวรรค : หรือ -) · บรรทัดอื่นที่ไม่ใช่รูปแบบนี้ → ไม่ใช่คำสั่ง
export function parseTrackingLines(text: string): { code: string; tracking: string }[] | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const out = lines.map((l) => l.match(/^(XR-[A-Z0-9]{4})\s*[:\-–]?\s*([A-Z0-9]{8,})$/i));
  if (!lines.length || out.some((m) => !m)) return null;
  return out.map((m) => ({ code: m![1].toUpperCase(), tracking: m![2].toUpperCase() }));
}

// ---------- สรุปยอดรายสัปดาห์ (Vercel Cron ทุกวันอาทิตย์ → /api/weekly-report) ----------
export type WeeklySummary = {
  ok: boolean;
  from: string;
  to: string;
  paidCount: number;
  paidTotal: number;
  taxCount: number;
  waiting: number;
  mismatch: number;
  byProduct: Record<string, { count: number; total: number }>;
};

export const fetchWeeklySummary = (opts: SheetOpts = {}) => callOrderSheet<WeeklySummary>({ action: "summary", days: 7 }, "สรุปรายสัปดาห์", opts);

const baht = (n: number) => n.toLocaleString("en-US");
const thaiDate = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${["", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."][m]}`;
};

export function weeklyReportText(s: WeeklySummary): string {
  const products = Object.entries(s.byProduct)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, p]) => `🔺 ${name} ${p.count} ออเดอร์ · ${baht(p.total)}.-`);
  return [
    `📊 สรุปยอดขาย LINE 7 วันล่าสุด (${thaiDate(s.from)} – ${thaiDate(s.to)})`,
    "",
    `✅ ชำระแล้ว ${s.paidCount} ออเดอร์ · ยอดรวม ${baht(s.paidTotal)}.-`,
    ...(products.length ? products : ["(ยังไม่มีออเดอร์ที่ชำระแล้ว)"]),
    `➕ เพิ่มป้ายภาษี พรบ. ${s.taxCount} ออเดอร์`,
    ...(s.waiting || s.mismatch ? ["", `⏳ รอตรวจสลิป ${s.waiting} · ❌ ยอดไม่ตรง ${s.mismatch} (เช็คในชีทออเดอร์)`] : []),
    "",
    "รายละเอียดอยู่ในชีท \"ออเดอร์ LINE\" แท็บ สรุปรายสัปดาห์",
  ].join("\n");
}
