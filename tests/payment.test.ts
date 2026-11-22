// จ่ายเงินง่ายขึ้น (QR พร้อมเพย์ + เลขบัญชีคัดลอกได้) · แบบฟอร์มที่อยู่สำหรับลูกค้า Facebook · ปุ่มยืนยันใต้รูปสลิป
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { _resetLocalState } from "../lib/state.ts";
import { handleEvent, type LinePort } from "../lib/bot.ts";
import { sampleSets } from "../lib/images.ts";
import { verifyOrder, decodePostback, signOrder } from "../lib/order.ts";
import { crc16, promptPayPayload, accountNumber } from "../lib/promptpay.ts";
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
const PAY = "กสิกรไทย 123-4-56789-0\nชื่อบัญชี ร้านทดสอบ";
const ev = (message: any, userId: string) => ({ type: "message", source: { type: "user", userId }, replyToken: userId, message }) as any;
const pbEvent = (data: string, userId: string) => ({ type: "postback", source: { type: "user", userId }, replyToken: "rt-admin", postback: { data } }) as any;
const deps = (line: LinePort) => ({ line, adminUserId: "UADMIN", orderSecret: SECRET, paymentInfo: PAY, liffId: "LIFF1", photoWaitMs: 10, getFaq: async () => "faq", getImageSets: async () => sampleSets(), readPhoto: async () => null });
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
  assert.equal(accountNumber(PAY), "123-4-56789-0");
  assert.equal(accountNumber("ไม่มีเลข"), null);
});

test("ลูกค้า Facebook สั่งซื้อ → สรุปยอด + QR พร้อมเพย์ + เลขบัญชีแยก + ปุ่มกรอกที่อยู่ (หน้าเว็บ ผูกกับลูกค้าคนนี้)", async () => {
  process.env.PROMPTPAY_ID = "0812345678";
  const { line, sent } = fakeLine();
  await handleEvent(ev({ type: "text", id: "t", text: taxOnly }, "fb:111"), deps(line));
  const msgs = sent.find((s) => s.to === "fb:111")!.texts;
  assert.match(msgs[0], /สรุปรายการสั่งซื้อ/);
  assert.match(msgs[0], /สแกน QR พร้อมเพย์/);
  assert.match(msgs[0], /กดค้างเพื่อคัดลอก/);
  assert.equal(msgs[1].type, "image");
  assert.match(msgs[1].originalContentUrl, /\/api\/qr\?o=/);
  assert.equal(msgs[2], "123-4-56789-0");
  const uri = JSON.stringify(msgs[3]).match(/"uri":"([^"]+)"/)![1];
  assert.match(uri, /\/order\?o=/);
  assert.ok(!uri.includes("liff.line.me"));
  const order = verifyOrder(decodeURIComponent(uri.split("o=")[1]), SECRET)!;
  assert.equal(order.u, "fb:111");
  assert.equal(order.total, 69 + 15);

  // ใน Messenger: ปุ่มกรอกที่อยู่เป็นปุ่มลิงก์จริง ไม่ใช่ข้อความลิงก์ยาว ๆ
  const meta = toMetaMessages([msgs[3]]) as any[];
  assert.equal(meta[0].attachment.payload.template_type, "button");
  assert.equal(meta[0].attachment.payload.buttons[0].type, "web_url");
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
