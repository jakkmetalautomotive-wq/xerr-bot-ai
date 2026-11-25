// ลูกค้าทำสลับลำดับ (ส่งสลิปก่อนกรอกที่อยู่) · ใบปะหน้าออกเมื่อครบทั้งที่อยู่ + ยืนยันสลิป · เลขบัญชีระบุธนาคาร
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleEvent, type LinePort } from "../lib/bot.ts";
import { sampleSets } from "../lib/images.ts";
import { addressButtonMessage, addressSentText, encodePostback, FORM_BUTTON, formatPaymentInfo, parseAddressSent, validateAddress, type PricedOrder } from "../lib/order.ts";
import { bankAccounts } from "../lib/promptpay.ts";
import { labelFromOrder, labelHtml, saveLabel, signLabel, verifyLabel } from "../lib/label.ts";
import { addressAdminMessages, addressChanged, addressReplies, orderStage, parseLabelRequest } from "../lib/order-stage.ts";
import { toMetaMessages } from "../lib/meta.ts";
import { getSlipImage, readSlipUpload, saveSlipImage, uploadedSlipMessage, verifySlipImage } from "../lib/slip-upload.ts";
import { memoryStore } from "../lib/state.ts";

const PAY = "🏦 ชื่อบัญชี ร้านทดสอบ 🌐 KTB : 123-4-56789-0 🔵 TTB : 987-6-54321-0";
const ADDR = { name: "สมชาย ทดสอบ", phone: "0812345678", address: "1/2 ถ.ทดสอบ แขวงทดสอบ เขตทดสอบ กทม", zip: "10100", note: "" };
const slipRead = { kind: "slip", product: "", color: "", note: "" } as const;

function setup(readPhoto: any = async () => slipRead) {
  const sent: { to: string; texts: any[] }[] = [];
  const line: LinePort = {
    reply: async (to, texts) => void sent.push({ to, texts }),
    push: async (to, texts) => void sent.push({ to, texts }),
    showLoading: async () => {},
    displayName: async () => "Jan",
  };
  const state = memoryStore();
  const deps = { line, state, adminUserId: "UADMIN", orderSecret: "secret", paymentInfo: PAY, liffId: "LIFF1", photoWaitMs: 10, getFaq: async () => "faq", getImageSets: async () => sampleSets(), readPhoto, logOrder: async () => true, ask: async () => ({ reply: "AI", needsAdmin: false, adminNote: "" }) };
  const say = (text: string, userId = "U1") => handleEvent({ type: "message", source: { type: "user", userId }, replyToken: userId, message: { type: "text", id: "t", text } } as any, deps);
  const photo = () => handleEvent({ type: "message", source: { type: "user", userId: "U1" }, replyToken: "U1", message: { type: "image", id: "i", contentProvider: { type: "line" } } } as any, deps);
  const admin = (c: string, a: "ok" | "bad" = "ok") => handleEvent({ type: "postback", source: { type: "user", userId: "UADMIN" }, replyToken: "UADMIN", postback: { data: encodePostback({ k: "adm", a, c, u: "U1", t: 84 }) } } as any, deps);
  const to = (id: string) => sent.filter((x) => x.to === id).flatMap((x) => x.texts);
  return { sent, state, say, photo, admin, to };
}

async function order(s: ReturnType<typeof setup>): Promise<PricedOrder> {
  await s.say("เลือกแบบที่ 1: รถยนต์ (กรอบป้ายภาษี พรบ. ขั้น 1 เลือกประเภทรถ)");
  const code = s.to("U1")[0].match(/XR-[A-Z0-9]+/)[0];
  return { code, product: "กรอบป้ายภาษี พรบ.", picks: ["รถยนต์"], tax: false, productLabel: "กรอบป้ายภาษี พรบ.", base: 69, taxPrice: 0, shipping: 15, total: 84 };
}

test("ส่งสลิปก่อน แล้วกรอกที่อยู่ → ไม่ขอสลิปซ้ำ · การ์ดแอดมินบอกว่ามีสลิปแล้ว", async () => {
  const s = setup();
  const o = await order(s);
  await s.photo();
  await s.say(addressSentText(o.code, 84));
  const last = s.to("U1").at(-1);
  assert.match(last, /รับที่อยู่และสลิปแล้ว/);
  assert.ok(!/โอนยอด/.test(last));
  const [card] = addressAdminMessages(await orderStage(s.state, o.code), o, ADDR, "Jan", "U1", "secret") as any[];
  assert.match(card.contents.body.contents[0].text, /ลูกค้าส่งสลิปมาแล้ว/);
  assert.equal(card.contents.footer.contents.length, 2);
});

