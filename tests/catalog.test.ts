// การ์ดประเภทสินค้า 7 ใบ + ขั้นตอนต่อสินค้า + ป้ายภาษีอย่างเดียว + ปุ่ม Rich Menu — รัน: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleEvent, type LinePort } from "../lib/bot.ts";
import { sampleSets, choiceText, CATEGORY_SET, buildQuickReply, isQuickSet, firstStepSet, parseImageSets, buildCarousel, parseLinkColumn, installSet, reviewSet, REVIEW_SET } from "../lib/images.ts";
import { priceOrder, decodePostback, orderSummaryText, verifyOrder } from "../lib/order.ts";
import { MENU } from "../lib/shop.ts";
import { richMenuRequest } from "../lib/richmenu.ts";

function fakeLine() {
  const sent: { kind: string; to: string; texts: any[] }[] = [];
  const line: LinePort = {
    reply: async (to, texts) => void sent.push({ kind: "reply", to, texts }),
    push: async (to, texts) => void sent.push({ kind: "push", to, texts }),
    showLoading: async () => {},
    displayName: async () => "คุณทดสอบ",
  };
  return { line, sent };
}
const msgEvent = (text: string, userId = "U1") => ({ type: "message", source: { type: "user", userId }, replyToken: "rt", message: { type: "text", text } }) as any;
const noAsk = async (): Promise<never> => { throw new Error("ไม่ควรเรียก AI"); };
const setNamed = (name: string) => sampleSets().find((s) => s.name === name)!;
const pick = (setName: string, item: string, picked: string[] = []) => {
  const s = setNamed(setName);
  return choiceText(s, s.items.find((i) => i.name === item)!, picked);
};
const catPick = (name: string) => pick(CATEGORY_SET, name);

test("ปุ่มเมนู 🛒 สั่งซื้อ → การ์ดประเภทสินค้า 7 ใบ มีรูป (ไม่เรียก AI)", async () => {
  const { line, sent } = fakeLine();
  await handleEvent(msgEvent(MENU.order), { line, getImageSets: async () => sampleSets(), ask: noAsk });
  const bubbles = sent[0].texts[1].contents.contents;
  assert.deepEqual(bubbles.map((b: any) => b.body.contents[1].text), ["อะคริลิค", "สแตนเลส", "เหล็กพ่นสี", "พลาสติก ABS", "ไร้ขอบ", "รถตู้/บรรทุก", "กรอบป้ายภาษี พรบ."]);
  assert.ok(bubbles.every((b: any) => /^https:\/\/.+\.png$/.test(b.hero.url)));
});

test("ทุกสินค้า (ยกเว้นไร้ขอบ) มีขั้นแรก · ปุ่มด่วนป้ายไม่เกิน 20 ตัว · ข้อความปุ่มไม่เกิน 300", () => {
  const sets = sampleSets();
  const products = setNamed(CATEGORY_SET).items.map((i) => i.name);
  assert.deepEqual(products.filter((p) => !firstStepSet(sets, p)), ["ไร้ขอบ"]);
  for (const s of sets.filter(isQuickSet)) {
    const qr = buildQuickReply(s, ["สีดำ", "สี่เหลี่ยมขอบใหญ่"]);
    assert.ok(qr.items.every((i) => i.action.label.length <= 20 && i.action.text.length <= 300), s.name);
  }
  // ตัวเลือกที่ต้องเห็นภาพ = การ์ด · ตัวเลือกง่าย = ปุ่มด่วน
  assert.deepEqual(sets.filter(isQuickSet).map((s) => s.name), [
    "สแตนเลส ขั้น 2 เลือกแผ่นอะคริลิคใส", "เหล็กพ่นสี ขั้น 1 เลือกสี", "เหล็กพ่นสี ขั้น 3 เลือกแผ่นอะคริลิคใส",
    "พลาสติก ABS ขั้น 1 เลือกสี", "พลาสติก ABS ขั้น 2 เลือกเส้นคาดกลาง", "รถตู้/บรรทุก ขั้น 1 เลือกวัสดุ", "กรอบป้ายภาษี พรบ. ขั้น 1 เลือกประเภทรถ",
  ]);
});

