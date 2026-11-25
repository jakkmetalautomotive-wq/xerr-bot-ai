// จ่ายเงินง่ายขึ้น (QR พร้อมเพย์ + เลขบัญชีคัดลอกได้) · แบบฟอร์มที่อยู่สำหรับลูกค้า Facebook · ปุ่มยืนยันใต้รูปสลิป
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { _resetLocalState } from "../lib/state.ts";
import { handleEvent, type LinePort } from "../lib/bot.ts";
import { sampleSets } from "../lib/images.ts";
import { verifyOrder, decodePostback, signOrder, paymentMessage, withoutTtb } from "../lib/order.ts";
import { crc16, promptPayPayload } from "../lib/promptpay.ts";
import { toMetaMessages } from "../lib/meta.ts";

beforeEach(() => _resetLocalState());
afterEach(() => delete process.env.PROMPTPAY_ID);

function fakeLine() {
  const sent: { to: string; texts: any[] }[] = [];
  const line: LinePort = {
    reply: async (to, texts) => void sent.push({ to, texts }),
    push: async (to, texts) => void sent.push({ to, texts }),
    showLoading: async () => {},
    displayName: async () => "คุณทดสอบ",
  };
  return { line, sent };
}
const SECRET = "secret";
const PAY = "🏦 ชื่อบัญชี ร้านทดสอบ 🌐 KTB : 123-4-56789-0 🔵 TTB : 987-6-54321-0";
const ev = (message: any, userId: string) => ({ type: "message", source: { type: "user", userId }, replyToken: userId, message }) as any;
const pbEvent = (data: string, userId: string) => ({ type: "postback", source: { type: "user", userId }, replyToken: "rt-admin", postback: { data } }) as any;
const deps = (line: LinePort) => ({ line, adminUserId: "UADMIN", orderSecret: SECRET, paymentInfo: PAY, liffId: "LIFF1", photoWaitMs: 10, getFaq: async () => "faq", getImageSets: async () => sampleSets(), readPhoto: async () => null, cardPauseMs: 0 });
const taxOnly = "เลือกแบบที่ 1: รถยนต์ (กรอบป้ายภาษี พรบ. ขั้น 1 เลือกประเภทรถ)";

test("พร้อมเพย์: CRC ตามมาตรฐาน · เบอร์มือถือ/เลข 13 หลัก · ยอดเงิน · เลขผิด = ไม่สร้าง", () => {
  assert.equal(crc16("123456789"), "29B1"); // ค่าตรวจสอบมาตรฐานของ CRC-16/CCITT-FALSE
  const p = promptPayPayload("081-234-5678", 69)!;
  assert.match(p, /^000201010212/);
  assert.ok(p.includes("0016A000000677010111011300668123456785303764540569.005802TH6304"));
  assert.equal(p.slice(-4), crc16(p.slice(0, -4)));
  assert.ok(promptPayPayload("1234567890123", 419)!.includes("02131234567890123"));
  assert.equal(promptPayPayload("12345", 100), null);
  assert.equal(promptPayPayload("0812345678", 0), null);
});

const toUser = (sent: { to: string; texts: any[] }[], id: string) => sent.filter((x) => x.to === id).flatMap((x) => x.texts);

