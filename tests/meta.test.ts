// Facebook Messenger / Instagram: แปลงข้อความเข้า-ออก + ส่งต่อให้สมองบอทตัวเดียวกับ LINE
import { msgText } from "./helpers.ts";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { _resetLocalState } from "../lib/state.ts";
import { verifyMetaSignature, toLineEvents, toMetaMessages, metaPort, routedPort, BOT_METADATA, type MetaWebhookBody } from "../lib/meta.ts";
import { handleEvent, type LinePort } from "../lib/bot.ts";
import { buildCarousel, CATEGORY_SET, type ImageSet } from "../lib/images.ts";
import { taxUpsellMessage, decodePostback, paidConfirmMessage } from "../lib/order.ts";
import { MENU } from "../lib/shop.ts";

beforeEach(() => _resetLocalState());

const fbBody = (messaging: unknown[]): MetaWebhookBody => ({ object: "page", entry: [{ id: "PAGE1", messaging: messaging as never }] });

test("ลายเซ็น webhook: ตรง = ผ่าน · แก้เนื้อหา/ไม่มีลายเซ็น = ไม่ผ่าน", () => {
  const body = '{"object":"page"}';
  const sig = "sha256=" + crypto.createHmac("sha256", "appsecret").update(body).digest("hex");
  assert.equal(verifyMetaSignature(body, sig, "appsecret"), true);
  assert.equal(verifyMetaSignature(body + " ", sig, "appsecret"), false);
  assert.equal(verifyMetaSignature(body, null, "appsecret"), false);
  assert.equal(verifyMetaSignature(body, sig, ""), false);
});

test("ข้อความเข้า: พิมพ์ / ปุ่มที่ส่งข้อความ / ปุ่ม postback / รูป / echo ของแอดมิน / บัญชีร้านเอง", () => {
  const events = toLineEvents(fbBody([
    { sender: { id: "111" }, recipient: { id: "PAGE1" }, message: { mid: "m1", text: "ราคาเท่าไหร่" } },
    { sender: { id: "111" }, recipient: { id: "PAGE1" }, message: { mid: "m2", text: "เลือกแบบที่ 1", quick_reply: { payload: "TX:เลือกแบบที่ 1 สีดำ" } } },
    { sender: { id: "111" }, recipient: { id: "PAGE1" }, postback: { title: "🛒 สั่งลายนี้", payload: 'PB:{"k":"rv","f":"plain"}' } },
    { sender: { id: "111" }, recipient: { id: "PAGE1" }, message: { mid: "m3", attachments: [{ type: "image", payload: { url: "https://cdn.fb/x.jpg" } }] } },
    { sender: { id: "PAGE1" }, recipient: { id: "111" }, message: { mid: "m4", text: "แอดมินตอบเอง", is_echo: true } },
    { sender: { id: "PAGE1" }, recipient: { id: "111" }, message: { mid: "m5", text: "บอทตอบ", is_echo: true, metadata: BOT_METADATA } },
  ]));
  const e = events.map((x) => (x.kind === "line" ? (x.event as any) : x));
  assert.equal(e[0].message.text, "ราคาเท่าไหร่");
  assert.equal(e[0].source.userId, "fb:111");
  assert.equal(e[0].replyToken, "fb:111");
  assert.equal(e[1].message.text, "เลือกแบบที่ 1 สีดำ"); // ข้อความเต็มที่ซ่อนในปุ่ม
  assert.equal(e[2].type, "postback");
  assert.deepEqual(decodePostback(e[2].postback.data), { k: "rv", f: "plain" });
  assert.equal(e[3].message.type, "image");
  assert.equal(e[3].message.contentProvider.originalContentUrl, "https://cdn.fb/x.jpg");
  assert.deepEqual(e[4], { kind: "human", userId: "fb:111" }); // แอดมินตอบเอง → บอทพัก
  assert.equal(e.length, 5); // echo ของบอทเองไม่นับ

  const ig = toLineEvents({ object: "instagram", entry: [{ id: "IG1", messaging: [
    { sender: { id: "222" }, recipient: { id: "IG1" }, message: { mid: "i1", text: "สวัสดี" } },
    { sender: { id: "IG1" }, recipient: { id: "222" }, message: { mid: "i2", text: "x", is_echo: true } },
  ] }] });
  assert.equal(ig.length, 1);
  assert.equal((ig[0] as any).event.source.userId, "ig:222");
});

const sets: ImageSet[] = [{
  name: CATEGORY_SET,
  items: [
    { order: 1, name: "อะคริลิค", price: "399.-", image: "https://x/1.jpg", detail: "สีเรียบ" },
    { order: 2, name: "สแตนเลส", price: "590.-", image: "https://x/2.jpg", detail: "" },
  ],
}];

