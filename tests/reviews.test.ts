import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { _resetLocalState } from "../lib/state.ts";
import { memoryStore } from "../lib/state.ts";
import { parseReviewQuery, pickReviews, toReviewPhotos, reviewMessages, loadReviewFiles, _resetReviewMemo, reviewOrderCard, soldPhotos, isSold, type DriveFile } from "../lib/reviews.ts";
import type { ImageSet } from "../lib/images.ts";
import { encodePostback } from "../lib/order.ts";
import { REVIEW_TAGS } from "../lib/review-tags.ts";
import { handleEvent, type LinePort } from "../lib/bot.ts";
beforeEach(() => {
  _resetLocalState();
  _resetReviewMemo();
});

const f = (id: string, model: string, product: string, name = `${id}.png`): DriveFile => ({ id, name, path: [model, product] });
const files: DriveFile[] = [
  f("fort1", "Toyota Fortuner", "Acrylic License Plate Frame - Black"),
  f("fort2", "Toyota Fortuner", "Acrylic License Plate Frame - Sin City Black and Gold"),
  f("altis1", "Toyota Corolla Altis", "Acrylic License Plate Frame - Black Carbon Pattern"),
  f("yc1", "Toyota Yaris Cross", "Door Sill Plates - Stainless Steel"),
  f("ativ1", "Toyota Yaris Ativ", "Acrylic License Plate Frame - Black"),
  f("city1", "Honda City", "Acrylic License Plate Frame - Black"),
  f("unk1", "Vehicle - Model Unknown", "Acrylic License Plate Frame - Black"),
  f("tax1", "Vehicle - Model Unknown", "Tax Disc Holder - Clear Acrylic"),
  f("bad1", "Toyota Fortuner", "Acrylic License Plate Frame - White"),
];
const tags = {
  "fort1.png": { size: "S" as const, bar: "Y" as const },
  "ativ1.png": { size: "S" as const, bar: "N" as const },
  "city1.png": { size: "L" as const, bar: "Y" as const },
  "bad1.png": { skip: "bad" },
};
const photos = toReviewPhotos(files, tags);

test("แปลงรายชื่อไฟล์ Drive: ไม่เอากันรอยประตู + รูปที่ติดป้ายไม่ส่ง · รุ่นไม่รู้ = model null · ลายภาษาไทย", () => {
  assert.deepEqual(photos.map((p) => p.id), ["fort1", "fort2", "altis1", "ativ1", "city1", "unk1", "tax1"]);
  const [fort1, fort2, altis1] = photos;
  assert.equal(fort1.label, "ลายเรียบดำ");
  assert.equal(fort2.family, "sincity");
  assert.equal(altis1.family, "carbon");
  assert.equal(photos.find((p) => p.id === "unk1")!.model, null);
  assert.equal(photos.find((p) => p.id === "tax1")!.family, "tax");
});

test("อ่านคำถาม: รุ่นรถไทย/อังกฤษ · ลาย · เส้นคาดกลาง · ตัวสั้น/ยาว · ถามราคาไม่ใช่รีวิว", () => {
  assert.deepEqual(parseReviewQuery("อยากดูรีวิว Toyota Fortuner"), { model: "Toyota Fortuner" });
  assert.deepEqual(parseReviewQuery("มีรีวิวอัลติสไหมครับ"), { model: "Toyota Corolla Altis" });
  assert.equal(parseReviewQuery("ขอดูรีวิว yaris cross")!.model, "Toyota Yaris Cross");
  assert.equal(parseReviewQuery("รีวิว ยาริส เอทีฟ")!.model, "Toyota Yaris Ativ");
  assert.equal(parseReviewQuery("ขอดูรูปติด d-max หน่อย")!.model, "Isuzu D-Max");
  assert.deepEqual(parseReviewQuery("ขอดูกรอบป้ายเรียบดำตัวสั้นมีเส้นคาดกลาง"), { family: "plain", color: "black", bar: "Y", size: "S" });
  assert.deepEqual(parseReviewQuery("ขอดูตัวยาวไม่มีเส้นคาดกลาง"), { bar: "N", size: "L" });
  assert.equal(parseReviewQuery("ขอดูลาย sin city")!.family, "sincity");
  assert.equal(parseReviewQuery("ขอดูลาย sin city")!.model, undefined, "city ใน sin city ไม่ใช่ Honda City");
  assert.equal(parseReviewQuery("ขอดูราคา fortuner"), null);
  assert.equal(parseReviewQuery("กรอบเคฟล่าราคาเท่าไหร่"), null);
  assert.equal(parseReviewQuery("สวัสดีครับ"), null);
  assert.deepEqual(parseReviewQuery("ขอดูรีวิวหน่อยครับ"), {});
});

