// ใบปะหน้ากล่อง: ลูกค้ากรอกที่อยู่ → เก็บไว้ (Redis 60 วัน) → แอดมินกด ✅ ได้รับเงินแล้ว → บอทส่งลิงก์ใบปะหน้าให้แอดมิน
// ส่งต่อลิงก์ให้พนักงาน เปิดแล้วกด "พิมพ์" ได้เลย (ขนาด 100×150 มม. พิมพ์ A4 ก็ได้)
// ลิงก์มีลายเซ็น (Channel secret) เดารหัสออเดอร์เองไม่ได้ · ที่อยู่ผู้ส่งตั้งใน Vercel: SHIP_FROM (ขึ้นบรรทัดใหม่ด้วย | )
import crypto from "node:crypto";
import { baseUrl } from "./images.ts";
import { TAX_CAR } from "./shop.ts";
import type { Address, PricedOrder } from "./order.ts";
import type { StateStore } from "./state.ts";

export type LabelData = {
  code: string;
  name: string;
  phone: string;
  address: string;
  zip: string;
  note: string;
  items: string[];
  total: number;
  at: number; // เวลาที่ลูกค้าส่งที่อยู่ (ms)
};

const LABEL_SECONDS = 60 * 24 * 60 * 60;
const labelKey = (code: string) => `label:${code}`;

export function labelFromOrder(o: PricedOrder, a: Address, at = Date.now()): LabelData {
  return {
    code: o.code,
    name: a.name,
    phone: a.phone,
    address: a.address,
    zip: a.zip,
    note: a.note,
    items: [`${o.productLabel}${o.picks.length ? `: ${o.picks.join(" / ")}` : ""}`, ...(o.tax ? [TAX_CAR.name] : [])],
    total: o.total,
    at,
  };
}

export async function saveLabel(state: StateStore, data: LabelData) {
  await state.set(labelKey(data.code), JSON.stringify(data), LABEL_SECONDS);
}

export async function getLabel(state: StateStore, code: string): Promise<LabelData | null> {
  const raw = await state.get(labelKey(code));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LabelData;
  } catch {
    return null;
  }
}

const sign = (code: string, secret: string) => crypto.createHmac("sha256", secret).update(`label:${code}`).digest("base64url").slice(0, 22);

export function signLabel(code: string, secret: string): string {
  return `${code}.${sign(code, secret)}`;
}

export function verifyLabel(token: string, secret: string): string | null {
  const m = token.match(/^(XR-[A-Z0-9]{2,12})\.([\w-]{22})$/);
  if (!m || !secret) return null;
  return crypto.timingSafeEqual(Buffer.from(m[2]), Buffer.from(sign(m[1], secret))) ? m[1] : null;
}

export const labelUrl = (code: string, secret: string) => `${baseUrl()}/api/label?t=${encodeURIComponent(signLabel(code, secret))}`;

// ข้อความถึงแอดมินหลังกด ✅ — ข้อความธรรมดา ส่งต่อให้พนักงานในไลน์ได้เลย
export function labelReadyText(code: string, name: string, url: string) {
  return `🖨️ ใบปะหน้า ${code} (${name})\n${url}\n\nส่งต่อให้พนักงาน → เปิดลิงก์ → กด "พิมพ์ใบปะหน้า"`;
}

// ---------- หน้าใบปะหน้า (HTML พิมพ์ได้) ----------
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function formatPhone(p: string) {
  return p.length === 10 ? `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}` : p.length === 9 ? `${p.slice(0, 2)}-${p.slice(2, 5)}-${p.slice(5)}` : p;
}

export function senderLines(raw = process.env.SHIP_FROM ?? ""): string[] {
  const lines = raw.split(/\||\\n|\n/).map((s) => s.trim()).filter(Boolean);
  return lines.length ? lines : ["XERR AUTOTEAM"];
}

const thaiDate = (ms: number) =>
  new Date(ms).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit" });