test("ข้อความออก: ข้อความยาวตัดเป็นหลายข้อความ · ปุ่มด่วน · การ์ดปัด → การ์ด Messenger พร้อมปุ่ม", () => {
  const long = Array.from({ length: 60 }, (_, i) => `บรรทัดที่ ${i} ทาง LINE`).join("\n");
  const parts = toMetaMessages([long]) as { text: string }[];
  assert.ok(parts.length >= 2 && parts.every((p) => p.text.length <= 1000));
  assert.ok(!parts.some((p) => p.text.includes("ทาง LINE"))); // ช่องทาง Meta พูดว่า "ทางแชท"

  const [q] = toMetaMessages([{ type: "text", text: "เลือกได้เลย", quickReply: { items: [{ type: "action", action: { type: "message", label: MENU.order, text: MENU.order } }] } }]) as any[];
  assert.deepEqual(q.quick_replies, [{ content_type: "text", title: MENU.order, payload: `TX:${MENU.order}` }]);

  const [card] = toMetaMessages([buildCarousel(sets[0])]) as any[];
  const els = card.attachment.payload.elements;
  assert.equal(card.attachment.payload.template_type, "generic");
  assert.equal(els.length, 2);
  assert.match(els[0].title, /อะคริลิค/);
  assert.ok(els[0].image_url.startsWith("https://"));
  assert.equal(els[0].buttons[0].type, "postback");
  assert.match(els[0].buttons[0].payload, /^TX:/);
});

test("ข้อความออก: การ์ดชวนเพิ่มป้ายภาษี → รูป + 2 ปุ่ม postback · ยืนยันชำระ → ข้อความ + ปุ่ม 📦", () => {
  const [up] = toMetaMessages([taxUpsellMessage("อะคริลิค", ["สีดำ มีเส้นขอบ"])]) as any[];
  const el = up.attachment.payload.elements[0];
  assert.equal(el.buttons.length, 2);
  assert.ok(el.buttons.every((b: any) => b.payload.startsWith("PB:") && decodePostback(b.payload.slice(3))?.k === "tax"));

  const out = toMetaMessages([paidConfirmMessage("XR-AB12", 419)]) as any[];
  const last = out[out.length - 1];
  assert.match(last.text, /XR-AB12/);
  assert.ok(last.quick_replies?.some((r: any) => decodePostback(r.payload.slice(3))?.k === "trk"));
});

test("ส่งผ่าน Graph API: ลูกค้า Messenger แปะป้ายบอท · Instagram ไม่แปะ · ส่งตามลำดับ", async () => {
  const calls: any[] = [];
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    return new Response("{}");
  }) as typeof fetch;
  const port = metaPort("TOKEN", fakeFetch);
  await port.reply("fb:111", ["หนึ่ง", "สอง"]);
  await port.push("ig:222", ["สาม"]);
  assert.deepEqual(calls.map((c) => [c.recipient.id, c.message.text, c.message.metadata]), [
    ["111", "หนึ่ง", BOT_METADATA],
    ["111", "สอง", BOT_METADATA],
    ["222", "สาม", undefined],
  ]);
});

test("ทั้งระบบ: ลูกค้า Facebook กดสั่งซื้อ → การ์ดสินค้าทาง Messenger · แจ้งแอดมินทาง LINE บอกให้ตอบใน Meta", async () => {
  const toMeta: any[] = [];
  const toLine: { to: string; msgs: unknown[] }[] = [];
  const meta = metaPort("TOKEN", (async (_u: string, init: RequestInit) => (toMeta.push(JSON.parse(String(init.body))), new Response("{}"))) as typeof fetch);
  const line: LinePort = {
    reply: async (to, msgs) => void toLine.push({ to, msgs }),
    push: async (to, msgs) => void toLine.push({ to, msgs }),
    showLoading: async () => {},
    displayName: async () => "",
  };
  const deps = { line: routedPort(line, meta), adminUserId: "UADMIN", getFaq: async () => "faq", getImageSets: async () => sets };
  const [order] = toLineEvents(fbBody([{ sender: { id: "111" }, recipient: { id: "PAGE1" }, message: { mid: "m1", text: MENU.order } }]));
  await handleEvent((order as any).event, deps);
  const sent = toMeta.filter((c) => c.message);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].message.attachment.payload.template_type, "generic");
  assert.equal(toLine.length, 0);

  const [admin] = toLineEvents(fbBody([{ sender: { id: "111" }, recipient: { id: "PAGE1" }, message: { mid: "m2", text: MENU.admin } }]));
  await handleEvent((admin as any).event, deps);
  const notice = toLine.find((m) => m.to === "UADMIN");
  assert.ok(notice);
  assert.match(msgText(notice!.msgs[0]), /Facebook/);
  assert.match(msgText(notice!.msgs[0]), /Meta Business Suite/);
});
