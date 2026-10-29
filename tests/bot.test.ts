// ทดสอบแบบไม่ต้องใช้เน็ต/คีย์ — รัน: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { FinishReason } from "@google/genai";
import { parseCsv, csvToFaqText, getFaq, sheetUrls, _resetSheetCache } from "../lib/sheet.ts";
import { buildSystemPrompt, wrapQuestion } from "../lib/prompt.ts";
import { askGemini, parseAnswer } from "../lib/gemini.ts";
import { handleEvent, type LinePort } from "../lib/bot.ts";
import { adminNotice, DEFAULT_REPLY, ERROR_REPLY } from "../lib/shop.ts";

// ---------- Sheet ----------
test("อ่าน CSV ที่มี comma / ขึ้นบรรทัด / เครื่องหมายคำพูด ในช่อง", () => {
  const csv = 'หมวด,คำถาม,คำตอบ\r\nราคา,"ราคา, เท่าไหร่","ปกติ 550.-\nเหลือ 399.- ""ครับ"""\r\n,,\r\n';
  assert.deepEqual(parseCsv(csv), [
    ["หมวด", "คำถาม", "คำตอบ"],
    ["ราคา", "ราคา, เท่าไหร่", 'ปกติ 550.-\nเหลือ 399.- "ครับ"'],
  ]);
});

test("แปลง CSV เป็นข้อความ FAQ แถวละบรรทัด ตัดช่องว่าง", () => {
  const text = csvToFaqText("รหัส,สินค้า,หมายเหตุ\nabs,กรอบ ABS,\ntax-car,ป้ายภาษี,ใช้ซ้ำได้\n");
  assert.equal(text, "รหัส: abs | สินค้า: กรอบ ABS\nรหัส: tax-car | สินค้า: ป้ายภาษี | หมายเหตุ: ใช้ซ้ำได้");
});

test("ดึง Sheet หลายลิงก์ + cache 60 วิ + ใช้ของเก่าถ้าดึงไม่ได้", async () => {
  _resetSheetCache();
  process.env.SHEET_CSV_URL = "https://a.example/qa.csv, https://a.example/products.csv";
  let calls = 0;
  let fail = false;
  globalThis.fetch = (async (url: string) => {
    calls++;
    if (fail) return new Response("err", { status: 500 });
    return new Response(url.includes("qa") ? "คำถาม,คำตอบ\nส่งกี่วัน,1-2 วัน\n" : "สินค้า,ราคา\nABS,199\n");
  }) as typeof fetch;
  const t0 = 1_000_000;
  const faq = await getFaq(t0);
  assert.match(faq, /ส่งกี่วัน/);
  assert.match(faq, /ABS/);
  assert.equal(calls, 2);
  await getFaq(t0 + 30_000); // ยังอยู่ใน cache
  assert.equal(calls, 2);
  fail = true;
  assert.equal(await getFaq(t0 + 61_000), faq); // ดึงใหม่ไม่ได้ → ใช้ของเก่า
});

test("ได้หน้าเว็บแทน CSV → แจ้ง error ชัดเจน", async () => {
  _resetSheetCache();
  process.env.SHEET_CSV_URL = "https://a.example/edit";
  globalThis.fetch = (async () => new Response("<!DOCTYPE html><html>")) as unknown as typeof fetch;
  await assert.rejects(getFaq(), /ได้หน้าเว็บกลับมา/);
});

