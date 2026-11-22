// ลูกค้าส่งรูป + "มีแบบนี้ไหม" (บอทมองรูปไม่เห็น) · AI ห้ามข้ามขั้นเลือกแบบ → ตะกร้าไม่เพี้ยน
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { _resetLocalState } from "../lib/state.ts";
import { handleEvent, PHOTO_ASK_REPLY, type LinePort } from "../lib/bot.ts";
import { sampleSets, CATEGORY_SET } from "../lib/images.ts";
import { IMAGE_REPLY } from "../lib/shop.ts";

beforeEach(() => _resetLocalState());

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
const ev = (message: any, userId = "fb:111") => ({ type: "message", source: { type: "user", userId }, replyToken: userId, message }) as any;
const text = (t: string) => ev({ type: "text", id: "t", text: t });
const image = () => ev({ type: "image", id: "i", contentProvider: { type: "external", originalContentUrl: "https://cdn.fb/x.jpg" } });
const cardTitles = (msg: any) => JSON.stringify(msg);

function deps(line: LinePort, askCalls: string[] = []) {
  return {
    line,
    adminUserId: "UADMIN",
    orderSecret: "secret",
    photoWaitMs: 300,
    getFaq: async () => "faq",
    getImageSets: async () => sampleSets(),
    // AI เดาลายเอง + ข้ามไปขั้นเลือกขนาด (เหตุการณ์จริงใน Messenger)
    ask: async (_f: string, q: string) => (askCalls.push(q), { reply: "มีครับผม กรอบป้ายอะคริลิคลายเคฟล่า ดำ เลือกขนาดได้เลยครับ", needsAdmin: false, adminNote: "", showSet: "อะคริลิค ขั้น 2 เลือกขนาด" }),
  };
}

test("ข้อความ 'มีแบบนี้ไหม' มาก่อนรูป → ไม่ถาม AI · ตอบครั้งเดียวด้วยการ์ดเลือกประเภท · แอดมินได้รูป", async () => {
  const { line, sent } = fakeLine();
  const asked: string[] = [];
  const d = deps(line, asked);
  await Promise.all([handleEvent(text("มีแบบนี้ไหมครับ"), d), new Promise((r) => setTimeout(r, 50)).then(() => handleEvent(image(), d))]);
  const toCustomer = sent.filter((s) => s.to === "fb:111");
  assert.equal(asked.length, 0);
  assert.equal(toCustomer.length, 1);
  assert.equal(toCustomer[0].texts[0], PHOTO_ASK_REPLY);
  assert.match(cardTitles(toCustomer[0].texts[1]), new RegExp(CATEGORY_SET));
  assert.ok(!JSON.stringify(toCustomer).includes("เคฟล่า ดำ เลือกขนาด"));
  const admin = sent.find((s) => s.to === "UADMIN")!;
  assert.match(admin.texts[0], /รูปสินค้า/);
  assert.equal(admin.texts.length, 2); // ข้อความ + รูป
});

test("รูปมาก่อน 'มีแบบนี้ไหม' → ได้รับรูป แล้วตามด้วยการ์ดเลือกประเภท (ไม่เงียบเพราะช่วงพัก)", async () => {
  const { line, sent } = fakeLine();
  const asked: string[] = [];
  const d = deps(line, asked);
  await handleEvent(image(), d);
  await handleEvent(text("มีแบบนี้ไหมครับ"), d);
  const toCustomer = sent.filter((s) => s.to === "fb:111");
  assert.equal(asked.length, 0);
  assert.equal(toCustomer[0].texts[0], IMAGE_REPLY);
  assert.equal(toCustomer[1].texts[0], PHOTO_ASK_REPLY);
  assert.ok(sent.filter((s) => s.to === "UADMIN").some((s) => /ไม่ใช่สลิป/.test(s.texts[0])));
});

test("รูปอย่างเดียว (สลิป) → ตอบแบบเดิม", async () => {
  const { line, sent } = fakeLine();
  await handleEvent(image(), deps(line));
  assert.equal(sent.find((s) => s.to === "fb:111")!.texts[0], IMAGE_REPLY);
});

test("'มีแบบนี้ไหม' ไม่มีรูปตามมา → ถาม AI ตามปกติ แต่ AI ข้ามไปขั้น 2 ไม่ได้ → ส่งขั้น 1 เลือกสี + ข้อความกลาง", async () => {
  const { line, sent } = fakeLine();
  const asked: string[] = [];
  await handleEvent(text("มีแบบนี้ไหมครับ"), deps(line, asked));
  assert.equal(asked.length, 1);
  const [msg] = sent.filter((s) => s.to === "fb:111");
  assert.ok(!JSON.stringify(msg.texts).includes("เคฟล่า ดำ เลือกขนาด"));
  assert.match(JSON.stringify(msg.texts), /อะคริลิค ขั้น 1 เลือกสี/);
  assert.ok(!JSON.stringify(msg.texts).includes("อะคริลิค ขั้น 2 เลือกขนาด"));
});

test("กดเลือกสีจากการ์ดแล้ว AI ส่งชุดผิด → ระบบส่งขั้นถัดไปที่ถูก (ขนาด) พร้อมสีที่เลือกติดปุ่ม", async () => {
  const { line, sent } = fakeLine();
  const d = { ...deps(line), ask: async () => ({ reply: "รับทราบครับ", needsAdmin: false, adminNote: "", showSet: "อะคริลิค ขั้น 3 เลือกเส้นคาดกลาง" }) };
  await handleEvent(text("เลือกแบบที่ 7: ลายเคฟล่า ดำ มีเส้นขอบ (อะคริลิค ขั้น 1 เลือกสี)"), d);
  const out = JSON.stringify(sent.filter((s) => s.to === "fb:111"));
  assert.match(out, /อะคริลิค ขั้น 2 เลือกขนาด/);
  assert.match(out, /เลือกแล้ว: ลายเคฟล่า ดำ มีเส้นขอบ/);
});