test("สลิป → แอดมินกด ✅ → กรอกที่อยู่ทีหลัง: ใบปะหน้าส่งให้แอดมินทันที ไม่มีปุ่มยืนยันซ้ำ · ลูกค้าไม่ถูกขอสลิป", async () => {
  const s = setup();
  const o = await order(s);
  await s.photo();
  await s.admin(o.code);
  assert.match(s.to("UADMIN").at(-1), /ยังไม่ได้กรอกแบบฟอร์มที่อยู่/);
  await saveLabel(s.state, labelFromOrder(o, ADDR));
  const msgs = addressAdminMessages(await orderStage(s.state, o.code), o, ADDR, "Jan", "U1", "secret") as any[];
  assert.equal(typeof msgs[0], "string");
  assert.match(msgs[0], /สมชาย ทดสอบ/);
  assert.match(msgs[1], new RegExp(`ใบปะหน้า ${o.code}`));
  await s.say(addressSentText(o.code, 84));
  const [text, card] = s.to("U1").slice(-2);
  assert.match(text, /ข้อมูลครบแล้ว/);
  assert.ok(!/สลิป/.test(text));
  assert.match(card.altText, /เช็คที่อยู่จัดส่ง/);
  // กด ✅ ซ้ำ → ลูกค้าไม่ได้ข้อความซ้ำ แต่แอดมินได้ใบปะหน้า
  const before = s.to("U1").length;
  await s.admin(o.code);
  assert.equal(s.to("U1").length, before);
  assert.match(s.to("UADMIN").at(-1), new RegExp(`ใบปะหน้า ${o.code}`));
});

test("ลำดับปกติ (ที่อยู่ก่อน) → ยังขอสลิปเหมือนเดิม · รูปอื่นที่ไม่ใช่สลิปไม่นับ · AI ดูรูปไม่ได้นับเป็นสลิป", async () => {
  const s = setup(async () => ({ ...slipRead, kind: "other" }));
  const o = await order(s);
  await s.say(addressSentText(o.code, 84));
  assert.match(s.to("U1").at(-1), /โอนยอด 84\.- แล้วส่งสลิป/);
  await s.photo();
  assert.equal(await orderStage(s.state, o.code), "wait");
  const t = setup(async () => null);
  const p = await order(t);
  await t.photo();
  assert.equal(await orderStage(t.state, p.code), "slip");
});

test("แอดมินกด ❌ ยอดไม่ตรง → กลับไปรอสลิปใหม่", async () => {
  const s = setup();
  const o = await order(s);
  await s.photo();
  await s.admin(o.code, "bad");
  assert.equal(await orderStage(s.state, o.code), "wait");
});

test("แอดมินพิมพ์ขอใบปะหน้า → ได้ลิงก์ · ไม่มีที่อยู่/ไม่ใส่รหัส → บอก · ลูกค้าพิมพ์ไม่ได้", async () => {
  assert.deepEqual(parseLabelRequest("(XR-FW3T) ขอใบประหน้าออร์เดอร์นี้ด้วยครับ"), ["XR-FW3T"]);
  assert.deepEqual(parseLabelRequest("ใบปะหน้า xr-ab12"), ["XR-AB12"]);
  assert.deepEqual(parseLabelRequest("XR-FW3T"), ["XR-FW3T"]); // พิมพ์แค่รหัสก็ได้
  assert.deepEqual(parseLabelRequest("(xr-fw3t)"), ["XR-FW3T"]);
  assert.equal(parseLabelRequest("XR-AB12 SPXTH0123456789"), null); // ใส่เลขพัสดุ
  assert.equal(parseLabelRequest("XR-AB12 ได้ของยัง"), null);
  const s = setup();
  const o = await order(s);
  await saveLabel(s.state, labelFromOrder(o, ADDR));
  await s.say(`(${o.code}) ขอใบประหน้าออร์เดอร์นี้ด้วยครับ`, "UADMIN");
  assert.match(s.to("UADMIN").at(-1), /\/api\/label\?t=/);
  assert.match(s.to("UADMIN").at(-1), /ยังไม่พบว่ากด ✅/);
  await s.say("ใบปะหน้า XR-ZZZZ", "UADMIN");
  assert.match(s.to("UADMIN").at(-1), /ยังไม่มีที่อยู่ของ XR-ZZZZ/);
  await s.say("ขอใบปะหน้า", "UADMIN");
  assert.match(s.to("UADMIN").at(-1), /พิมพ์รหัสออเดอร์/);
  await s.say(`ใบปะหน้า ${o.code}`, "U1");
  assert.ok(!JSON.stringify(s.to("U1")).includes("/api/label"));
});

