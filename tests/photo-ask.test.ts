// ลูกค้าส่งรูป + "มีแบบนี้ไหม" (บอทมองรูปไม่เห็น) · AI ห้ามข้ามขั้นเลือกแบบ → ตะกร้าไม่เพี้ยน
import { msgText } from "./helpers.ts";
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
  assert.match(admin.texts[0], /รูปกรอบป้าย ถามว่ามีแบบนี้ไหม/);
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
  assert.ok(sent.filter((s) => s.to === "UADMIN").some((s) => /ไม่ใช่สลิป/.test(msgText(s.texts[0]))));
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

// ---------- AI ดูรูป ----------
import { readPhoto, parsePhotoRead } from "../lib/vision.ts";

test("AI ดูรูปเป็นกรอบอะคริลิค (ไม่ได้พิมพ์อะไร) → การ์ดขั้น 1 เลือกสีของอะคริลิค · ไม่บอกลายเอง · แอดมินเห็นสิ่งที่ AI เห็น", async () => {
  const { line, sent } = fakeLine();
  const d = { ...deps(line), readPhoto: async () => ({ kind: "plate_frame" as const, product: "อะคริลิค", color: "ดำเรียบ", note: "กรอบสีดำพร้อมแผ่นหลัง" }) };
  await handleEvent(image(), d);
  const [msg] = sent.filter((s) => s.to === "fb:111");
  assert.match(msg.texts[0], /อะคริลิค/);
  assert.ok(!/ดำเรียบ/.test(JSON.stringify(msg.texts[0])));
  assert.match(JSON.stringify(msg.texts), /อะคริลิค ขั้น 1 เลือกสี/);
  const admin = sent.find((s) => s.to === "UADMIN")!;
  assert.match(admin.texts[0], /AI ดูรูปแล้ว: .*ดำเรียบ/);
});

test("AI ดูรูปเป็นสลิป → ตอบแบบเดิม + แจ้งแอดมินว่าเป็นสลิป · AI ล่ม → ตอบแบบเดิม", async () => {
  const { line, sent } = fakeLine();
  await handleEvent(image(), { ...deps(line), readPhoto: async () => ({ kind: "slip" as const, product: "", color: "", note: "สลิป 419 บาท" }) });
  assert.equal(sent.find((s) => s.to === "fb:111")!.texts[0], IMAGE_REPLY);
  assert.match(sent.find((s) => s.to === "UADMIN")!.texts[0], /สลิปโอนเงิน/);

  _resetLocalState();
  const b = fakeLine();
  await handleEvent(image(), { ...deps(b.line), readPhoto: async () => { throw new Error("boom"); } });
  assert.equal(b.sent.find((s) => s.to === "fb:111")!.texts[0], IMAGE_REPLY);
});

test("readPhoto: แนบรูปตัวอย่างของร้าน + รูปลูกค้า · ประเภทนอกรายการ → ว่าง · รุ่นแรกล่ม → ลองรุ่นถัดไป", async () => {
  const sets = sampleSets();
  const category = sets.find((s) => s.name === CATEGORY_SET)!;
  const fetchFn = (async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } })) as typeof fetch;
  const calls: any[] = [];
  const generate = (async (p: any) => {
    calls.push(p);
    if (calls.length === 1) throw new Error("503 UNAVAILABLE");
    return { text: JSON.stringify({ kind: "plate_frame", product: "อะคริลิค", color: "ลายเคฟล่าดำ", note: "x" }) };
  }) as any;
  const r = await readPhoto({ data: "AAAA", mimeType: "image/jpeg" }, category, { generate, fetchFn, models: ["m1", "m2"] });
  assert.deepEqual(r, { kind: "plate_frame", product: "อะคริลิค", color: "ลายเคฟล่าดำ", note: "x" });
  assert.deepEqual(calls.map((c) => c.model), ["m1", "m2"]);
  const parts = calls[1].contents[0].parts;
  assert.equal(parts.filter((p: any) => p.inlineData).length, category.items.length + 1);
  assert.equal(parts.at(-1).inlineData.data, "AAAA");

  assert.equal(parsePhotoRead(JSON.stringify({ kind: "plate_frame", product: "ทอง", color: "", note: "" }), ["อะคริลิค"])?.product, "");
  assert.equal(parsePhotoRead(JSON.stringify({ kind: "slip", product: "อะคริลิค", color: "", note: "" }), ["อะคริลิค"])?.product, "");
  assert.equal(parsePhotoRead("oops", []), null);
});
