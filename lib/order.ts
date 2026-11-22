// ออเดอร์: คิดยอดด้วยโค้ด (ไม่ใช้ AI) · ข้อมูลออเดอร์เซ็นกำกับกันแก้ไข · ไม่ต้องมีฐานข้อมูล
// ข้อมูลออเดอร์ติดไปกับปุ่ม / ลิงก์แบบฟอร์ม / ปุ่มของแอดมิน ทุกขั้น
import crypto from "node:crypto";
import { stepOf, CATEGORY_SET, CARD_THEME, baseUrl, type ImageSet } from "./images.ts";
import { SHIPPING, TAX_CAR, REVIEW_REMINDER } from "./shop.ts";

// u = ลูกค้า Facebook/Instagram (fb:/ig:) — แบบฟอร์มเว็บไม่มี LINE Login → ลายเซ็นออเดอร์ยืนยันว่าเป็นลูกค้าคนนี้
export type OrderDraft = { code: string; product: string; picks: string[]; tax: boolean; u?: string };
export const isMetaUser = (id = "") => /^(fb|ig):\d+$/.test(id);
export type PricedOrder = OrderDraft & {
  productLabel: string;
  base: number;
  taxPrice: number;
  shipping: number;
  total: number;
};

const baht = (n: number) => n.toLocaleString("en-US");

export function newOrderCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ตัดตัวที่สับสน (0/O, 1/I)
  return "XR-" + Array.from(crypto.randomBytes(4), (b) => chars[b % chars.length]).join("");
}

// ราคาบนการ์ด "399.-" → 399 · "399.- / 419.-" (หลายราคา) → null
export function singlePrice(text: string): number | null {
  const nums = (text.match(/\d[\d,]*/g) ?? []).map((n) => Number(n.replace(/,/g, "")));
  return nums.length === 1 ? nums[0] : null;
}

export function productLabel(product: string): string {
  return product.startsWith("กรอบป้าย") ? product : `กรอบป้าย${product}`;
}

// สั่งเฉพาะกรอบป้ายภาษี → ค่าส่ง 15 และไม่ชวนซื้อป้ายภาษีเพิ่ม
export const isTaxOnly = (product: string) => product.includes("ป้ายภาษี");

// ราคา = ราคาเดียวของแบบที่เลือกตัวท้ายสุด (เช่น ขนาด "สั้น-ยาว 419.-")
// ไม่มีแบบไหนมีราคาเดียว → ใช้ราคาบนการ์ดประเภทสินค้า (เช่น ABS 199.-) · ค่าส่งตามกติกาใบประ
export function priceOrder(sets: ImageSet[], draft: OrderDraft): PricedOrder | null {
  const items = sets.filter((s) => stepOf(s.name)?.product === draft.product).flatMap((s) => s.items);
  const category = sets.find((s) => s.name === CATEGORY_SET)?.items.find((i) => i.name === draft.product);
  let base: number | null = category ? singlePrice(category.price) : null;
  for (const pick of draft.picks) {
    const item = items.find((i) => i.name === pick);
    if (!item) return null; // ตัวเลือกไม่ตรงกับการ์ด (ข้อมูลเก่า/ถูกแก้)
    const p = singlePrice(item.price);
    if (p !== null) base = p;
  }
  if (base === null) return null;
  const taxOnly = isTaxOnly(draft.product);
  const tax = draft.tax && !taxOnly;
  const taxPrice = tax ? TAX_CAR.price : 0;
  const shipping = taxOnly ? SHIPPING.taxOnly : tax ? SHIPPING.freeWithTaxCar : SHIPPING.default;
  draft = { ...draft, tax };
  return { ...draft, productLabel: productLabel(draft.product), base, taxPrice, shipping, total: base + taxPrice + shipping };
}

// ---------- เซ็นกำกับ (กันลูกค้าแก้ยอด/รายการในลิงก์) ----------
const b64 = (s: string) => Buffer.from(s).toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");
const sign = (data: string, secret: string) => crypto.createHmac("sha256", secret).update(data).digest("base64url").slice(0, 22);

export function signOrder(draft: OrderDraft & { total?: number }, secret: string): string {
  const data = b64(JSON.stringify(draft));
  return `${data}.${sign(data, secret)}`;
}

export function verifyOrder(token: string, secret: string): (OrderDraft & { total?: number }) | null {
  const [data, sig] = token.split(".");
  if (!data || !sig || !secret) return null;
  const expected = sign(data, secret);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const d = JSON.parse(unb64(data));
    if (typeof d.code !== "string" || typeof d.product !== "string" || !Array.isArray(d.picks)) return null;
    return { code: d.code, product: d.product, picks: d.picks.map(String), tax: Boolean(d.tax), total: typeof d.total === "number" ? d.total : undefined, ...(isMetaUser(d.u) ? { u: String(d.u) } : {}) };
  } catch {
    return null;
  }
}