test("เลือกรูป: ตรงทุกข้อ · ไม่มีขนาดที่ขอ → ผ่อน · รุ่นไม่มีกรอบป้าย → ยี่ห้อเดียวกัน", () => {
  const a = pickReviews(photos, { model: "Toyota Fortuner" });
  assert.deepEqual(a.photos.map((p) => p.id), ["fort1", "fort2"]);
  assert.deepEqual(a.relaxed, []);

  const b = pickReviews(photos, { model: "Toyota Fortuner", size: "L" });
  assert.deepEqual(b.relaxed, ["ตัวยาว"]);
  assert.deepEqual(b.photos.map((p) => p.id), ["fort1", "fort2"]);

  const c = pickReviews(photos, { model: "Toyota Yaris Cross" }); // มีแต่กันรอยประตู
  assert.ok(c.relaxed.includes("Toyota Yaris Cross"));
  assert.ok(c.photos.every((p) => p.brand === "Toyota"));

  const d = pickReviews(photos, { family: "plain", color: "black", bar: "Y", size: "S" });
  assert.deepEqual(d.photos.map((p) => p.id), ["fort1"]);

  const e = pickReviews(photos, { family: "tax" });
  assert.deepEqual(e.photos.map((p) => p.id), ["tax1"]);

  const msgs = reviewMessages(c);
  assert.match(String(msgs[0]), /ยังไม่มีรูปรีวิว Toyota Yaris Cross/);
  assert.match(String(msgs[0]), /🔒 ทางร้านใช้ระบบ AI เปลี่ยนเลขทะเบียนในรูปแล้ว เพื่อความปลอดภัยและความเป็นส่วนตัวของลูกค้าทุกท่านครับ$/);
  const card = (msgs[1] as any).contents.contents[0];
  assert.match(card.hero.url, /\/api\/img\?id=/);
  const btn = card.footer.contents[0].action;
  assert.equal(btn.type, "postback");
  assert.equal(btn.label, "🛒 สั่งลายนี้");
});

test("รายชื่อรูปจาก Drive จำไว้ 30 นาที · Apps Script ล่ม → ใช้รายชื่อเก่า", async () => {
  const state = memoryStore();
  let calls = 0;
  const ok = async () => (calls++, files);
  assert.equal((await loadReviewFiles(state, ok, 0)).length, files.length);
  await loadReviewFiles(state, ok, 10 * 60_000);
  assert.equal(calls, 1, "ยังไม่ครบ 30 นาที ไม่ดึงใหม่");
  const down = async () => null;
  assert.equal((await loadReviewFiles(state, down, 60 * 60_000)).length, files.length);
});

test("ลูกค้าพิมพ์ \"รีวิว Fortuner\" → ข้อความ + การ์ดรูป (ไม่เรียก AI)", async () => {
  const sent: any[] = [];
  const line: LinePort = { reply: async (_t, m) => void sent.push(m), push: async () => {}, showLoading: async () => {}, displayName: async () => "" };
  await handleEvent({ type: "message", source: { type: "user", userId: "U1" }, replyToken: "rt", message: { type: "text", text: "อยากดูรีวิว Fortuner ครับ" } } as any, {
    line, adminUserId: "UADMIN", getImageSets: async () => [], getReviewPhotos: async () => photos, ask: async () => { throw new Error("ไม่ควรเรียก AI"); },
  });
  assert.match(sent[0][0], /รีวิวจากลูกค้าจริง Toyota Fortuner — 2 รูป/);
  assert.equal(sent[0][1].contents.contents.length, 2);
});

test("ไฟล์ข้อมูลรูป: รูปที่ติดป้ายว่าไม่ส่งมีเหตุผล · ขนาด/เส้นคาดกลางเป็นค่าที่รู้จัก", () => {
  for (const [name, t] of Object.entries(REVIEW_TAGS)) {
    if (t.skip) assert.match(t.skip, /^(bad|dup|person)$/, name);
    if (t.size) assert.match(t.size, /^[SL]$/, name);
    if (t.bar) assert.match(t.bar, /^[YN]$/, name);
  }
});

// ชื่อการ์ดจริงในชีท (21 พ.ย. 2026)
const card = (name: string, items: string[]): ImageSet => ({ name, items: items.map((n, i) => ({ order: i + 1, name: n, price: "199.-", image: "", detail: "" })) });
const liveSets: ImageSet[] = [
  card("เลือกประเภทสินค้า", ["อะคริลิค", "สแตนเลส", "เหล็กพ่นสี", "พลาสติก ABS", "ไร้ขอบ", "รถตู้/บรรทุก", "กรอบป้ายภาษี พรบ."]),
  card("อะคริลิค ขั้น 1 เลือกสี", ["สีดำ มีเส้นขอบ", "สีดำ ไร้เส้นขอบ", "สีขาว มีเส้นขอบ", "สีขาว ไร้เส้นขอบ", "สีเทา มีเส้นขอบ", "สีเทา ไร้เส้นขอบ", "ลายเคฟล่า ดำ มีเส้นขอบ", "สีขาว เส้นขอบเขียว", "สีขาว เส้นขอบน้ำเงิน"]),
  card("สแตนเลส ขั้น 1 เลือกทรง", ["สี่เหลี่ยมขอบใหญ่", "สี่เหลี่ยมขอบเล็ก", "คางหมู"]),
  card("เหล็กพ่นสี ขั้น 1 เลือกสี", ["สีขาว", "สีดำ"]),
  card("กรอบป้ายภาษี พรบ. ขั้น 1 เลือกประเภทรถ", ["รถยนต์", "มอเตอร์ไซค์"]),
];