test("ลูกค้า Facebook สั่งซื้อ → สรุปยอดที่มีช่องทางชำระเงินในตัว (ไม่มีเลขเปล่า ๆ แยก) → ปุ่มกรอกที่อยู่ส่งทีหลัง", async () => {
  process.env.PROMPTPAY_ID = "0812345678";
  const { line, sent } = fakeLine();
  await handleEvent(ev({ type: "text", id: "t", text: taxOnly }, "fb:111"), deps(line));
  assert.equal(sent.filter((x) => x.to === "fb:111").length, 2); // ส่ง 2 รอบ: ปุ่มที่อยู่ตามหลังการ์ดธนาคาร
  const msgs = toUser(sent, "fb:111");
  assert.match(msgs[0], /สรุปรายการสั่งซื้อ/);
  assert.ok(msgs[0].includes("123-4-56789-0"));
  assert.ok(!msgs[0].includes("987-6-54321-0") && !/ttb/i.test(msgs[0])); // Messenger ไม่แสดง ttb
  assert.match(msgs[0], /กรุณาส่งสลิป/);
  assert.ok(!/กดค้างเพื่อคัดลอก/.test(msgs[0]));
  assert.match(msgs[0], /🌐 ธนาคารกรุงไทย : 123-4-56789-0/); // ชื่อเต็ม ไม่ใช่ KTB
  assert.equal(msgs[1].type, "image"); // QR เฉพาะตอนตั้ง PROMPTPAY_ID
  assert.ok(!msgs.includes("123-4-56789-0")); // ไม่ส่งเลขเปล่า ๆ แยก
  // ปุ่มคัดลอกเลขบัญชี → หน้า /copy (Messenger: ปุ่มลิงก์)
  const copyUri = new URL(JSON.stringify(msgs[2]).match(/"uri":"([^"]+)"/)![1]);
  assert.equal(copyUri.pathname, "/copy");
  assert.equal(copyUri.searchParams.get("n"), "123-4-56789-0");
  assert.equal(copyUri.searchParams.get("b"), "ธนาคารกรุงไทย");
  assert.equal(copyUri.searchParams.get("o"), "ร้านทดสอบ");
  const copyBtn = (toMetaMessages([msgs[2]]) as any[])[0].attachment.payload.buttons[0];
  assert.equal(copyBtn.type, "web_url");
  assert.equal(copyBtn.webview_height_ratio, "compact"); // แผ่นครึ่งจอ
  // ปุ่มคัดลอกส่งรอบหลัง (หลังการ์ดกรุงไทย) พร้อมปุ่มที่อยู่
  assert.deepEqual(sent.filter((x) => x.to === "fb:111").map((x) => x.texts.length), [2, 2]);
  const uri = JSON.stringify(msgs[3]).match(/"uri":"([^"]+)"/)![1];
  assert.match(uri, /\/order\?o=/);
  const order = verifyOrder(decodeURIComponent(uri.split("o=")[1]), SECRET)!;
  assert.equal(order.u, "fb:111");
  assert.equal(order.total, 69 + 15);
  const meta = toMetaMessages([msgs[3]]) as any[];
  assert.equal(meta[0].attachment.payload.template_type, "button");
  assert.equal(meta[0].attachment.payload.buttons[0].type, "web_url");
});

test("PAYMENT_INFO บรรทัดเดียว → ช่องทางชำระเงินขึ้นบรรทัดใหม่หน้า emoji แต่ละตัว", () => {
  assert.equal(
    paymentMessage("🏦 ชื่อบัญชี ร้านทดสอบ 🌐 KTB : 054-0-20552-4 🔵 TTB : 224-2-65761-3"),
    "💳 ช่องทางชำระเงิน\n🏦 ชื่อบัญชี ร้านทดสอบ\n🌐 ธนาคารกรุงไทย : 054-0-20552-4\n🔵 ธนาคารทหารไทยธนชาต (ttb) : 224-2-65761-3",
  );
  assert.equal(paymentMessage("กรุงไทย 1\nttb 2"), "💳 ช่องทางชำระเงิน\nกรุงไทย 1\nttb 2");
  assert.equal(paymentMessage(""), null);
  assert.equal(withoutTtb("🏦 ชื่อบัญชี ร้านทดสอบ 🌐 KTB : 054-0-20552-4 🔵 TTB : 224-2-65761-3"), "🏦 ชื่อบัญชี ร้านทดสอบ\n🌐 ธนาคารกรุงไทย : 054-0-20552-4");
});