// ---------- ข้อความ ----------
export function orderLines(o: PricedOrder): string {
  return [
    `🔺 ${o.productLabel}${o.picks.length ? `: ${o.picks.join(" / ")}` : ""}  ${baht(o.base)}.-`,
    ...(o.tax ? [`🔺 ${TAX_CAR.name}  ${baht(o.taxPrice)}.-`] : []),
    `🚚 ค่าส่ง SPX: ${o.shipping === 0 ? "ฟรี" : `${baht(o.shipping)}.-`}`,
    `💰 ยอดชำระ ${baht(o.total)}.-`,
  ].join("\n");
}

// เทมเพลตสรุปออเดอร์ของจักร (ปรับคำเป็นผู้ชาย) · เลขบัญชีมาจาก PAYMENT_INFO ใน Vercel
// payInline = false → ไม่ใส่ข้อมูลโอนในสรุป (Messenger ส่งเป็นข้อความ "ช่องทางชำระเงิน" แยก ดู paymentMessage)
export function orderSummaryText(o: PricedOrder, paymentInfo: string, hasForm: boolean, { qr = false, copyAccount = false, payInline = true } = {}): string {
  const howTo = [
    ...(qr ? ["📱 สแกน QR พร้อมเพย์ด้านล่างได้เลย (ใส่ยอดให้แล้ว)"] : []),
    ...(copyAccount ? ["📋 เลขบัญชีส่งแยกไว้ด้านล่าง กดปุ่มโอนในแชท หรือกดค้างเพื่อคัดลอกได้เลยครับ"] : []),
  ];
  const info = formatPaymentInfo(paymentInfo);
  const pay = info || qr
    ? ["เมื่อ Confirm สินค้าแล้ว สามารถโอนชำระได้เลยนะครับ", "", ...(info ? [info] : []), ...howTo, "‼️กรุณาส่งสลิปโอนเงินมาในแชตด้วยนะครับ ‼️"].join("\n")
    : "เดี๋ยวแอดมินส่งเลขบัญชีให้นะครับ";
  const address = hasForm
    ? "🚚 กดปุ่ม \"กรอกชื่อ-ที่อยู่จัดส่ง\" ด้านล่างได้เลยครับ"
    : "🚚 รบกวนแจ้งชื่อที่อยู่สำหรับจัดส่ง\n👤 ชื่อ :\n📞 เบอร์ :\n📦 ที่อยู่จัดส่ง :";
  return [
    `📍สรุปรายการสั่งซื้อ (ออเดอร์ ${o.code})`,
    orderLines(o),
    "*ไม่มีเก็บปลายทาง*",
    "",
    ...(payInline ? [pay, ""] : []),
    address,
    "",
    "🚚 การจัดส่งสินค้า",
    "✂️ ตัดรอบส่ง เที่ยง",
    "🗓 ส่ง ทุกวัน จันทร์-เสาร์",
    "",
    "ขอบคุณที่อุดหนุนครับ 🙏",
  ].join("\n");
}

// ข้อความช่องทางชำระเงินแยก (Messenger): PAYMENT_INFO บรรทัดเดียว → ขึ้นบรรทัดใหม่หน้า emoji แต่ละตัว
// Messenger เห็นเลขบัญชีในข้อความ → ทำการ์ดธนาคารพร้อมปุ่มโอนให้เอง (เฉพาะธนาคารที่ Meta รองรับ)
// ชื่อย่อธนาคาร → ชื่อเต็ม (ดูเป็นทางการ) · บรรทัดเดียว → ขึ้นบรรทัดใหม่หน้า emoji แต่ละตัว
const BANK_NAMES: [RegExp, string][] = [
  [/\bKTB\b/g, "ธนาคารกรุงไทย"],
  [/\bTTB\b/g, "ธนาคารทหารไทยธนชาต (ttb)"],
  [/\bKBANK\b/g, "ธนาคารกสิกรไทย"],
  [/\bSCB\b/g, "ธนาคารไทยพาณิชย์"],
  [/\bBBL\b/g, "ธนาคารกรุงเทพ"],
];
export function formatPaymentInfo(paymentInfo: string): string {
  let info = paymentInfo.trim();
  for (const [re, name] of BANK_NAMES) info = info.replace(re, name);
  return info.includes("\n") ? info : info.replace(/\s*(\p{Extended_Pictographic})/gu, "\n$1").trim();
}

