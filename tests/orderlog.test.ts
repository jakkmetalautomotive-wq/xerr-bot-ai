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
