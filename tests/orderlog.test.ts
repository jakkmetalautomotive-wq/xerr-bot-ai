// บันทึกออเดอร์ลง Google Sheet (ผ่าน Apps Script) — รัน: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleEvent, type LinePort } from "../lib/bot.ts";
import { encodePostback, priceOrder } from "../lib/order.ts";
import { sampleSets } from "../lib/images.ts";
import { logOrder, newOrderEvent, statusEvent, ORDER_STATUS, type OrderLogEvent } from "../lib/orderlog.ts";

const ADDR = { name: "สมชาย ใจดี", phone: "0891234567", address: "1/2 ถ.สุขุมวิท กรุงเทพฯ", zip: "10110", note: "" };

test("แถวออเดอร์ใหม่: รหัส สินค้า ตัวเลือก ยอด ที่อยู่ ชื่อ LINE · สถานะ รอตรวจสลิป", () => {
  const o = priceOrder(sampleSets(), { code: "XR-AB12", product: "อะคริลิค", picks: ["สีดำ มีเส้นขอบ", "สั้น-ยาว", "มีเส้นคาดกลาง"], tax: true })!;
  const e = newOrderEvent(o, ADDR, "คุณทดสอบ", "U123") as Extract<OrderLogEvent, { action: "new" }>;
  assert.equal(e.status, "รอตรวจสลิป");
  assert.deepEqual(
    [e.order.code, e.order.product, e.order.picks, e.order.tax, e.order.base, e.order.taxPrice, e.order.shipping, e.order.total, e.order.phone, e.order.lineUserId],
    ["XR-AB12", "กรอบป้ายอะคริลิค", "สีดำ มีเส้นขอบ / สั้น-ยาว / มีเส้นคาดกลาง", true, 419, 69, 0, 488, "0891234567", "U123"],
  );
});

test("ส่งเข้า Apps Script พร้อมรหัสลับ · ยังไม่ตั้งค่า / ชีทตอบ error / เน็ตล่ม → คืน false ไม่พัง", async () => {
  let sent: any = null;
  const ok = (async (url: string, init: RequestInit) => {
    sent = { url, body: JSON.parse(String(init.body)) };
    return new Response(JSON.stringify({ ok: true }));
  }) as any;
  assert.equal(await logOrder(statusEvent("XR-AB12", ORDER_STATUS.paid), { url: "https://script.example/exec", secret: "s3cret", fetchFn: ok }), true);
  assert.deepEqual(sent, { url: "https://script.example/exec", body: { action: "status", code: "XR-AB12", status: "ชำระแล้ว", secret: "s3cret" } });

  assert.equal(await logOrder(statusEvent("X", "ชำระแล้ว"), { url: "", secret: "", fetchFn: ok }), false);
  const wrongSecret = (async () => new Response(JSON.stringify({ ok: false, error: "secret" }))) as any;
  assert.equal(await logOrder(statusEvent("X", "ชำระแล้ว"), { url: "https://x", secret: "s", fetchFn: wrongSecret }), false);
  const down = (async () => { throw new Error("fetch failed"); }) as any;
  assert.equal(await logOrder(statusEvent("X", "ชำระแล้ว"), { url: "https://x", secret: "s", fetchFn: down }), false);
});

test("แอดมินกด ✅ / ❌ → อัปเดตสถานะในชีท (ชำระแล้ว / ยอดไม่ตรง) · คนอื่นกดไม่ได้", async () => {
  const sent: any[] = [];
  const line: LinePort = {
    reply: async (to, texts) => void sent.push({ to, texts }),
    push: async (to, texts) => void sent.push({ to, texts }),
    showLoading: async () => {},
    displayName: async () => "",
  };
  const logged: OrderLogEvent[] = [];
  const deps = { line, adminUserId: "UADMIN", logOrder: async (e: OrderLogEvent) => (logged.push(e), true) };
  const press = (a: "ok" | "bad", from = "UADMIN") => handleEvent({
    type: "postback", source: { type: "user", userId: from }, replyToken: "rt",
    postback: { data: encodePostback({ k: "adm", a, c: "XR-AB12", u: "UCUST", t: 488 }) },
  } as any, deps);

  await press("ok");
  assert.deepEqual(logged.at(-1), { action: "status", code: "XR-AB12", status: "ชำระแล้ว" });
  assert.match(sent.at(-1).texts[0], /ยืนยันออเดอร์ XR-AB12 แล้ว · แจ้งลูกค้าแล้ว · ลงชีทแล้ว/);
  await press("bad");
  assert.deepEqual(logged.at(-1), { action: "status", code: "XR-AB12", status: "ยอดไม่ตรง" });
  const before = logged.length;
  await press("ok", "USTRANGER");
  assert.equal(logged.length, before);
});