// ปุ่มคัดลอกเลขบัญชี (Messenger ไม่มีปุ่มคัดลอกในตัว → เปิดหน้า /copy ที่มีปุ่มคัดลอก) · บัญชีแรกใน PAYMENT_INFO
export function copyAccountMessage(paymentInfo: string) {
  const info = formatPaymentInfo(paymentInfo);
  const line = info.split("\n").find((l) => /\d[\d -]{7,}\d/.test(l));
  const number = line?.match(/\d[\d -]{7,}\d/)?.[0].trim().replace(/\s+/g, "-");
  if (!line || !number) return null;
  const bank = line.match(/ธนาคาร\S+/)?.[0] ?? "";
  const owner = info.match(/ชื่อบัญชี\s*:?\s*([^\n]+)/)?.[1].trim() ?? "";
  const url = `${baseUrl()}/copy?${new URLSearchParams({ n: number, ...(bank ? { b: bank } : {}), ...(owner ? { o: owner } : {}) })}`;
  return {
    type: "flex" as const,
    altText: `คัดลอกเลขบัญชี ${bank} ${number}`.trim(),
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: `📋 เลขบัญชี${bank} ${number}`, wrap: true, weight: "bold" },
          // webview: "compact" = Messenger เปิดเป็นแผ่นครึ่งจอ (ข้อความนี้ส่งเฉพาะลูกค้า Messenger)
          { type: "button", style: "primary", color: "#1BA5E1", action: { type: "uri", label: "📋 คัดลอกเลขบัญชี", uri: url, webview: "compact" } },
        ],
      },
    },
  };
}
// Messenger แสดงเฉพาะกรุงไทย (การ์ดปุ่มโอนของ Meta ไม่รองรับ ttb) → ตัดบรรทัด ttb ออกจาก PAYMENT_INFO
export function withoutTtb(paymentInfo: string): string {
  return formatPaymentInfo(paymentInfo).split("\n").filter((l) => !/ttb|ทหารไทย|ธนชาต/i.test(l)).join("\n");
}
export function paymentMessage(paymentInfo: string): string | null {
  const info = formatPaymentInfo(paymentInfo);
  return info ? `💳 ช่องทางชำระเงิน\n${info}` : null;
}

// ---------- ปุ่ม (postback) ----------
export type Postback =
  | { k: "tax"; y: 0 | 1; p: string; s: string[] }
  | { k: "adm"; a: "ok" | "bad"; c: string; u: string; t: number }
  | { k: "trk"; c: string }
  | { k: "rv"; f: string; c?: string; b?: 1 }; // กด "สั่งลายนี้" ใต้รูปรีวิว: f = ลาย, c = สี, b = ไร้เส้นขอบ

export function encodePostback(p: Postback): string {
  const s = JSON.stringify(p);
  if (s.length > 300) throw new Error("postback ยาวเกิน 300 ตัวอักษร");
  return s;
}

export function decodePostback(data: string): Postback | null {
  try {
    const p = JSON.parse(data);
    if (p?.k === "tax" && Array.isArray(p.s) && typeof p.p === "string") return p;
    if (p?.k === "adm" && (p.a === "ok" || p.a === "bad") && typeof p.c === "string" && typeof p.u === "string") return p;
    if (p?.k === "trk" && typeof p.c === "string") return p;
    if (p?.k === "rv" && typeof p.f === "string" && (p.c === undefined || typeof p.c === "string")) return p;
  } catch {}
  return null;
}

