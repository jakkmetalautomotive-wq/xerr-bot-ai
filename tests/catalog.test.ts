// การ์ดประเภทสินค้า 7 ใบ + ขั้นตอนต่อสินค้า + ป้ายภาษีอย่างเดียว + ปุ่ม Rich Menu — รัน: npm test
import { upsellChoice } from "./helpers.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleEvent, type LinePort } from "../lib/bot.ts";
import { sampleSets, choiceText, CATEGORY_SET, buildQuickReply, isQuickSet, firstStepSet, parseImageSets, buildCarousel, parseLinkColumn, installSet, reviewSet, REVIEW_SET } from "../lib/images.ts";
import { priceOrder, decodePostback, orderSummaryText, verifyOrder } from "../lib/order.ts";
import { MENU } from "../lib/shop.ts";
import { squareOnWhite, PHOTO_SIZE, cleanPhotoPath } from "../lib/photo.ts";
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
  assert.deepEqual(bubbles.map((b: any) => b.body.contents[1].contents[1].text), ["อะคริลิค", "สแตนเลส", "เหล็กพ่นสี", "พลาสติก ABS", "ไร้ขอบ", "รถตู้/บรรทุก", "กรอบป้ายภาษี พรบ."]);
  assert.ok(bubbles.every((b: any) => /^https:\/\//.test(b.hero.url)));
  // รูปจริงจาก Drive ทุกประเภท ยกเว้นป้ายภาษี (รูปเก็บในบอท public/products)
  assert.deepEqual(bubbles.map((b: any) => b.hero.url.includes("/api/img?id=")), [true, true, true, true, true, true, false]);
  assert.match(bubbles[6].hero.url, /\/products\/tax-car\.jpg$/);
  assert.ok(!bubbles.some((b: any) => b.hero.url.includes("/samples/")), "ไม่เหลือภาพประกอบชั่วคราวแล้ว");
});

test("ทุกสินค้า (ยกเว้นไร้ขอบ) มีขั้นแรก · ปุ่มด่วนป้ายไม่เกิน 20 ตัว · ข้อความปุ่มไม่เกิน 300", () => {
  const sets = sampleSets();
  const products = setNamed(CATEGORY_SET).items.map((i) => i.name);
  assert.deepEqual(products.filter((p) => !firstStepSet(sets, p)), ["ไร้ขอบ"]);
  for (const s of sets.filter(isQuickSet)) {
    const qr = buildQuickReply(s, ["สีดำ", "สี่เหลี่ยมขอบใหญ่"]);
    assert.ok(qr.items.every((i) => i.action.label.length <= 20 && i.action.text.length <= 300), s.name);
  }
  // ทุกขั้นมีรูปจริงแล้ว = การ์ดหมด ไม่เหลือปุ่มด่วน
  assert.deepEqual(sets.filter(isQuickSet).map((s) => s.name), []);
});

test("กดการ์ดสแตนเลส → การ์ดเลือกทรง (ไม่เรียก AI) · กดป้ายภาษี → การ์ดรูปรถยนต์/มอเตอร์ไซค์", async () => {
  const a = fakeLine();
  await handleEvent(msgEvent(catPick("สแตนเลส")), { line: a.line, getImageSets: async () => sampleSets(), ask: noAsk });
  assert.equal(a.sent[0].texts[0], "กรอบป้ายสแตนเลส 279.- / 319.- (มีแผ่นใส) 😊 เลือกทรงได้เลยครับ");
  assert.match(a.sent[0].texts[1].altText, /^สแตนเลส ขั้น 1 เลือกทรง/);
  const b = fakeLine();
  await handleEvent(msgEvent(catPick("กรอบป้ายภาษี พรบ.")), { line: b.line, getImageSets: async () => sampleSets(), ask: noAsk });
  const [intro, cards] = b.sent[0].texts;
  assert.match(intro, /เลือกประเภทรถได้เลยครับ/);
  const bubbles = cards.contents.contents;
  assert.deepEqual(bubbles.map((x: any) => x.body.contents[1].contents[1].text), ["รถยนต์", "มอเตอร์ไซค์"]);
  assert.deepEqual(bubbles.map((x: any) => x.hero.url.split("/products/")[1]), ["tax-car.jpg", "tax-moto.jpg"]);
});