test("กดการ์ดสแตนเลส → การ์ดเลือกทรง (ไม่เรียก AI) · กดเหล็กพ่นสี → ปุ่มด่วนสีขาว/ดำ", async () => {
  const a = fakeLine();
  await handleEvent(msgEvent(catPick("สแตนเลส")), { line: a.line, getImageSets: async () => sampleSets(), ask: noAsk });
  assert.equal(a.sent[0].texts[0], "กรอบป้ายสแตนเลส 279.- / 319.- (มีแผ่นใส) 😊 เลือกทรงได้เลยครับ");
  assert.match(a.sent[0].texts[1].altText, /^สแตนเลส ขั้น 1 เลือกทรง/);
  const b = fakeLine();
  await handleEvent(msgEvent(catPick("เหล็กพ่นสี")), { line: b.line, getImageSets: async () => sampleSets(), ask: noAsk });
  assert.equal(b.sent[0].texts.length, 1);
  const msg = b.sent[0].texts[0];
  assert.match(msg.text, /เลือกสีได้เลยครับ/);
  assert.deepEqual(msg.quickReply.items.map((i: any) => i.action.label), ["สีขาว", "สีดำ"]);
  assert.equal(msg.quickReply.items[1].action.text, "เลือกแบบที่ 2: สีดำ (เหล็กพ่นสี ขั้น 1 เลือกสี)");
});

test("เหล็กพ่นสี: สีดำ → ทรง (การ์ด) → แผ่นใส (ปุ่มด่วน) → ชวนป้ายภาษี · ยอด 299 + 30 (AI ล่มก็ไปต่อได้)", async () => {
  const sets = sampleSets();
  const deps = (line: LinePort) => ({ line, getFaq: async () => "faq", getImageSets: async () => sets, ask: async (): Promise<never> => { throw new Error("AI ล่ม"); } });
  const a = fakeLine();
  await handleEvent(msgEvent(pick("เหล็กพ่นสี ขั้น 1 เลือกสี", "สีดำ")), deps(a.line));
  assert.match(a.sent[0].texts[1].altText, /เหล็กพ่นสี ขั้น 2 เลือกทรง/);
  const b = fakeLine();
  await handleEvent(msgEvent(pick("เหล็กพ่นสี ขั้น 2 เลือกทรง", "คางหมู", ["สีดำ"])), deps(b.line));
  const qr = b.sent[0].texts[0].quickReply.items;
  assert.deepEqual(qr.map((i: any) => i.action.label), ["ไม่มีแผ่นใส 249.-", "มีแผ่นใส 299.-"]);
  assert.match(qr[1].action.text, /\| เลือกแล้ว: สีดำ, คางหมู$/);
  const c = fakeLine();
  await handleEvent(msgEvent(qr[1].action.text), deps(c.line));
  const yes = decodePostback(c.sent[0].texts[0].quickReply.items[0].action.data)!;
  assert.deepEqual(yes, { k: "tax", y: 1, p: "เหล็กพ่นสี", s: ["สีดำ", "คางหมู", "มีแผ่นใส"] });
  const o = priceOrder(sets, { code: "x", product: "เหล็กพ่นสี", picks: ["สีดำ", "คางหมู", "มีแผ่นใส"], tax: false })!;
  assert.deepEqual([o.base, o.shipping, o.total], [299, 30, 329]);
});

test("ราคาจากการ์ดประเภทสินค้า: ABS 199 · รถตู้/บรรทุก 399 · สแตนเลส 279/319", () => {
  const sets = sampleSets();
  const total = (product: string, picks: string[], tax = false) => priceOrder(sets, { code: "x", product, picks, tax })?.total;
  assert.equal(total("พลาสติก ABS", ["สีขาว", "มีเส้นคาดกลาง"]), 229);
  assert.equal(total("รถตู้/บรรทุก", ["เหล็กพ่นสีดำ"], true), 399 + 69);
  assert.equal(total("สแตนเลส", ["สี่เหลี่ยมขอบเล็ก", "ไม่มีแผ่นใส"]), 309);
  assert.equal(total("สแตนเลส", ["สี่เหลี่ยมขอบเล็ก", "มีแผ่นใส"]), 349);
  assert.equal(total("อะคริลิค", ["สีดำ มีเส้นขอบ"]), undefined); // ยังไม่เลือกขนาด → ยังคิดไม่ได้
});

test("กดการ์ดไร้ขอบ (ไม่มีตัวเลือก) → ชวนป้ายภาษีเลย · ยอด 199 + 30", async () => {
  const { line, sent } = fakeLine();
  await handleEvent(msgEvent(catPick("ไร้ขอบ")), { line, getImageSets: async () => sampleSets(), ask: noAsk });
  const msg = sent[0].texts[0];
  assert.match(msg.text, /สรุปที่เลือก: กรอบป้ายไร้ขอบ 😊/);
  assert.deepEqual(decodePostback(msg.quickReply.items[1].action.data), { k: "tax", y: 0, p: "ไร้ขอบ", s: [] });
  const o = priceOrder(sampleSets(), { code: "XR-T", product: "ไร้ขอบ", picks: [], tax: false })!;
  assert.equal(o.total, 229);
  assert.match(orderSummaryText(o, "", false), /🔺 กรอบป้ายไร้ขอบ  199\.-/);
});