// แอดมินยืนยันรับเงิน → การ์ดถึงลูกค้า + ปุ่ม "📦 ขอเลขพัสดุ" (อยู่ในการ์ด กดได้ตลอด ไม่หายแบบปุ่มด่วน)
export const TRACKING_READY_TEXT = "📦 เลขพัสดุเช็คได้หลัง 20:00 น. ของวันที่จัดส่ง กดปุ่มด้านล่างได้เลยครับ";
export function paidConfirmMessage(code: string, total: number) {
  const t = CARD_THEME;
  const lines = [
    `ได้รับยอดชำระ ${baht(total)}.- แล้วครับ ✅ ออเดอร์ ${code}`,
    "จัดส่ง SPX รอบถัดไป (ตัดรอบเที่ยง จันทร์–เสาร์) ขอบคุณที่อุดหนุนครับ 🙏",
  ];
  return {
    type: "flex" as const,
    altText: `${lines.join(" ")} ${TRACKING_READY_TEXT}`.slice(0, 400),
    contents: {
      type: "bubble",
      size: "mega",
      styles: { body: { backgroundColor: t.bgTop }, footer: { backgroundColor: t.bgBottom } },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        background: { type: "linearGradient", angle: "0deg", startColor: t.bgBottom, endColor: t.bgTop },
        contents: [
          { type: "text", text: lines[0], color: t.title, size: "md", weight: "bold", wrap: true },
          { type: "text", text: lines[1], color: t.title, size: "sm", wrap: true },
          { type: "separator", color: "#333333" },
          { type: "text", text: TRACKING_READY_TEXT, color: t.accent, size: "sm", weight: "bold", wrap: true },
          { type: "text", text: REVIEW_REMINDER, color: t.muted, size: "sm", wrap: true },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [{
          type: "box",
          layout: "vertical",
          backgroundColor: "#FFFFFF",
          cornerRadius: "10px",
          paddingAll: "14px",
          action: { type: "postback", label: "ขอเลขพัสดุ", data: encodePostback({ k: "trk", c: code }), displayText: `📦 ขอเลขพัสดุ (${code})` },
          contents: [{ type: "text", text: "📦 ขอเลขพัสดุ", size: "lg", weight: "bold", color: "#111111", align: "center" }],
        }],
      },
    },
  };
}

// ชวนเพิ่มกรอบป้ายภาษี — การ์ดโทนร้าน + ปุ่มใหญ่พื้นขาวตัวดำ (ปุ่มด่วนของ LINE ปรับขนาด/สีไม่ได้)
export function taxUpsellMessage(product: string, picks: string[]) {
  const summary = `รับทราบครับ สรุปที่เลือก: ${productLabel(product)}${picks.length ? ` ${picks.join(" / ")}` : ""} 😊`;
  const question = `เพิ่ม${TAX_CAR.name} ${TAX_CAR.price}.- ส่งฟรีทั้งออเดอร์เลยไหมครับ (ปกติค่าส่ง ${SHIPPING.default}.-)`;
  const t = CARD_THEME;
  // กล่องกดได้ (ตัวหนังสือใหญ่กว่าปุ่มมาตรฐาน) → ส่ง postback เดิม
  const choice = (label: string, y: 0 | 1) => ({
    type: "box",
    layout: "vertical",
    backgroundColor: "#FFFFFF",
    cornerRadius: "10px",
    paddingAll: "14px",
    action: { type: "postback", label: label.slice(0, 20), data: encodePostback({ k: "tax", y, p: product, s: picks }), displayText: label },
    contents: [{ type: "text", text: label, size: "lg", weight: "bold", color: "#111111", align: "center" }],
  });
  return {
    type: "flex" as const,
    altText: `${summary} ${question}`.slice(0, 400),
    contents: {
      type: "bubble",
      size: "mega",
      styles: { body: { backgroundColor: t.bgTop }, footer: { backgroundColor: t.bgBottom } },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        background: { type: "linearGradient", angle: "0deg", startColor: t.bgBottom, endColor: t.bgTop },
        contents: [
          // รูปกรอบป้ายภาษีรถยนต์ (public/products/tax-car.jpg) ขนาด ~2/3 การ์ด วางกลาง มุมโค้ง (จักรขอย่อจากเต็มการ์ด)
          {
            type: "box",
            layout: "horizontal",
            justifyContent: "center",
            contents: [{
              type: "box",
              layout: "vertical",
              width: "200px",
              cornerRadius: "12px",
              contents: [{ type: "image", url: `${baseUrl()}/products/tax-car.jpg`, size: "full", aspectRatio: "1:1", aspectMode: "cover" }],
            }],
          },
          { type: "text", text: summary, color: t.title, size: "md", wrap: true },
          { type: "separator", color: "#333333" },
          { type: "text", text: question, color: t.accent, size: "md", weight: "bold", wrap: true },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [choice(`✅ เพิ่มป้าย พรบ. ${TAX_CAR.price}.-`, 1), choice("❌ ไม่เพิ่ม", 0)],
      },
    },
  };
}

// การ์ดปุ่ม "กรอกชื่อ-ที่อยู่จัดส่ง" → เปิดแบบฟอร์มในแอป LINE
// url = ลิงก์ LIFF (ลูกค้า LINE) หรือหน้าเว็บ /order (ลูกค้า Facebook/Instagram)
export function addressButtonMessage(url: string) {
  return {
    type: "flex" as const,
    altText: "กรอกชื่อ-ที่อยู่จัดส่ง",
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "📦 ข้อมูลจัดส่ง", weight: "bold" },
          { type: "text", text: "กรอกชื่อ เบอร์ ที่อยู่ ให้เรียบร้อย แล้วโอน + ส่งสลิปในแชทได้เลยครับ", size: "sm", color: "#666666", wrap: true },
          {
            type: "button",
            style: "primary",
            color: "#06C755",
            action: { type: "uri", label: "กรอกชื่อ-ที่อยู่จัดส่ง", uri: url },
          },
        ],
      },
    },
  };
}