test("ทรงคางหมูไม่มีแบบแผ่นใส: เลือกคางหมูแล้วข้ามขั้นแผ่นใส ไปชวนป้ายภาษีเลย · สแตนเลส 279 / เหล็กพ่นสี 249", async () => {
  const sets = sampleSets();
  const deps = (line: LinePort) => ({ line, getImageSets: async () => sets, ask: noAsk });
  const a = fakeLine();
  await handleEvent(msgEvent(pick("เหล็กพ่นสี ขั้น 2 เลือกทรง", "คางหมู", ["สีดำ"])), deps(a.line));
  const msg = a.sent[0].texts[0];
  assert.match(msg.altText, /สรุปที่เลือก: กรอบป้ายเหล็กพ่นสี สีดำ \/ คางหมู/);
  assert.deepEqual(decodePostback(upsellChoice(msg, 1)), { k: "tax", y: 0, p: "เหล็กพ่นสี", s: ["สีดำ", "คางหมู"] });
  const total = (product: string, picks: string[]) => priceOrder(sets, { code: "x", product, picks, tax: false })!.base;
  assert.equal(total("เหล็กพ่นสี", ["สีดำ", "คางหมู"]), 249);
  assert.equal(total("สแตนเลส", ["คางหมู"]), 279);
  // ทรงสี่เหลี่ยมยังไปขั้นแผ่นใสตามปกติ (รูปแผ่นใสตามทรง)
  const b = fakeLine();
  await handleEvent(msgEvent(pick("สแตนเลส ขั้น 1 เลือกทรง", "สี่เหลี่ยมขอบเล็ก")), deps(b.line));
  const ids = b.sent[0].texts[1].contents.contents.map((x: any) => x.hero.url.split("id=")[1].split("&")[0]);
  assert.deepEqual(ids, ["1kJz6WBKwBsgpl9HWVEl8ensMB-0XizEv", "14P4dzfORCZ7xLlurVe6YqSX9vpC23Nlq"]);
});

test("เหล็กพ่นสี: สีขาว → ทรง (การ์ดรูปสีขาว) → แผ่นใส (การ์ดรูปตามสี+ทรง) → ชวนป้ายภาษี · ยอด 299 + 30 (AI ล่มก็ไปต่อได้)", async () => {
  const sets = sampleSets();
  const deps = (line: LinePort) => ({ line, getFaq: async () => "faq", getImageSets: async () => sets, ask: async (): Promise<never> => { throw new Error("AI ล่ม"); } });
  const heroIds = (flex: any) => flex.contents.contents.map((b: any) => b.hero.url.split("id=")[1].split("&")[0]);
  const a = fakeLine();
  await handleEvent(msgEvent(pick("เหล็กพ่นสี ขั้น 1 เลือกสี", "สีขาว")), deps(a.line));
  assert.match(a.sent[0].texts[1].altText, /เหล็กพ่นสี ขั้น 2 เลือกทรง/);
  assert.deepEqual(heroIds(a.sent[0].texts[1]), ["1Ss0Mac7UoHx4yqyI__0YMt7kbNWGSnfC", "196cXacCJij58PqYjj3XoAnIDfrdTLnu-", "1Gr9ZSAK6JFVv48adlR6baQtc-6ndo3Re"]);
  const b = fakeLine();
  await handleEvent(msgEvent(pick("เหล็กพ่นสี ขั้น 2 เลือกทรง", "สี่เหลี่ยมขอบใหญ่", ["สีขาว"])), deps(b.line));
  const clear = b.sent[0].texts[1];
  assert.match(clear.altText, /เหล็กพ่นสี ขั้น 3 เลือกแผ่นอะคริลิคใส/);
  assert.deepEqual(heroIds(clear), ["1Ss0Mac7UoHx4yqyI__0YMt7kbNWGSnfC", "1BalvjndYIKOmweM-5eX3Lhbpm4wSrImx"]);
  const yesClear = clear.contents.contents[1].footer.contents[0].action.text;
  assert.match(yesClear, /\| เลือกแล้ว: สีขาว, สี่เหลี่ยมขอบใหญ่$/);
  const c = fakeLine();
  await handleEvent(msgEvent(yesClear), deps(c.line));
  const yes = decodePostback(upsellChoice(c.sent[0].texts[0], 0))!;
  assert.deepEqual(yes, { k: "tax", y: 1, p: "เหล็กพ่นสี", s: ["สีขาว", "สี่เหลี่ยมขอบใหญ่", "มีแผ่นใส"] });
  const o = priceOrder(sets, { code: "x", product: "เหล็กพ่นสี", picks: ["สีขาว", "สี่เหลี่ยมขอบใหญ่", "มีแผ่นใส"], tax: false })!;
  assert.deepEqual([o.base, o.shipping, o.total], [299, 30, 329]);
});