test("กด \"สั่งลายนี้\" ใต้รูปรีวิว → การ์ดลายนั้นใบเดียว · หาไม่เจอ → ทั้งขั้นแรกของสินค้า", () => {
  const one = (f: string, c?: string, b = false) => reviewOrderCard(liveSets, f, c, b)!;
  assert.deepEqual(one("plain", "black").set.items.map((i) => i.name), ["สีดำ มีเส้นขอบ"]);
  assert.deepEqual(one("plain", "black", true).set.items.map((i) => i.name), ["สีดำ ไร้เส้นขอบ"]);
  assert.deepEqual(one("plain", "white").set.items.map((i) => i.name), ["สีขาว มีเส้นขอบ"]);
  assert.deepEqual(one("plain", "gray").set.items.map((i) => i.name), ["สีเทา มีเส้นขอบ"]);
  assert.deepEqual(one("carbon", "black").set.items.map((i) => i.name), ["ลายเคฟล่า ดำ มีเส้นขอบ"]);
  assert.deepEqual(one("steel", "black").set.items.map((i) => i.name), ["สีดำ"]);
  assert.equal(one("plain", "black").set.name, "อะคริลิค ขั้น 1 เลือกสี", "ชื่อชุดเดิม → ปุ่มบนการ์ดยังเลือกต่อได้");
  assert.equal(one("plain", "red").exact, false); // ไม่มีสีแดงในชีท → ทุกแบบของอะคริลิค
  assert.equal(one("plain", "red").set.items.length, 9);
  assert.equal(one("sincity", "black").exact, false);
  assert.equal(one("stainless").set.items.length, 3);
  assert.deepEqual(one("undercut").set.items.map((i) => i.name), ["ไร้ขอบ"]);
  assert.equal(one("tax").set.name, "กรอบป้ายภาษี พรบ. ขั้น 1 เลือกประเภทรถ");
});

test("ลูกค้ากดปุ่มใต้รูปรีวิว (postback) → บอทส่งการ์ดสั่งซื้อลายนั้น", async () => {
  const sent: any[] = [];
  const line: LinePort = { reply: async (_t, m) => void sent.push(m), push: async () => {}, showLoading: async () => {}, displayName: async () => "" };
  await handleEvent({ type: "postback", source: { type: "user", userId: "U1" }, replyToken: "rt", postback: { data: encodePostback({ k: "rv", f: "plain", c: "black" }) } } as any, { line, adminUserId: "UADMIN", getImageSets: async () => liveSets });
  assert.match(sent[0][0], /ลายนี้เลยครับ/);
  const bubbles = sent[0][1].contents.contents;
  assert.equal(bubbles.length, 1);
  assert.match(JSON.stringify(bubbles[0]), /สีดำ มีเส้นขอบ/);
});

test("ลายที่ร้านไม่ได้ขาย (ไม่มีการ์ดในชีท) → ไม่ส่งรูป · ถามหาลายนั้น → บอกว่าไม่มีจำหน่าย", async () => {
  assert.equal(isSold(liveSets, "plain", "black"), true);
  assert.equal(isSold(liveSets, "carbon", "black"), true);
  assert.equal(isSold(liveSets, "sincity", "black"), false);
  assert.equal(isSold(liveSets, "vip", "black"), false);
  assert.equal(isSold(liveSets, "plain", "red"), false);
  assert.equal(isSold(liveSets, "stainless"), true);
  assert.equal(isSold(liveSets, "tax"), true);
  assert.equal(isSold([], "sincity"), true, "อ่านชีทไม่ได้ → ไม่กรอง");
  assert.deepEqual(soldPhotos(liveSets, photos).map((p) => p.id), ["fort1", "altis1", "ativ1", "city1", "unk1", "tax1"]);

  const sent: any[] = [];
  const line: LinePort = { reply: async (_t, m) => void sent.push(m), push: async () => {}, showLoading: async () => {}, displayName: async () => "" };
  await handleEvent({ type: "message", source: { type: "user", userId: "U1" }, replyToken: "rt", message: { type: "text", text: "ขอดูลาย sin city หน่อย" } } as any, {
    line, adminUserId: "UADMIN", getImageSets: async () => liveSets, getReviewPhotos: async () => photos, ask: async () => { throw new Error("ไม่ควรเรียก AI"); },
  });
  assert.match(sent[0][0], /^ลาย Sin City ทางร้านไม่มีจำหน่ายครับ/);
  assert.ok(!JSON.stringify(sent[0][1]).includes("fort2"), "ไม่ส่งรูป Sin City");
});
