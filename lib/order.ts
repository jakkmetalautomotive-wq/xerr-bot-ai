// ออเดอร์: คิดยอดด้วยโค้ด (ไม่ใช้ AI) · ข้อมูลออเดอร์เซ็นกำกับกันแก้ไข · ไม่ต้องมีฐานข้อมูล
// ข้อมูลออเดอร์ติดไปกับปุ่ม / ลิงก์แบบฟอร์ม / ปุ่มของแอดมิน ทุกขั้น
import crypto from "node:crypto";
import { stepOf, CATEGORY_SET, CARD_THEME, baseUrl, type ImageSet } from "./images.ts";
import { SHIPPING, TAX_CAR } from "./shop.ts";

export type OrderDraft = { code: string; product: string; picks: string[]; tax: boolean };
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
    return { code: d.code, product: d.product, picks: d.picks.map(String), tax: Boolean(d.tax), total: typeof d.total === "number" ? d.total : undefined };
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
export function orderSummaryText(o: PricedOrder, paymentInfo: string, hasForm: boolean): string {
  const pay = paymentInfo.trim()
    ? `เมื่อ Confirm สินค้าแล้ว สามารถโอนชำระได้เลยนะครับ\n\n${paymentInfo.trim()}\n‼️กรุณาส่งสลิปโอนเงินมาในแชตด้วยนะครับ ‼️`
    : "เดี๋ยวแอดมินส่งเลขบัญชีให้นะครับ";
  const address = hasForm
    ? "🚚 กดปุ่ม \"กรอกชื่อ-ที่อยู่จัดส่ง\" ด้านล่างได้เลยครับ"
    : "🚚 รบกวนแจ้งชื่อที่อยู่สำหรับจัดส่ง\n👤 ชื่อ :\n📞 เบอร์ :\n📦 ที่อยู่จัดส่ง :";
  return [
    `📍สรุปรายการสั่งซื้อ (ออเดอร์ ${o.code})`,
    orderLines(o),
    "*ไม่มีเก็บปลายทาง*",
    "",
    pay,
    "",
    address,
    "",
    "🚚 การจัดส่งสินค้า",
    "✂️ ตัดรอบส่ง เที่ยง",
    "🗓 ส่ง ทุกวัน จันทร์-เสาร์",
    "",
    "ขอบคุณที่อุดหนุนครับ 🙏",
  ].join("\n");
}

// ---------- ปุ่ม (postback) ----------
export type Postback =
  | { k: "tax"; y: 0 | 1; p: string; s: string[] }
  | { k: "adm"; a: "ok" | "bad"; c: string; u: string; t: number };

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
  } catch {}
  return null;
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
export function addressButtonMessage(liffId: string, token: string) {
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
            action: { type: "uri", label: "กรอกชื่อ-ที่อยู่จัดส่ง", uri: `https://liff.line.me/${liffId}?o=${encodeURIComponent(token)}` },
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
    `LINE: ${customerName || "-"}`,
    "",
    "ลูกค้าจะส่งสลิปในแชท · เช็คยอดในแอปธนาคารแล้วกดปุ่มด้านล่าง",
  ].join("\n");
  const btn = (label: string, a2: "ok" | "bad", color: string) => ({
    type: "button",
    style: "primary",
    color,
    height: "sm",
    action: { type: "postback", label, data: encodePostback({ k: "adm", a: a2, c: o.code, u: userId, t: o.total }), displayText: `${label} (${o.code})` },
  });
  return {
    type: "flex" as const,
    altText: `ออเดอร์ ${o.code} ยอด ${baht(o.total)}.- รอเช็คยอดโอน`,
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