test("ป้ายภาษีอย่างเดียว: มอเตอร์ไซค์ → สรุปยอดเลย ไม่ชวนซื้อเพิ่ม · ค่าส่ง 15", async () => {
  const { line, sent } = fakeLine();
  await handleEvent(msgEvent(pick("กรอบป้ายภาษี พรบ. ขั้น 1 เลือกประเภทรถ", "มอเตอร์ไซค์")), {
    line, getImageSets: async () => sampleSets(), ask: noAsk, liffId: "1234-abcd", paymentInfo: "🏦 KTB : 000", orderSecret: "secret",
  });
  const [summary, button] = sent[0].texts;
  assert.match(summary, /🔺 กรอบป้ายภาษี พรบ\.: มอเตอร์ไซค์  129\.-/);
  assert.match(summary, /ค่าส่ง SPX: 15\.-/);
  assert.match(summary, /ยอดชำระ 144\.-/);
  assert.doesNotMatch(summary, /เพิ่มกรอบป้ายภาษี/);
  const order = verifyOrder(decodeURIComponent(button.contents.body.contents[2].action.uri.split("?o=")[1]), "secret")!;
  assert.deepEqual([order.product, order.tax, order.total], ["กรอบป้ายภาษี พรบ.", false, 144]);
  // ปุ่ม "เพิ่มป้ายภาษี" กับออเดอร์ป้ายภาษีเอง → ไม่บวกซ้ำ
  assert.equal(priceOrder(sampleSets(), { code: "x", product: "กรอบป้ายภาษี พรบ.", picks: ["รถยนต์"], tax: true })!.total, 84);
});

test("ปุ่มเมนู 💰 ราคา → รายการราคา 7 ประเภท + ปุ่มสั่งซื้อ · 💬 คุยกับแอดมิน → แจ้งแอดมิน", async () => {
  const a = fakeLine();
  await handleEvent(msgEvent(MENU.price), { line: a.line, getImageSets: async () => sampleSets(), ask: noAsk });
  const msg = a.sent[0].texts[0];
  assert.match(msg.text, /กรอบป้ายอะคริลิค  399\.- \/ 419\.-/);
  assert.match(msg.text, /กรอบป้ายภาษี พรบ\.  69\.- \/ 129\.-/);
  assert.match(msg.text, /ค่าส่ง SPX 30\.-/);
  assert.equal(msg.quickReply.items[0].action.text, MENU.order);
  const b = fakeLine();
  await handleEvent(msgEvent(MENU.admin), { line: b.line, adminUserId: "UADMIN", getImageSets: async () => sampleSets(), ask: noAsk });
  assert.match(b.sent[0].texts[0], /แจ้งแอดมินให้แล้ว/);
  assert.equal(b.sent[1].to, "UADMIN");
  assert.match(b.sent[1].texts[0], /คุยกับแอดมิน/);
});