test("เลขบัญชีใน LINE: การ์ดเดียว ระบุชื่อธนาคารทุกบัญชี ปุ่มคัดลอกได้เฉพาะตัวเลข", async () => {
  assert.deepEqual(bankAccounts(formatPaymentInfo(PAY)), [
    { bank: "ธนาคารกรุงไทย", number: "123-4-56789-0" },
    { bank: "ธนาคารทหารไทยธนชาต (ttb)", number: "987-6-54321-0" },
  ]);
  // รูปแบบอื่นที่อาจตั้งใน Vercel
  assert.deepEqual(bankAccounts("ชื่อบัญชี ร้านทดสอบ\nกรุงไทย เลขบัญชี 123-4-56789-0\nttb\n987-6-54321-0"), [
    { bank: "กรุงไทย", number: "123-4-56789-0" },
    { bank: "ttb", number: "987-6-54321-0" },
  ]);
  assert.deepEqual(bankAccounts("ไม่มีเลข"), []);
  const s = setup();
  await order(s);
  const msgs = s.to("U1");
  assert.ok(!msgs.includes("123-4-56789-0")); // ไม่มีข้อความเลขเปล่า ๆ แล้ว
  const card = JSON.stringify(msgs.find((m: any) => /เลขบัญชีสำหรับโอน/.test(m?.altText ?? "")));
  assert.match(card, /ธนาคารกรุงไทย.*123-4-56789-0.*"clipboardText":"1234567890".*ธนาคารทหารไทยธนชาต \(ttb\).*987-6-54321-0/);
});

test("กรอกที่อยู่เสร็จ → ลูกค้าได้ใบปะหน้าให้เช็ค + ปุ่มแก้ไข · รหัสออเดอร์ของคนอื่นไม่เห็นที่อยู่", async () => {
  const s = setup();
  const o = await order(s);
  const form = "https://liff.line.me/LIFF1?o=tok";
  await saveLabel(s.state, labelFromOrder(o, ADDR, 0, { user: "U1", form }));
  await s.say(addressSentText(o.code, 84));
  const card = s.to("U1").at(-1);
  const json = JSON.stringify(card);
  for (const t of ["สมชาย ทดสอบ", "081-234-5678", "10100", "จัดส่งแล้วจะแก้ไขไม่ได้", form]) assert.ok(json.includes(t), t);
  assert.ok(!/หมายเหตุ/.test(json)); // ไม่มีหมายเหตุ → ไม่มีช่องว่าง
  const uri = new URL(card.contents.footer.contents[0].action.uri);
  assert.equal(verifyLabel(uri.searchParams.get("c")!, "secret", "check"), o.code);
  assert.equal(verifyLabel(uri.searchParams.get("c")!, "secret"), null); // เปิดหน้าพิมพ์ของร้านไม่ได้
  assert.equal(verifyLabel(signLabel(o.code, "secret"), "secret", "check"), null);

  // คนอื่นพิมพ์ข้อความเลียนแบบด้วยรหัสนี้ → ไม่ได้ที่อยู่
  await s.say(addressSentText(o.code, 84), "U2");
  assert.ok(!JSON.stringify(s.to("U2")).includes("สมชาย"));
  assert.equal((await addressReplies(s.state, o.code, "84", "U2", "secret")).length, 1);

  // Messenger: ข้อความ + ปุ่มลิงก์ 2 ปุ่ม
  const [m] = toMetaMessages([card]) as any[];
  assert.equal(m.attachment.payload.buttons.length, 2);
  assert.match(m.attachment.payload.text, /จัดส่งแล้วจะแก้ไขไม่ได้/);
});