export function labelHtml(d: LabelData, sender: string[] = senderLines()): string {
  const [senderName, ...senderRest] = sender;
  return `<!doctype html>
<html lang="th"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>ใบปะหน้า ${esc(d.code)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;800&display=swap" rel="stylesheet">
<style>
  @page { size: 100mm 150mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #e9e9e9; font-family: "Sarabun", "Tahoma", sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .tools { max-width: 100mm; margin: 16px auto 10px; display: flex; gap: 8px; padding: 0 4px; }
  .tools button { flex: 1; font: 800 18px "Sarabun", sans-serif; padding: 14px; border: 0; border-radius: 10px; background: #111; color: #fff; }
  .label { width: 100mm; height: 150mm; margin: 0 auto 24px; background: #fff; padding: 5mm; display: flex; flex-direction: column; gap: 3mm; overflow: hidden; }
  .top { display: flex; justify-content: space-between; align-items: center; border-bottom: 0.6mm solid #000; padding-bottom: 2.5mm; }
  .brand { background: #000; color: #fff; padding: 1.5mm 3mm; border-radius: 1.5mm; line-height: 1; }
  .brand b { display: block; font-size: 17pt; font-weight: 800; letter-spacing: 0.06em; }
  .brand span { display: block; font-size: 6.5pt; letter-spacing: 0.42em; margin-top: 0.8mm; }
  .code { text-align: right; line-height: 1.15; }
  .code b { font-size: 15pt; font-weight: 800; }
  .code small { display: block; font-size: 8pt; }
  .tag { font-size: 8pt; font-weight: 800; letter-spacing: 0.08em; }
  .from { font-size: 9pt; line-height: 1.35; }
  .from strong { font-size: 10pt; font-weight: 800; }
  .to { border: 0.7mm solid #000; border-radius: 2mm; padding: 3mm; flex: 1; display: flex; flex-direction: column; gap: 1.5mm; }
  .to .name { font-size: 20pt; font-weight: 800; line-height: 1.15; }
  .to .phone { font-size: 17pt; font-weight: 800; letter-spacing: 0.02em; }
  .to .addr { font-size: 13pt; line-height: 1.35; font-weight: 600; }
  .to .zip { margin-top: auto; align-self: flex-start; border: 0.6mm solid #000; padding: 0.5mm 3mm; font-size: 22pt; font-weight: 800; letter-spacing: 0.25em; }
  .items { font-size: 9.5pt; line-height: 1.35; border-top: 0.3mm dashed #000; padding-top: 2mm; }
  .items li { list-style: none; }
  .items li::before { content: "☐ "; }
  .note { font-size: 9pt; font-weight: 600; }
  .paid { text-align: center; font-size: 10pt; font-weight: 800; border: 0.4mm solid #000; padding: 1mm; }
  @media print {
    body { background: #fff; }
    .tools { display: none; }
    .label { margin: 0; }
  }
</style></head>
<body>
<div class="tools"><button onclick="window.print()">🖨️ พิมพ์ใบปะหน้า</button></div>
<main class="label">
  <div class="top">
    <div class="brand"><b>XERR</b><span>AUTOTEAM</span></div>
    <div class="code"><b>${esc(d.code)}</b><small>${esc(thaiDate(d.at))}</small></div>
  </div>
  <section class="from">
    <div class="tag">ผู้ส่ง (FROM)</div>
    <strong>${esc(senderName)}</strong>${senderRest.map((l) => `<br>${esc(l)}`).join("")}
  </section>
  <section class="to">
    <div class="tag">ผู้รับ (TO)</div>
    <div class="name">${esc(d.name)}</div>
    <div class="phone">โทร ${esc(formatPhone(d.phone))}</div>
    <div class="addr">${esc(d.address)}</div>
    <div class="zip">${esc(d.zip)}</div>
  </section>
  <ul class="items">${d.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
  ${d.note ? `<div class="note">📝 ${esc(d.note)}</div>` : ""}
  <div class="paid">ชำระเงินแล้ว · ไม่เก็บเงินปลายทาง</div>
</main>
</body></html>`;
}