export type Address = { name: string; phone: string; address: string; zip: string; note: string };

export function validateAddress(a: Partial<Address>): { ok: true; value: Address } | { ok: false; error: string } {
  const value: Address = {
    name: String(a.name ?? "").trim().slice(0, 100),
    phone: String(a.phone ?? "").replace(/[^\d]/g, ""),
    address: String(a.address ?? "").trim().slice(0, 400),
    zip: String(a.zip ?? "").replace(/[^\d]/g, ""),
    note: String(a.note ?? "").trim().slice(0, 200),
  };
  if (value.name.length < 2) return { ok: false, error: "กรุณากรอกชื่อ-นามสกุล" };
  if (!/^0\d{8,9}$/.test(value.phone)) return { ok: false, error: "เบอร์โทรไม่ถูกต้อง (ขึ้นต้นด้วย 0 และมี 9–10 หลัก)" };
  if (value.address.length < 10) return { ok: false, error: "กรุณากรอกที่อยู่ให้ครบ (บ้านเลขที่ ถนน ตำบล อำเภอ จังหวัด)" };
  if (!/^\d{5}$/.test(value.zip)) return { ok: false, error: "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก" };
  return { ok: true, value };
}

// แจ้งแอดมิน + ปุ่มยืนยันรับเงิน
export function adminOrderMessage(o: PricedOrder, a: Address, customerName: string, userId: string) {
  const text = [
    `💰 ออเดอร์ ${o.code} — รอเช็คยอดโอน`,
    orderLines(o),
    "",
    `👤 ${a.name}  📞 ${a.phone}`,
    `📦 ${a.address} ${a.zip}`,
    ...(a.note ? [`📝 ${a.note}`] : []),
    `${userId.startsWith("fb:") ? "Facebook" : userId.startsWith("ig:") ? "Instagram" : "LINE"}: ${customerName || "-"}`,
    "",
    "ลูกค้าจะส่งสลิปในแชท · เช็คยอดในแอปธนาคารแล้วกดปุ่มด้านล่าง",
  ].join("\n");
  return confirmCard(text, `ออเดอร์ ${o.code} ยอด ${baht(o.total)}.- รอเช็คยอดโอน`, o.code, o.total, userId);
}

// ลูกค้าที่มีออเดอร์ค้างส่งสลิปมา → การ์ดถึงแอดมินพร้อมปุ่มเดียวกัน (กดยืนยันจากใต้รูปสลิปได้เลย)
export function slipConfirmMessage(code: string, total: number, userId: string) {
  const text = `🧾 สลิปของออเดอร์ ${code} (รูปอยู่ด้านบน)\n💰 ยอดที่ต้องโอน ${baht(total)}.-\nเช็คยอดในแอปธนาคารแล้วกดปุ่มด้านล่าง`;
  return confirmCard(text, `สลิปออเดอร์ ${code} ยอด ${baht(total)}.-`, code, total, userId);
}

function confirmCard(text: string, altText: string, code: string, total: number, userId: string) {
  const btn = (label: string, a2: "ok" | "bad", color: string) => ({
    type: "button",
    style: "primary",
    color,
    height: "sm",
    action: { type: "postback", label, data: encodePostback({ k: "adm", a: a2, c: code, u: userId, t: total }), displayText: `${label} (${code})` },
  });
  return {
    type: "flex" as const,
    altText,
    contents: {
      type: "bubble",
      body: { type: "box", layout: "vertical", contents: [{ type: "text", text, wrap: true, size: "sm" }] },
      footer: { type: "box", layout: "horizontal", spacing: "sm", contents: [btn("✅ ได้รับเงินแล้ว", "ok", "#06C755"), btn("❌ ยอดไม่ตรง", "bad", "#D32F2F")] },
    },
  };
}

export const ADDRESS_SENT_PREFIX = "📝 ส่งที่อยู่แล้ว";
export function addressSentText(code: string, total: number) {
  return `${ADDRESS_SENT_PREFIX} · ออเดอร์ ${code} · ยอด ${baht(total)}.-`;
}
export function parseAddressSent(text: string): { code: string; total: string } | null {
  const m = text.match(/^📝 ส่งที่อยู่แล้ว · ออเดอร์ (XR-[A-Z0-9]+) · ยอด ([\d,]+)\.-$/);
  return m ? { code: m[1], total: m[2] } : null;
}