test("ลูกค้าทักครั้งแรก → ต่อท้ายคำตอบด้วยโปรรีวิว 50.- (ครั้งเดียว) · มีปุ่มด่วน → แทรกก่อนปุ่ม · แอดมินไม่ได้", async () => {
  const { _resetGreeted } = await import("../lib/bot.ts");
  const { MENU, REVIEW_PROMO } = await import("../lib/shop.ts");
  _resetGreeted();
  const sent: any[] = [];
  const line: LinePort = { reply: async (to, texts) => void sent.push({ to, texts }), push: async () => {}, showLoading: async () => {}, displayName: async () => "" };
  const deps = { line, adminUserId: "UADMIN", reviewPromo: true, getImageSets: async () => sampleSets(), ask: async () => { throw new Error("ไม่ควรเรียก AI"); } };
  const msg = (text: string, userId = "UNEW") => ({ type: "message", source: { type: "user", userId }, replyToken: "rt", message: { type: "text", text } }) as any;

  await handleEvent(msg(MENU.promo), deps); // ข้อความสุดท้ายมีปุ่มด่วน "🛒 สั่งซื้อ"
  const first = sent.at(-1).texts;
  assert.equal(first.length, 2);
  assert.equal(first[0], REVIEW_PROMO);
  assert.match(REVIEW_PROMO, /ส่งรูปหรือคลิปรีวิว.*ส่วนลด 50\.- ทันที/);
  assert.ok(first[1].quickReply);

  await handleEvent(msg(MENU.design), deps); // ทักรอบสอง → ไม่ส่งซ้ำ
  assert.ok(!sent.at(-1).texts.includes(REVIEW_PROMO));
  await handleEvent(msg(MENU.design, "UADMIN"), deps); // แอดมินทดสอบเอง → ไม่ส่ง
  assert.ok(!sent.at(-1).texts.includes(REVIEW_PROMO));
  _resetGreeted();
});

test("แอดมินกด ✅ → การ์ดยืนยันถึงลูกค้า: เลขพัสดุหลัง 2 ทุ่ม + เตือนรีวิว + ปุ่ม 📦 ขอเลขพัสดุ", async () => {
  const pushed: any[] = [];
  const line: LinePort = { reply: async () => {}, push: async (to, texts) => void pushed.push({ to, texts }), showLoading: async () => {}, displayName: async () => "" };
  await handleEvent({
    type: "postback", source: { type: "user", userId: "UADMIN" }, replyToken: "rt",
    postback: { data: encodePostback({ k: "adm", a: "ok", c: "XR-AB12", u: "UCUST", t: 309 }) },
  } as any, { line, adminUserId: "UADMIN", logOrder: async () => true });
  const card = pushed.find((p) => p.to === "UCUST").texts[0];
  const texts = card.contents.body.contents.map((c: any) => c.text ?? "").join("\n");
  assert.match(texts, /ได้รับยอดชำระ 309\.- แล้วครับ ✅ ออเดอร์ XR-AB12/);
  assert.match(texts, /เลขพัสดุเช็คได้หลัง 20:00 น\./);
  assert.match(texts, /อย่าลืมรีวิว.*ส่วนลด 50\.- ในออเดอร์ถัดไป/);
  const btn = card.contents.footer.contents[0];
  assert.equal(btn.contents[0].text, "📦 ขอเลขพัสดุ");
  assert.deepEqual(JSON.parse(btn.action.data), { k: "trk", c: "XR-AB12" });
});

test("ลูกค้ากด 📦 ขอเลขพัสดุ: มีเลข → ส่งเลข · ไม่มีเลข → บอกหลัง 2 ทุ่ม / แจ้งแอดมิน · ออเดอร์คนอื่น → ไม่ตอบ", async () => {
  const sent: any[] = [];
  const line: LinePort = { reply: async (to, texts) => void sent.push({ to, texts }), push: async (to, texts) => void sent.push({ to, texts }), showLoading: async () => {}, displayName: async () => "" };
  const press = (getTracking: any, userId = "UCUST") => handleEvent({
    type: "postback", source: { type: "user", userId }, replyToken: "rt", postback: { data: encodePostback({ k: "trk", c: "XR-AB12" }) },
  } as any, { line, adminUserId: "UADMIN", getTracking });

  await press(async () => ({ ok: true, found: true, tracking: "SPXTH0123456789", lineUserId: "UCUST" }));
  assert.match(sent.at(-1).texts[0], /เลขพัสดุ SPX: SPXTH0123456789/);

  const n = sent.length;
  await press(async () => ({ ok: true, found: true, tracking: "SPXTH0123456789", lineUserId: "UCUST" }), "USTRANGER");
  assert.equal(sent.length, n, "ไม่ส่งเลขพัสดุของคนอื่น");

  await press(async () => ({ ok: true, found: true, tracking: "", lineUserId: "UCUST" }));
  assert.match(sent.at(-1).texts[0] ?? sent.at(-2).texts[0], /ยังไม่มีเลขพัสดุ/);
});

