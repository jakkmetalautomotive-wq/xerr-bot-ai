import { test } from "node:test";
import assert from "node:assert/strict";
import { handleEvent, type LinePort } from "../lib/bot.ts";
import { encodePostback, type PricedOrder } from "../lib/order.ts";
import { memoryStore } from "../lib/state.ts";
import { TAX_CAR } from "../lib/shop.ts";
import { labelFromOrder, saveLabel, getLabel, signLabel, verifyLabel, labelHtml, senderLines, formatPhone } from "../lib/label.ts";

const order: PricedOrder = { code: "XR-AB12", product: "กรอบป้ายอะคริลิค", picks: ["ขาว", "ลายเคฟล่า"], tax: true, productLabel: "กรอบป้ายอะคริลิค", base: 399, taxPrice: 69, shipping: 0, total: 468 };
const addr = { name: "สมชาย ทดสอบ", phone: "0812345678", address: "1/2 ถ.ทดสอบ แขวงทดสอบ เขตทดสอบ กทม", zip: "10100", note: "" };

test("ใบปะหน้า: เก็บ/อ่านที่อยู่ · ลายเซ็นลิงก์ · ผู้ส่งจาก SHIP_FROM · HTML กันโค้ดแปลกในชื่อ", async () => {
  const state = memoryStore();
  const data = labelFromOrder(order, addr, 0);
  assert.deepEqual(data.items, ["กรอบป้ายอะคริลิค: ขาว / ลายเคฟล่า", TAX_CAR.name]);
  await saveLabel(state, data);
  assert.deepEqual(await getLabel(state, "XR-AB12"), data);
  assert.equal(await getLabel(state, "XR-ZZZZ"), null);

  const t = signLabel("XR-AB12", "secret");
  assert.equal(verifyLabel(t, "secret"), "XR-AB12");
  assert.equal(verifyLabel(t.replace("AB12", "AB13"), "secret"), null);
  assert.equal(verifyLabel(t, "other"), null);
  assert.equal(verifyLabel("XR-AB12", "secret"), null);

  assert.deepEqual(senderLines("XERR AUTOTEAM | 82/268 หมู่ 11 | กรุงเทพฯ 10150"), ["XERR AUTOTEAM", "82/268 หมู่ 11", "กรุงเทพฯ 10150"]);
  assert.deepEqual(senderLines(""), ["XERR AUTOTEAM"]);
  assert.equal(formatPhone("0812345678"), "081-234-5678");

  const html = labelHtml({ ...data, name: '<script>x</script>' }, ["XERR AUTOTEAM", "บรรทัด 2"]);
  assert.ok(!html.includes("<script>x"));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /081-234-5678/);
  assert.match(html, /10100/);
  assert.match(html, /@page \{ size: 100mm 150mm/);
  assert.match(html, /บรรทัด 2/);
});

test("แอดมินกด ✅ → ได้ลิงก์ใบปะหน้าในคำตอบ (ส่งต่อพนักงานได้) · ไม่มีที่อยู่ → บอกให้ดูในแชท", async () => {
  const state = memoryStore();
  await saveLabel(state, labelFromOrder(order, addr));
  const replies: any[] = [];
  const line: LinePort = { reply: async (_t, texts) => void replies.push(texts), push: async () => {}, showLoading: async () => {}, displayName: async () => "" };
  const press = (c: string) => handleEvent({
    type: "postback", source: { type: "user", userId: "UADMIN" }, replyToken: "rt",
    postback: { data: encodePostback({ k: "adm", a: "ok", c, u: "UCUST", t: 468 }) },
  } as any, { line, adminUserId: "UADMIN", orderSecret: "secret", state, logOrder: async () => true });

  await press("XR-AB12");
  const [, label] = replies.at(-1);
  assert.match(label, /🖨️ ใบปะหน้า XR-AB12 \(สมชาย ทดสอบ\)/);
  const url = new URL(label.split("\n")[1]);
  assert.equal(url.pathname, "/api/label");
  assert.equal(verifyLabel(url.searchParams.get("t")!, "secret"), "XR-AB12");

  await press("XR-CD34");
  assert.match(replies.at(-1)[1], /ไม่มีที่อยู่ของ XR-CD34/);
});