test("ปุ่มเมนู 🔧 วิธีติดตั้ง → การ์ด 8 รุ่น ปุ่มเปิด YouTube + ภาพปกคลิป (ไม่เรียก AI)", async () => {
  const { line, sent } = fakeLine();
  await handleEvent(msgEvent(MENU.install), { line, getImageSets: async () => sampleSets(), ask: noAsk });
  const bubbles = sent[0].texts[1].contents.contents;
  assert.deepEqual(bubbles.map((b: any) => b.body.contents[1].text), [
    "อะคริลิค", "สแตนเลส", "เหล็กพ่นสี", "พลาสติก ABS", "ไร้ขอบ", "รถตู้/บรรทุก", "ป้ายภาษี พรบ. รถยนต์", "ป้ายภาษี พรบ. มอเตอร์ไซค์",
  ]);
  assert.ok(bubbles.every((b: any) => b.footer.contents[0].action.type === "uri" && /^https:\/\/www\.youtube\.com\/shorts\//.test(b.footer.contents[0].action.uri)));
  assert.ok(bubbles.every((b: any) => b.footer.contents[0].action.label.length <= 20));
  assert.equal(bubbles[0].footer.contents[0].action.uri, "https://www.youtube.com/shorts/TAfBgMMPaLo");
  assert.equal(bubbles[4].hero.url, "https://i.ytimg.com/vi/9_rTKGa4n7U/hqdefault.jpg");
});

test("ลิงก์คลิปอ่านจากคอลัมน์ คลิปวิธีติดตั้ง ในแท็บสินค้าและราคา · ไม่มีลิงก์ใช้ค่าสำรอง", () => {
  const csv = 'รหัส,สินค้า,คลิปวิธีติดตั้ง\nacrylic-ss,อะคริลิค,https://youtu.be/E93c_P1DghM\ntax-moto,ป้ายภาษี,"https://www.youtube.com/shorts/jlbwvEijfAQ "\nsteel,เหล็ก,-';
  const links = parseLinkColumn(csv, "คลิปวิธีติดตั้ง");
  assert.deepEqual(links, { "acrylic-ss": "https://youtu.be/E93c_P1DghM", "tax-moto": "https://www.youtube.com/shorts/jlbwvEijfAQ" });
  const set = installSet(links);
  assert.equal(set.items[0].link, "https://youtu.be/E93c_P1DghM");
  assert.equal(set.items[2].link, "https://www.youtube.com/shorts/4T8q5ub69XM");
  assert.deepEqual(parseLinkColumn("ชุดรูป,ชื่อแบบ\nx,y", "คลิปวิธีติดตั้ง"), {});
});

test("แท็บรูปสินค้า: คอลัมน์ลิงก์คลิป → ปุ่ม YouTube · ไม่ใส่รูปใช้ภาพปกคลิป", () => {
  const csv = "ชุดรูป,ลำดับ,ชื่อแบบ,ราคา,ลิงก์รูป,รายละเอียด,ลิงก์คลิป\nวิธีติดตั้ง,1,ABS,,,กิ๊ปล็อค,https://www.youtube.com/watch?v=YbnSyMiTUYE";
  const [set] = parseImageSets(csv);
  assert.equal(set.items[0].image, "https://i.ytimg.com/vi/YbnSyMiTUYE/hqdefault.jpg");
  assert.equal((buildCarousel(set).contents as any).contents[0].footer.contents[0].action.uri, "https://www.youtube.com/watch?v=YbnSyMiTUYE");
});

test("ปุ่มเมนู ⭐ รีวิวสินค้า → การ์ดเฉพาะรุ่นที่มีลิงก์รีวิว ปุ่มเปิดหน้ารีวิว (ไม่เรียก AI)", async () => {
  const { line, sent } = fakeLine();
  await handleEvent(msgEvent(MENU.review), { line, getImageSets: async () => sampleSets(), ask: noAsk });
  assert.match(sent[0].texts[0], /รีวิวจากลูกค้าจริง/);
  const bubbles = sent[0].texts[1].contents.contents;
  assert.deepEqual(bubbles.map((b: any) => b.body.contents[1].text), ["อะคริลิค", "สแตนเลส", "เหล็กพ่นสี", "พลาสติก ABS", "รถตู้/บรรทุก"]);
  assert.deepEqual(bubbles.map((b: any) => b.footer.contents[0].action.uri), [
    "https://canva.link/cm14wzc6vnbed6p", "https://canva.link/ve2f6ufpe1z3dx9", "https://canva.link/pny4wokozswx4dq",
    "https://canva.link/2sz7a5wfwb41g3n", "https://canva.link/59ohj9ig99g7t1w",
  ]);
  assert.ok(bubbles.every((b: any) => b.footer.contents[0].action.label === "⭐ ดูรีวิว" && /\/samples\/cat-.+\.png$/.test(b.hero.url)));
});

test("ลิงก์รีวิวจากคอลัมน์ ลิงก์รีวิว ในชีท: แทนลิงก์สำรอง + เพิ่มการ์ดรุ่นใหม่ได้", () => {
  const csv = "รหัส,ลิงก์รีวิว\nabs,https://canva.link/abs-new\ntax-car,https://canva.link/tax";
  const set = reviewSet(parseLinkColumn(csv, "ลิงก์รีวิว"));
  assert.equal(set.name, REVIEW_SET);
  assert.equal(set.items.find((i) => i.name === "พลาสติก ABS")!.link, "https://canva.link/abs-new");
  assert.equal(set.items.find((i) => i.name === "ป้ายภาษี พรบ. รถยนต์")!.link, "https://canva.link/tax");
  assert.equal(set.items.length, 6);
});

test("Rich Menu 2 แถว × 3 ช่อง: 5 ปุ่มตรงตำแหน่ง · ช่องที่ 6 ว่าง · พื้นที่กดไม่เกินขอบรูป", () => {
  const req = richMenuRequest() as any;
  assert.deepEqual(req.size, { width: 2500, height: 1686 });
  const areas = req.areas.map((a: any) => [(a.action as any).text, a.bounds.x, a.bounds.y, a.bounds.width, a.bounds.height]);
  assert.deepEqual(areas, [
    [MENU.order, 0, 0, 833, 843], [MENU.price, 833, 0, 834, 843], [MENU.install, 1667, 0, 833, 843],
    [MENU.review, 0, 843, 833, 843], [MENU.admin, 833, 843, 834, 843],
  ]);
  assert.ok(req.areas.every((a: any) => (a.action as any).label.length <= 20));
});