test("ลูกค้า LINE ยังใช้แบบฟอร์ม LIFF เหมือนเดิม · ไม่ตั้ง PROMPTPAY_ID = ไม่ส่ง QR", async () => {
  const { line, sent } = fakeLine();
  await handleEvent(ev({ type: "text", id: "t", text: taxOnly }, "U1"), deps(line));
  const msgs = sent.find((s) => s.to === "U1")!.texts;
  assert.ok(!msgs.some((m: any) => m?.type === "image"));
  assert.match(JSON.stringify(msgs.at(-1)), /liff\.line\.me\/LIFF1/);
  assert.ok(!verifyOrder(decodeURIComponent(JSON.stringify(msgs.at(-1)).match(/o=([^"]+)/)![1]), SECRET)!.u);
});

test("ส่งสลิปหลังสรุปยอด → แอดมินได้รูป + ปุ่ม ✅/❌ · กด ✅ แจ้งลูกค้า Facebook ครั้งเดียว กดซ้ำไม่ส่งซ้ำ", async () => {
  const { line, sent } = fakeLine();
  const d = deps(line);
  await handleEvent(ev({ type: "text", id: "t", text: taxOnly }, "fb:111"), d);
  await handleEvent(ev({ type: "image", id: "i", contentProvider: { type: "external", originalContentUrl: "https://cdn.fb/slip.jpg" } }, "fb:111"), d);
  const admin = sent.filter((s) => s.to === "UADMIN").at(-1)!;
  assert.equal(admin.texts[1].type, "image");
  const card = admin.texts[2];
  assert.match(card.altText, /สลิปออเดอร์ XR-/);
  const okData = card.contents.footer.contents[0].action.data;
  assert.deepEqual({ ...decodePostback(okData), c: "" }, { k: "adm", a: "ok", c: "", u: "fb:111", t: 84 });

  sent.length = 0;
  await handleEvent(pbEvent(okData, "UADMIN"), d);
  await handleEvent(pbEvent(okData, "UADMIN"), d);
  assert.equal(sent.filter((s) => s.to === "fb:111").length, 1); // ลูกค้าได้การ์ดยืนยันครั้งเดียว
  assert.match(String(sent.at(-1)!.texts[0]), /ยืนยันรับเงินไปแล้ว/);

  // จ่ายแล้ว → ส่งรูปอีกก็ไม่มีปุ่มยืนยันแล้ว
  sent.length = 0;
  await handleEvent(ev({ type: "image", id: "j", contentProvider: { type: "external", originalContentUrl: "https://cdn.fb/x.jpg" } }, "fb:111"), d);
  assert.equal(sent.filter((s) => s.to === "UADMIN").at(-1)!.texts.length, 2);
});

test("ลิงก์ออเดอร์: u ต้องเป็นลูกค้า fb:/ig: เท่านั้น", () => {
  const t = signOrder({ code: "XR-1", product: "x", picks: [], tax: false, u: "U-line" }, SECRET);
  assert.equal(verifyOrder(t, SECRET)!.u, undefined);
});

test("ไม่ใช้พร้อมเพย์ (ไม่ตั้ง PROMPTPAY_ID) → ลูกค้า Facebook ไม่มี QR", async () => {
  const { line, sent } = fakeLine();
  await handleEvent(ev({ type: "text", id: "t", text: taxOnly }, "fb:222"), deps(line));
  const msgs = toUser(sent, "fb:222");
  assert.ok(!msgs.some((m: any) => m?.type === "image"));
  assert.ok(!/QR/.test(msgs[0]));
  assert.match(JSON.stringify(msgs[2]), /\/order\?o=/);
});

// ---------- Messenger ไม่มี Rich Menu: พิมพ์คำเมนูเปล่า ๆ ได้ ----------
import { isMenu } from "../lib/bot.ts";
import { MENU } from "../lib/shop.ts";

test("คำเมนูไม่มี emoji ('สั่งซื้อ', 'คุยกับแอดมิน') → ทำงานเหมือนกดปุ่ม · ประโยคอื่นไม่นับ", async () => {
  assert.ok(isMenu("สั่งซื้อ", MENU.order));
  assert.ok(isMenu(" 🛒 สั่งซื้อ ", MENU.order));
  assert.ok(isMenu("คุยกับแอดมิน", MENU.admin));
  assert.ok(!isMenu("อยากสั่งซื้อครับ", MENU.order));
  const { line, sent } = fakeLine();
  let asked = 0;
  await handleEvent(ev({ type: "text", id: "t", text: "สั่งซื้อ" }, "fb:333"), { ...deps(line), ask: async () => (asked++, { reply: "x", needsAdmin: false, adminNote: "" }) });
  assert.equal(asked, 0); // ไม่ต้องรอ AI
  assert.match(JSON.stringify(sent[0].texts), /เลือกประเภทสินค้า/);
});