test("แอดมินพิมพ์เลขพัสดุหลายบรรทัด → ลงชีททีละออเดอร์ + สรุปผล · ข้อความทั่วไป/ลูกค้าพิมพ์ → ไม่ใช่คำสั่ง", async () => {
  const { parseTrackingLines } = await import("../lib/orderlog.ts");
  assert.deepEqual(parseTrackingLines("XR-AB12 SPXTH0123456789\nxr-cd34: spxth0987654321"), [
    { code: "XR-AB12", tracking: "SPXTH0123456789" }, { code: "XR-CD34", tracking: "SPXTH0987654321" },
  ]);
  assert.equal(parseTrackingLines("กันน้ำไหม"), null);
  assert.equal(parseTrackingLines("XR-AB12 SPXTH0123456789\nขอบคุณครับ"), null);

  const replies: any[] = [];
  const line: LinePort = { reply: async (_t, texts) => void replies.push(texts), push: async () => {}, showLoading: async () => {}, displayName: async () => "" };
  const saved: string[] = [];
  const setTracking = async (code: string, tracking: string) => (saved.push(`${code}=${tracking}`), code !== "XR-ZZZZ");
  const msg = (text: string, userId: string) => ({ type: "message", source: { type: "user", userId }, replyToken: "rt", message: { type: "text", text } }) as any;
  await handleEvent(msg("XR-AB12 SPXTH0123456789\nXR-ZZZZ SPXTH0000000001", "UADMIN"), { line, adminUserId: "UADMIN", setTracking });
  assert.deepEqual(saved, ["XR-AB12=SPXTH0123456789", "XR-ZZZZ=SPXTH0000000001"]);
  assert.match(replies[0][0], /บันทึกเลขพัสดุแล้ว 1\/2 ออเดอร์/);
  assert.match(replies[0][0], /✗ XR-ZZZZ/);
  // ลูกค้าพิมพ์รูปแบบเดียวกัน → ไม่ถูกบันทึก
  await handleEvent(msg("XR-AB12 SPXTH9999999999", "UCUST"), { line, adminUserId: "UADMIN", setTracking, ask: async () => ({ reply: "ok", needsAdmin: false, adminNote: "" }), getImageSets: async () => [], getFaq: async () => "" } as any);
  assert.equal(saved.length, 2);
});

test("สรุปรายสัปดาห์: ดึงจาก Apps Script (action summary) → ข้อความสรุปภาษาไทย เรียงสินค้ายอดสูงสุดก่อน", async () => {
  const { fetchWeeklySummary, weeklyReportText } = await import("../lib/orderlog.ts");
  let body: any = null;
  const fetchFn = (async (_u: string, init: RequestInit) => {
    body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({
      ok: true, from: "2026-10-25", to: "2026-11-01", paidCount: 3, paidTotal: 1216, taxCount: 1, waiting: 1, mismatch: 0,
      byProduct: { "กรอบป้ายสแตนเลส": { count: 1, total: 309 }, "กรอบป้ายอะคริลิค": { count: 2, total: 907 } },
    }));
  }) as any;
  const s = (await fetchWeeklySummary({ url: "https://x/exec", secret: "S", fetchFn }))!;
  assert.deepEqual([body.action, body.days, body.secret], ["summary", 7, "S"]);
  const text = weeklyReportText(s);
  assert.match(text, /สรุปยอดขาย LINE 7 วันล่าสุด \(25 ต\.ค\. – 1 พ\.ย\.\)/);
  assert.match(text, /✅ ชำระแล้ว 3 ออเดอร์ · ยอดรวม 1,216\.-/);
  assert.ok(text.indexOf("กรอบป้ายอะคริลิค 2 ออเดอร์ · 907.-") < text.indexOf("กรอบป้ายสแตนเลส 1 ออเดอร์ · 309.-"));
  assert.match(text, /⏳ รอตรวจสลิป 1 · ❌ ยอดไม่ตรง 0/);
  assert.equal(await fetchWeeklySummary({ url: "", secret: "" }), null);
});