test("อะคริลิค: รูปขั้นขนาด / เส้นคาดกลาง เปลี่ยนตามสี + มี/ไร้เส้นขอบ ที่เลือก · เคฟล่ามีรูปของตัวเอง", () => {
  const ids = (setName: string, picked: string[]) => (buildCarousel(setNamed(setName), picked).contents as any).contents.map((b: any) => b.hero.url.split("id=")[1].split("&")[0]);
  assert.deepEqual(ids("อะคริลิค ขั้น 2 เลือกขนาด", ["สีเทา ไร้เส้นขอบ"]), ["1enKtjEX68h-Qb1lzo08RSf2hE2EJKO9k", "1ynSs_Ou_VIJG9B7IPCaGgst5tsHPvzQP", "1CfWNC6D4Ut5nYSIUakJXXgsPFjDm8jOI"]);
  assert.deepEqual(ids("อะคริลิค ขั้น 2 เลือกขนาด", ["สีเทา มีเส้นขอบ"]), ["1LRc1yj2Q_bgUm1qsqwf9FWuSBU8V_SpL", "1BtRbn3P39BJrXeGwoxK2bICNODa-umJR", "1xa-8_-G_VeOUoa35pkOgfXbWhz4-FFfU"]);
  assert.deepEqual(ids("อะคริลิค ขั้น 3 เลือกเส้นคาดกลาง", ["สีขาว ไร้เส้นขอบ", "สั้น-ยาว"]), ["1ORK9I7P2cVTKm92lh_kjPFt0mh6Cv0sP", "1CqCAdaXC5GpIqWyKqtrT49joR0_EjDVu"]);
  assert.deepEqual(ids("อะคริลิค ขั้น 2 เลือกขนาด", ["ลายเคฟล่า ดำ มีเส้นขอบ"]), ["1EvnP_5z-CX7w7BdNBm3F3Xpl4c3NFzVY", "17jNY6cKQtBJBgaCV610H9-oxVBvsqPLx", "10tdDU2byg_VYzM3Wc1C-A6u_UF24ReAt"]);
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
  assert.match(msg.altText, /สรุปที่เลือก: กรอบป้ายไร้ขอบ 😊/);
  assert.deepEqual(decodePostback(upsellChoice(msg, 1)), { k: "tax", y: 0, p: "ไร้ขอบ", s: [] });
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
  assert.deepEqual(bubbles.map((b: any) => b.body.contents[1].contents[1].text), [
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
  assert.deepEqual(bubbles.map((b: any) => b.body.contents[1].contents[1].text), ["อะคริลิค", "สแตนเลส", "เหล็กพ่นสี", "พลาสติก ABS", "รถตู้/บรรทุก"]);
  assert.deepEqual(bubbles.map((b: any) => b.footer.contents[0].action.uri), [
    "https://canva.link/cm14wzc6vnbed6p", "https://canva.link/ve2f6ufpe1z3dx9", "https://canva.link/pny4wokozswx4dq",
    "https://canva.link/2sz7a5wfwb41g3n", "https://canva.link/59ohj9ig99g7t1w",
  ]);
  assert.ok(bubbles.every((b: any) => b.footer.contents[0].action.label === "⭐ ดูรีวิว" && b.hero.url.includes("/api/img?id=")));
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

test("การ์ดประเภทสินค้า: แถว 1 แบบที่ N + ชื่อ · แถว 2 ราคาปกติขีดฆ่า · แถว 3 ราคาขายตัวใหญ่ · ไม่มีแถวรายละเอียด", () => {
  const bubble = (buildCarousel(setNamed(CATEGORY_SET)).contents as any).contents[0];
  const [, title, normal, price, ...rest] = bubble.body.contents;
  const spans = (n: any) => n.contents.map((s: any) => [s.text, s.size, s.decoration ?? ""]);
  assert.deepEqual(spans(title), [["แบบที่ 1  ", "xs", ""], ["อะคริลิค", "xl", ""]]);
  assert.deepEqual(spans(normal), [["ราคาปกติ ", "sm", ""], ["550.-", "sm", "line-through"]]);
  assert.deepEqual(spans(price), [["399.- / 419.-", "xxl", ""]]);
  assert.equal(rest.length, 0);
  // หมายเหตุในวงเล็บท้ายราคา → ตัวเล็ก
  const steel = (buildCarousel(setNamed(CATEGORY_SET)).contents as any).contents[2].body.contents[3];
  assert.deepEqual(spans(steel), [["249.- / 299.-", "xxl", ""], [" (มีแผ่นใส)", "sm", ""]]);
  const parsed = parseImageSets("ชุดรูป,ชื่อแบบ,ราคา,ลิงก์รูป,ราคาปกติ\nx,ABS,199.-,,350.-");
  assert.equal(parsed[0].items[0].normal, "350.-");
});

test("รูปสินค้า: พื้นโปร่งใส → ขาว · รูปแนวนอนจัดลงจัตุรัสพื้นขาว ไม่ตัดขอบ", async () => {
  const sharp = (await import("sharp")).default;
  // รูป 400×300 พื้นโปร่งใส มีแถบดำเต็มความกว้างตรงกลาง (แทนกรอบป้าย)
  const bar = await sharp({ create: { width: 400, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
  const input = await sharp({ create: { width: 400, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: bar, top: 100, left: 0 }]).png().toBuffer();
  const out = await squareOnWhite(input);
  const meta = await sharp(out).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height, meta.hasAlpha], ["jpeg", PHOTO_SIZE, PHOTO_SIZE, false]);
  const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => data[(y * info.width + x) * info.channels];
  assert.ok(px(5, 5) > 245, "มุมบน (เดิมโปร่งใส / ขอบเติม) ต้องเป็นสีขาว");
  assert.ok(px(5, 520) < 15 && px(1034, 520) < 15, "แถบดำต้องยาวถึงขอบซ้าย-ขวา = ไม่โดนตัด");
});

test("รูปลบพื้นหลัง: ใช้เมื่อรูปใน Drive ยังเป็นต้นฉบับเดิม · อัปโหลดเวอร์ชันใหม่ / รูปที่ไม่มีฉบับตัด → ใช้รูปจาก Drive", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const { CLEAN_PHOTOS } = await import("../lib/clean-photos.ts");
  const ids = Object.keys(CLEAN_PHOTOS);
  assert.equal(ids.length, 46);
  // ทุกรายการมีไฟล์รูปจริง และเป็นรูปที่การ์ดใช้อยู่
  const used = JSON.stringify(sampleSets());
  assert.ok(ids.every((id) => existsSync(`public/products/${id}.jpg`) && used.includes(id)));
  // ลายนิ้วมือไม่ตรง (เวอร์ชันใหม่) → null · id ที่ไม่มีฉบับตัด → null
  assert.equal(cleanPhotoPath(ids[0], Buffer.from("รูปเวอร์ชันใหม่")), null);
  assert.equal(cleanPhotoPath("1eto3c7NCL1vlSSs2gFOEWj71MiF-hqGV", Buffer.from("x")), null); // รถตู้ (ตัดไม่สวย ไม่ได้ใช้)
  // ลายนิ้วมือตรง → ใช้รูปที่ตัดแล้ว (จำลองด้วยไฟล์ที่มีลายนิ้วมือตรงกัน)
  const fake = { ...CLEAN_PHOTOS };
  const body = readFileSync(`public/products/${ids[0]}.jpg`);
  const h = (await import("node:crypto")).createHash("sha1").update(body).digest("hex");
  CLEAN_PHOTOS[ids[0]] = h;
  try { assert.equal(cleanPhotoPath(ids[0], body), `/products/${ids[0]}.jpg`); } finally { CLEAN_PHOTOS[ids[0]] = fake[ids[0]]; }
});