test("ลิงก์ Google Sheet ธรรมดา (/edit) → แปลงเป็นลิงก์ CSV ของทุกแท็บเอง", () => {
  const id = "1bWaaxkty1PJzn09B_p8os9_l5sPVgFTOqjDe3YeNyUc";
  const urls = sheetUrls(`https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing`, "");
  assert.equal(urls.length, 4);
  assert.ok(urls.every((u) => u.startsWith(`https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=`)));
  assert.ok(urls.some((u) => u.endsWith(encodeURIComponent("Q&A"))));
  // มี gid → แท็บเดียว · ลิงก์ CSV อยู่แล้ว → ใช้ตามเดิม
  assert.deepEqual(sheetUrls(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=784319218`, ""), [`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=784319218`]);
  const csv = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=1`;
  assert.deepEqual(sheetUrls(csv, ""), [csv]);
  assert.equal(sheetUrls(`https://docs.google.com/spreadsheets/d/${id}/edit`, "Q&A, สินค้าและราคา").length, 2);
});

// ---------- Prompt ----------
test("System prompt เรียง role → constraints → output_format → faq และคำถามอยู่แยกท้ายสุด", () => {
  const p = buildSystemPrompt("FAQ_HERE", "วันพฤหัสบดี 10:00 น.");
  const order = ["role", "constraints", "output_format", "faq"].map((t) => p.search(new RegExp(`^<${t}>$`, "m")));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(order.every((i) => i >= 0));
  assert.match(p, /FAQ_HERE/);
  assert.match(p, /ครับ/);
  assert.match(p, new RegExp(DEFAULT_REPLY.slice(0, 15)));
  assert.equal(wrapQuestion("สวัสดี"), "<question>\nสวัสดี\n</question>");
});

// ---------- Gemini (ตัวปลอม) ----------
function fakeGemini(text: string, finishReason = FinishReason.STOP) {
  const calls: any[] = [];
  const fn = (async (params: any) => {
    calls.push(params);
    return { text, candidates: [{ finishReason }], usageMetadata: { thoughtsTokenCount: 120, candidatesTokenCount: 40 } };
  }) as any;
  return { fn, calls };
}

test("ส่งค่าตามสเปก: temperature 1.0, maxOutputTokens 1024, คำถามอยู่ท้าย", async () => {
  const g = fakeGemini('{"reply":"ส่ง SPX ครับ","needs_admin":false,"admin_note":""}');
  const a = await askGemini("faq", [], "ส่งขนส่งอะไร", "now", g.fn);
  assert.deepEqual(a, { reply: "ส่ง SPX ครับ", needsAdmin: false, adminNote: "" });
  const cfg = g.calls[0].config;
  assert.equal(cfg.temperature, 1.0);
  assert.equal(cfg.maxOutputTokens, 1024);
  assert.equal(cfg.responseMimeType, "application/json");
  assert.match(g.calls[0].contents.at(-1).parts[0].text, /<question>\nส่งขนส่งอะไร/);
});

test("finishReason = MAX_TOKENS → ส่ง default reply ไม่ส่งครึ่งประโยค", async () => {
  const g = fakeGemini('{"reply":"กรอบป้ายของร้านใส่ได้ทุกรุ่นครับ ส่วนขนาด', FinishReason.MAX_TOKENS);
  const a = await askGemini("faq", [], "ใส่ได้ไหม", "now", g.fn);
  assert.equal(a.reply, DEFAULT_REPLY);
  assert.equal(a.needsAdmin, true);
});

test("คำตอบ AI เสีย / มี markdown → จัดการได้", () => {
  assert.equal(parseAnswer("not json", "q").reply, DEFAULT_REPLY);
  assert.equal(parseAnswer('{"reply":"**ราคา** 199.- ครับ","needs_admin":false,"admin_note":""}', "q").reply, "ราคา 199.- ครับ");
});

// ---------- ทั้งระบบ (LINE ปลอม) ----------
function fakeLine() {
  const sent: { kind: string; to: string; texts: string[] }[] = [];
  const line: LinePort = {
    reply: async (to, texts) => void sent.push({ kind: "reply", to, texts }),
    push: async (to, texts) => void sent.push({ kind: "push", to, texts }),
    showLoading: async () => {},
    displayName: async () => "คุณทดสอบ",
  };
  return { line, sent };
}
const msgEvent = (message: any, userId = "U1") => ({ type: "message", source: { type: "user", userId }, replyToken: "rt", message }) as any;

test("ตอบปกติ: ไม่แจ้งแอดมิน", async () => {
  const { line, sent } = fakeLine();
  await handleEvent(msgEvent({ type: "text", text: "ราคา ABS" }), {
    line, adminUserId: "UADMIN", getFaq: async () => "faq",
    ask: async () => ({ reply: "ปกติ 350.- สั่งตรงกับร้านเหลือ 199.- ครับ", needsAdmin: false, adminNote: "" }),
  });
  assert.deepEqual(sent, [{ kind: "reply", to: "rt", texts: ["ปกติ 350.- สั่งตรงกับร้านเหลือ 199.- ครับ"] }]);
});

test("ไม่มีใน FAQ: ตอบ default + บอกเวลาแอดมิน + แจ้งแอดมิน", async () => {
  const { line, sent } = fakeLine();
  await handleEvent(msgEvent({ type: "text", text: "มีกรอบป้ายเรืองแสงไหม" }), {
    line, adminUserId: "UADMIN", getFaq: async () => "faq",
    ask: async () => ({ reply: DEFAULT_REPLY, needsAdmin: true, adminNote: "" }),
  });
  assert.deepEqual(sent[0].texts, [DEFAULT_REPLY, adminNotice()]);
  assert.equal(sent[1].kind, "push");
  assert.equal(sent[1].to, "UADMIN");
  assert.match(sent[1].texts[0], /เรืองแสง/);
});

test("Sheet ดึงไม่ได้ / Gemini timeout → ขอโทษลูกค้า + แจ้งแอดมิน", async () => {
  const { line, sent } = fakeLine();
  await handleEvent(msgEvent({ type: "text", text: "ราคา" }), {
    line, adminUserId: "UADMIN", getFaq: async () => { throw new Error("timeout"); },
  });
  assert.equal(sent[0].texts[0], ERROR_REPLY);
  assert.match(sent[1].texts[0], /ระบบขัดข้อง/);
});

test("LINE reply ไม่ได้ → ส่งแบบ push แทน", async () => {
  const { line, sent } = fakeLine();
  line.reply = async () => { throw new Error("Invalid reply token"); };
  await handleEvent(msgEvent({ type: "text", text: "สวัสดี" }), {
    line, getFaq: async () => "faq", ask: async () => ({ reply: "สวัสดีครับ", needsAdmin: false, adminNote: "" }),
  });
  assert.deepEqual(sent, [{ kind: "push", to: "U1", texts: ["สวัสดีครับ"] }]);
});

test("ส่งรูป → ไม่เรียก AI ส่งต่อแอดมินทันที · พิมพ์ myid → ได้ user ID", async () => {
  const { line, sent } = fakeLine();
  let asked = false;
  const deps = { line, adminUserId: "UADMIN", getFaq: async () => "faq", ask: async () => { asked = true; return { reply: "", needsAdmin: false, adminNote: "" }; } };
  await handleEvent(msgEvent({ type: "image", id: "1" }), deps);
  assert.equal(asked, false);
  assert.match(sent[0].texts[0], /ได้รับรูป/);
  assert.equal(sent[1].to, "UADMIN");
  await handleEvent(msgEvent({ type: "text", text: "myid" }, "Uxyz"), deps);
  assert.deepEqual(sent[2].texts, ["Uxyz"]);
});