test("ลูกค้าแก้ที่อยู่ → แอดมินได้คำเตือนให้ทิ้งใบเก่า · กรอกซ้ำข้อมูลเดิมไม่เตือน", () => {
  const o: PricedOrder = { code: "XR-AB12", product: "x", picks: [], tax: false, productLabel: "x", base: 69, taxPrice: 0, shipping: 15, total: 84 };
  const a = labelFromOrder(o, ADDR, 0);
  assert.equal(addressChanged(null, a), false);
  assert.equal(addressChanged(a, labelFromOrder(o, ADDR, 99, { user: "U1" })), false);
  assert.equal(addressChanged(a, labelFromOrder(o, { ...ADDR, zip: "10150" }, 99)), true);
  const msgs = addressAdminMessages("paid", o, ADDR, "Jan", "U1", "secret", true) as string[];
  assert.match(msgs[0], /แก้ที่อยู่.*ให้ทิ้ง/);
  assert.match(msgs[2], /ใบปะหน้า XR-AB12/);
});

test("หน้าเช็คที่อยู่ของลูกค้า: ไม่มีปุ่มพิมพ์ ไม่มีคำว่าชำระเงินแล้ว · หน้าของร้านเหมือนเดิม", () => {
  const o: PricedOrder = { code: "XR-AB12", product: "x", picks: [], tax: false, productLabel: "x", base: 69, taxPrice: 0, shipping: 15, total: 84 };
  const d = labelFromOrder(o, ADDR, 0);
  const c = labelHtml(d, undefined, true);
  assert.match(c, /จัดส่งแล้วจะแก้ไขไม่ได้/);
  assert.ok(!/window\.print|ชำระเงินแล้ว/.test(c));
  const shop = labelHtml(d);
  assert.match(shop, /window\.print/);
  assert.match(shop, /ชำระเงินแล้ว/);
  assert.ok(!/แก้ไขไม่ได้/.test(shop));
});

test("สลิปแนบในแบบฟอร์ม: รับเฉพาะรูปจริง ย่อ เก็บ และลิงก์มีลายเซ็น", async () => {
  const sharp = (await import("sharp")).default;
  const png = await sharp({ create: { width: 2000, height: 3000, channels: 3, background: "#7b4bd1" } }).png().toBuffer();
  const img = (await readSlipUpload(`data:image/png;base64,${png.toString("base64")}`))!;
  const meta = await sharp(img).metadata();
  assert.equal(meta.format, "jpeg");
  assert.ok(meta.height! <= 1600 && img.length <= 600_000);
  for (const bad of [undefined, 5, "", "data:text/html;base64,PGI+", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,aGVsbG8=", `data:image/png;base64,${"A".repeat(4_000_001)}`]) assert.equal(await readSlipUpload(bad), null);

  const state = memoryStore();
  const id = await saveSlipImage(state, "XR-AB12", img);
  assert.deepEqual(await getSlipImage(state, id), img);
  const token = new URL(uploadedSlipMessage(id, "secret").originalContentUrl).searchParams.get("u")!;
  assert.equal(verifySlipImage(token, "secret"), id);
  assert.equal(verifySlipImage(token, "other"), null);
  assert.equal(verifySlipImage(token.replace("AB12", "AB13"), "secret"), null);
});

test("แนบสลิปในแบบฟอร์ม → แอดมินได้รูป + การ์ดมีปุ่มครั้งเดียว · ข้อความยืนยันจากฟอร์มอ่านออกทั้งสองแบบ", () => {
  const o: PricedOrder = { code: "XR-AB12", product: "x", picks: [], tax: false, productLabel: "x", base: 69, taxPrice: 0, shipping: 15, total: 84 };
  const msgs = addressAdminMessages("slip", o, ADDR, "Jan", "U1", "secret", false, uploadedSlipMessage("XR-AB12-0123456789", "secret")) as any[];
  assert.deepEqual(msgs.map((m) => m.type), ["image", "flex"]);
  for (const withSlip of [true, false]) assert.deepEqual(parseAddressSent(addressSentText("XR-AB12", 84, withSlip)), { code: "XR-AB12", total: "84" });
});

test("การ์ดแจ้งที่อยู่: ข้อความใหม่ · ชื่อปุ่มไม่เกิน 20 ตัวอักษร (Messenger) · ตัดรหัสไปรษณีย์ซ้ำ", () => {
  assert.ok(FORM_BUTTON.length <= 20);
  const json = JSON.stringify(addressButtonMessage("https://x.test"));
  assert.match(json, /แจ้งชื่อ-ที่อยู่ พร้อมสลิปหลังชำระเงิน/);
  const v = validateAddress({ ...ADDR, address: "82/267 ซอยเอกชัย 10 กรุงเทพมหานคร เขตจอมทอง 10150", zip: "10150" });
  assert.ok(v.ok && v.value.address === "82/267 ซอยเอกชัย 10 กรุงเทพมหานคร เขตจอมทอง");
});
