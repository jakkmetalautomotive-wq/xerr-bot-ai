// ทดสอบแบบไม่ต้องใช้เน็ต/คีย์ — รัน: npm test
import { upsellChoice } from "./helpers.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { FinishReason } from "@google/genai";
import { parseCsv, csvToFaqText, getFaq, sheetUrls, _resetSheetCache } from "../lib/sheet.ts";
import { buildSystemPrompt, wrapQuestion } from "../lib/prompt.ts";
import { askGemini, parseAnswer } from "../lib/gemini.ts";
import { handleEvent, type LinePort, type OutMessage } from "../lib/bot.ts";
import { adminNotice, DEFAULT_REPLY, ERROR_REPLY, MENU } from "../lib/shop.ts";
import { verifySlip } from "../lib/slip.ts";

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
  const g = fakeGemini('{"reply":"ส่ง SPX ครับ","needs_admin":false,"admin_note":"","show_set":""}');
  const a = await askGemini("faq", [], "ส่งขนส่งอะไร", "now", { generate: g.fn });
  assert.deepEqual(a, { reply: "ส่ง SPX ครับ", needsAdmin: false, adminNote: "", showSet: "" });
  const cfg = g.calls[0].config;
  assert.equal(cfg.temperature, 1.0);
  assert.equal(cfg.maxOutputTokens, 1024);
  assert.equal(cfg.responseMimeType, "application/json");
  assert.match(g.calls[0].contents.at(-1).parts[0].text, /<question>\nส่งขนส่งอะไร/);
});

test("finishReason = MAX_TOKENS → ส่ง default reply ไม่ส่งครึ่งประโยค", async () => {
  const g = fakeGemini('{"reply":"กรอบป้ายของร้านใส่ได้ทุกรุ่นครับ ส่วนขนาด', FinishReason.MAX_TOKENS);
  const a = await askGemini("faq", [], "ใส่ได้ไหม", "now", { generate: g.fn });
  assert.equal(a.reply, DEFAULT_REPLY);
  assert.equal(a.needsAdmin, true);
});

test("คำตอบ AI เสีย / มี markdown → จัดการได้", () => {
  assert.equal(parseAnswer("not json", "q").reply, DEFAULT_REPLY);
  assert.equal(parseAnswer('{"reply":"**ราคา** 199.- ครับ","needs_admin":false,"admin_note":""}', "q").reply, "ราคา 199.- ครับ");
});

// ---------- ทั้งระบบ (LINE ปลอม) ----------
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

test("ลูกค้าส่งสลิป (รูป) → ส่งรูปนั้นเข้าแชทแอดมินด้วย ผ่านลิงก์ /api/slip ที่เซ็นไว้ · ไฟล์ส่งแค่ข้อความ", async () => {
  const { line, sent } = fakeLine();
  const deps = { line, adminUserId: "UADMIN", orderSecret: "secret", ask: async () => { throw new Error("ไม่ควรเรียก AI"); } };
  await handleEvent(msgEvent({ type: "image", id: "598765432101", contentProvider: { type: "line" } }), deps);
  const [note, image] = sent[1].texts;
  assert.match(note, /รูปอยู่ด้านล่าง/);
  assert.equal(image.type, "image");
  const t = new URL(image.originalContentUrl).searchParams.get("t")!;
  assert.match(image.originalContentUrl, /^https:\/\/.+\/api\/slip\?t=/);
  assert.equal(image.previewImageUrl, `${image.originalContentUrl}&p=1`);
  assert.equal(verifySlip(t, "secret"), "598765432101");
  // ลายเซ็นผิด / แก้เลขข้อความ / คีย์อื่น → เปิดไม่ได้
  assert.equal(verifySlip(t.replace("598765432101", "598765432102"), "secret"), null);
  assert.equal(verifySlip(t, "other"), null);
  assert.equal(verifySlip("598765432101", "secret"), null);
  // ไฟล์ PDF → แจ้งแอดมินด้วยข้อความอย่างเดียว
  await handleEvent(msgEvent({ type: "file", id: "2", fileName: "a.pdf" }), deps);
  assert.equal(sent[3].texts.length, 1);
});

// ---------- การ์ดรูป ----------
import { parseImageSets, buildCarousel, driveFileId, lineImageUrl, sampleSets, findSet, choiceText } from "../lib/images.ts";

test("อ่านแท็บรูปสินค้า: จัดกลุ่มตามชุด เรียงตามลำดับ แถวไม่มีรูปยังอยู่ (ใช้เป็นปุ่มด่วน) · แท็บผิด → ว่าง", () => {
  const csv = [
    "ชุดรูป,ลำดับ,ชื่อแบบ,ราคา,ลิงก์รูป,รายละเอียด",
    "สีอะคริลิค,2,ขาว,399.-,https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view?usp=sharing,",
    "สีอะคริลิค,1,ดำ,399.-,https://example.com/black.jpg,มีเส้นขอบ",
    "สีอะคริลิค,3,เทา,399.-,,",
    "รุ่นกรอบ,1,สแตนเลส,279.-,https://example.com/ss.png,",
  ].join("\n");
  const sets = parseImageSets(csv);
  assert.deepEqual(sets.map((s) => [s.name, s.items.map((i) => i.name)]), [["สีอะคริลิค", ["ดำ", "ขาว", "เทา"]], ["รุ่นกรอบ", ["สแตนเลส"]]]);
  assert.deepEqual(parseImageSets("รหัส,สินค้า\nabs,ABS\n"), []);
});

test("ลิงก์ Google Drive → ส่งผ่าน /api/img · ลิงก์รูปตรงใช้ตามเดิม", () => {
  assert.equal(driveFileId("https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view?usp=sharing"), "1AbCdEfGhIjKlMn");
  assert.equal(driveFileId("https://drive.google.com/open?id=1AbCdEfGhIjKlMn"), "1AbCdEfGhIjKlMn");
  assert.match(lineImageUrl("https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view"), /^https:\/\/.+\/api\/img\?id=1AbCdEfGhIjKlMn&v=4$/);
  assert.equal(lineImageUrl("https://example.com/a.jpg"), "https://example.com/a.jpg");
});

test("การ์ดปัดดู (7 สี): ใบละแบบ มีรูป https + ปุ่มเลือกแบบที่ N ที่ส่งข้อความกลับ", () => {
  const set = sampleSets()[1];
  const flex = buildCarousel(set);
  assert.equal(flex.type, "flex");
  assert.ok(flex.altText.length <= 400);
  const bubbles = (flex.contents as any).contents;
  assert.equal(bubbles.length, 7);
  assert.match(bubbles[0].hero.url, /^https:\/\/.+\/api\/img\?id=1ObHYDZaanBdC3UhtulEtHT41kmFgfrGh&v=4$/); // รูปจริงจาก Drive ผ่าน /api/img
  assert.match(bubbles[6].hero.url, /\/api\/img\?id=15UyD2nLQugAuI4-F8Ezdkz3YpnrfbwRe&v=4$/); // เคฟล่า
  const action = bubbles[3].footer.contents[0].action;
  assert.equal(action.type, "message");
  assert.equal(action.label, "เลือกแบบที่ 4");
  assert.equal(action.text, choiceText(set, set.items[3]));
  assert.ok(action.label.length <= 20);
});

test("หาชุดรูปจากชื่อที่ AI ตอบ (ตรงหรือใกล้เคียง)", () => {
  const sets = sampleSets();
  assert.equal(findSet(sets, "อะคริลิค ขั้น 1 เลือกสี")?.name, "อะคริลิค ขั้น 1 เลือกสี");
  assert.equal(findSet(sets, "ขั้น 2 เลือกขนาด")?.name, "อะคริลิค ขั้น 2 เลือกขนาด");
  assert.equal(findSet(sets, ""), undefined);
  assert.equal(findSet(sets, "ชายบันได"), undefined);
});

test("AI ขอให้ส่งการ์ด → ลูกค้าได้ข้อความ + การ์ด ในคำตอบเดียว", async () => {
  const { line, sent } = fakeLine();
  let setsSeen: string[] = [];
  await handleEvent(msgEvent({ type: "text", text: "อะคริลิคมีสีอะไรบ้าง" }), {
    line, getFaq: async () => "faq", getImageSets: async () => sampleSets(),
    ask: async (_f, _q, _u, sets) => { setsSeen = sets; return { reply: "มี 4 แบบครับ เลือกแบบที่ชอบได้เลยครับ", needsAdmin: false, adminNote: "", showSet: "อะคริลิค ขั้น 1 เลือกสี" }; },
  });
  assert.equal(setsSeen.length, sampleSets().length);
  assert.equal(sent[0].texts.length, 2);
  assert.equal(sent[0].texts[0], "มี 4 แบบครับ เลือกแบบที่ชอบได้เลยครับ");
  assert.equal((sent[0].texts[1] as any).type, "flex");
});

// ---------- เลือกเป็นขั้นตอน ----------
import { parseChoice, nextStepSet, stepOf } from "../lib/images.ts";

test("ชุดตัวอย่างอะคริลิค 3 ขั้น: สี (รวมเส้นขอบ) → ขนาด → เส้นคาดกลาง", () => {
  const sets = sampleSets();
  assert.deepEqual(sets.slice(1, 4).map((s) => s.name), ["อะคริลิค ขั้น 1 เลือกสี", "อะคริลิค ขั้น 2 เลือกขนาด", "อะคริลิค ขั้น 3 เลือกเส้นคาดกลาง"]);
  assert.deepEqual(sets[1].items.map((i) => i.name), [
    "สีดำ มีเส้นขอบ", "สีดำ ไร้เส้นขอบ", "สีขาว มีเส้นขอบ", "สีขาว ไร้เส้นขอบ", "สีเทา มีเส้นขอบ", "สีเทา ไร้เส้นขอบ", "ลายเคฟล่า ดำ มีเส้นขอบ",
  ]);
  assert.deepEqual(sets[2].items.map((i) => [i.name, i.price]), [["สั้น-สั้น", "399.-"], ["สั้น-ยาว", "419.-"], ["ยาว-ยาว", "419.-"]]);
});

test("สีขาวไร้ขอบ → สั้น-ยาว → ไม่มีเส้นคาดกลาง → จบ · ปุ่มพกตัวเลือกก่อนหน้า", () => {
  const sets = sampleSets();
  const color = parseChoice(choiceText(sets[1], sets[1].items[3]), sets)!;
  assert.deepEqual(color.picked, ["สีขาว ไร้เส้นขอบ"]);
  assert.equal(nextStepSet(sets, color.set, color.picked)?.name, "อะคริลิค ขั้น 2 เลือกขนาด");
  const size = parseChoice(choiceText(sets[2], sets[2].items[1], color.picked), sets)!;
  assert.deepEqual(size.picked, ["สีขาว ไร้เส้นขอบ", "สั้น-ยาว"]);
  assert.equal(nextStepSet(sets, size.set, size.picked)?.name, "อะคริลิค ขั้น 3 เลือกเส้นคาดกลาง");
  const center = parseChoice(choiceText(sets[3], sets[3].items[1], size.picked), sets)!;
  assert.deepEqual(center.picked, ["สีขาว ไร้เส้นขอบ", "สั้น-ยาว", "ไม่มีเส้นคาดกลาง"]);
  assert.equal(nextStepSet(sets, center.set, center.picked), undefined);
  assert.equal(parseChoice("สวัสดีครับ", sets), null);
});

test("ข้ามขั้น (ใช้กับชีตของจักรได้): แบบที่มี 'ข้ามขั้นXXX' → ข้ามชุดที่ชื่อมี XXX", () => {
  const mk = (name: string, items: [string, string][]) => ({ name, items: items.map(([n, d], i) => ({ order: i + 1, name: n, price: "", image: "https://x/a.png", detail: d })) });
  const sets = [mk("สแตนเลส ขั้น 1 เลือกแบบ", [["ขอบใหญ่", ""], ["คางหมู", "ข้ามขั้นเลือกแผ่นใส"]]), mk("สแตนเลส ขั้น 2 เลือกแผ่นใส", [["มีแผ่นใส", ""]]), mk("สแตนเลส ขั้น 3 เลือกขนาด", [["มาตรฐาน", ""]])];
  assert.equal(nextStepSet(sets, sets[0], ["ขอบใหญ่"])?.name, "สแตนเลส ขั้น 2 เลือกแผ่นใส");
  assert.equal(nextStepSet(sets, sets[0], ["คางหมู"])?.name, "สแตนเลส ขั้น 3 เลือกขนาด");
});

test("AI ล่มตอนลูกค้ากดการ์ด → ยังส่งขั้นถัดไปได้ ไม่ตอบว่าระบบขัดข้อง", async () => {
  const { line, sent } = fakeLine();
  const sets = sampleSets();
  await handleEvent(msgEvent({ type: "text", text: choiceText(sets[2], sets[2].items[0], ["สีดำ มีเส้นขอบ"]) }), {
    line, adminUserId: "UADMIN", getFaq: async () => "faq", getImageSets: async () => sets,
    ask: async () => { throw new Error("This operation was aborted"); },
  });
  assert.notEqual(sent[0].texts[0], ERROR_REPLY);
  assert.match(sent[0].texts[1].altText, /ขั้น 3 เลือกเส้นคาดกลาง/);
  assert.match(sent[0].texts[1].contents.contents[0].footer.contents[0].action.text, /เลือกแล้ว: สีดำ มีเส้นขอบ, สั้น-สั้น$/);
  assert.equal(sent.length, 1); // ไม่ต้องแจ้งแอดมิน
});

test("Sheet/AI ล่มตอนกดขั้นสุดท้าย → ยังเข้าขั้นสั่งซื้อได้ (คิดยอดจากการ์ด ไม่ต้องใช้ AI)", async () => {
  const { line, sent } = fakeLine();
  const sets = sampleSets();
  await handleEvent(msgEvent({ type: "text", text: choiceText(sets[3], sets[3].items[0], ["สีเทา ไร้เส้นขอบ", "สั้น-ยาว"]) }), {
    line, adminUserId: "UADMIN", getFaq: async () => { throw new Error("sheet down"); }, getImageSets: async () => sets,
  });
  assert.match(sent[0].texts[0].altText, /สรุปที่เลือก: กรอบป้ายอะคริลิค สีเทา ไร้เส้นขอบ \/ สั้น-ยาว \/ มีเส้นคาดกลาง/);
});

test("สินค้าที่การ์ดไม่มีราคา + AI ล่มตอนขั้นสุดท้าย → สรุปที่เลือก + แจ้งแอดมิน", async () => {
  const { line, sent } = fakeLine();
  const mk = (name: string, names: string[]) => ({ name, items: names.map((n, i) => ({ order: i + 1, name: n, price: "", image: "https://x/a.png", detail: "" })) });
  const sets = [mk("สแตนเลส ขั้น 1 เลือกแบบ", ["ขอบใหญ่"]), mk("สแตนเลส ขั้น 2 เลือกแผ่นใส", ["มีแผ่นใส"])];
  await handleEvent(msgEvent({ type: "text", text: choiceText(sets[1], sets[1].items[0], ["ขอบใหญ่"]) }), {
    line, adminUserId: "UADMIN", getFaq: async () => { throw new Error("sheet down"); }, getImageSets: async () => sets,
  });
  assert.match(sent[0].texts[0], /สรุปที่เลือก: ขอบใหญ่, มีแผ่นใส/);
  assert.equal(sent[1].to, "UADMIN");
  assert.match(sent[1].texts[0], /เลือกครบแล้ว: ขอบใหญ่, มีแผ่นใส \(สแตนเลส\)/);
});

test("ลูกค้ากดเลือกสี แต่ AI ลืมส่งขั้นต่อ → บอทส่งการ์ดขั้นขนาดให้เอง (ปุ่มพกสีที่เลือก)", async () => {
  const { line, sent } = fakeLine();
  const sets = sampleSets();
  await handleEvent(msgEvent({ type: "text", text: choiceText(sets[1], sets[1].items[0]) }), {
    line, getFaq: async () => "faq", getImageSets: async () => sets,
    ask: async () => ({ reply: "รับทราบสีดำครับ", needsAdmin: false, adminNote: "", showSet: "" }),
  });
  const flex = sent[0].texts[1];
  assert.equal(flex.type, "flex");
  assert.match(flex.altText, /ขั้น 2 เลือกขนาด/);
  assert.match(flex.contents.contents[0].footer.contents[0].action.text, /\| เลือกแล้ว: สีดำ มีเส้นขอบ$/);
});

// ---------- สั่งซื้อ ----------
import { priceOrder, signOrder, verifyOrder, singlePrice, validateAddress, decodePostback, orderSummaryText, newOrderCode, addressSentText } from "../lib/order.ts";
import { isRetryable, suggestedModel, _resetQuotaMemory } from "../lib/gemini.ts";

const PICKS = ["สีดำ มีเส้นขอบ", "สั้น-ยาว", "มีเส้นคาดกลาง"];

test("คิดยอดด้วยโค้ด: ราคาจากขนาด + ป้ายภาษี 69 / ค่าส่ง 30 หรือฟรี", () => {
  const sets = sampleSets();
  assert.equal(singlePrice("419.-"), 419);
  assert.equal(singlePrice("399.- / 419.-"), null);
  const noTax = priceOrder(sets, { code: "XR-T", product: "อะคริลิค", picks: PICKS, tax: false })!;
  assert.deepEqual([noTax.base, noTax.taxPrice, noTax.shipping, noTax.total], [419, 0, 30, 449]);
  const withTax = priceOrder(sets, { code: "XR-T", product: "อะคริลิค", picks: ["สีขาว ไร้เส้นขอบ", "สั้น-สั้น", "ไม่มีเส้นคาดกลาง"], tax: true })!;
  assert.deepEqual([withTax.base, withTax.taxPrice, withTax.shipping, withTax.total], [399, 69, 0, 468]);
  assert.equal(priceOrder(sets, { code: "x", product: "อะคริลิค", picks: ["สีชมพู"], tax: false }), null);
  assert.match(newOrderCode(), /^XR-[A-Z2-9]{4}$/);
});

test("ลายเซ็นออเดอร์: แก้ยอด/รายการในลิงก์ → ใช้ไม่ได้", () => {
  const token = signOrder({ code: "XR-AB12", product: "อะคริลิค", picks: PICKS, tax: true, total: 488 }, "secret");
  assert.deepEqual(verifyOrder(token, "secret"), { code: "XR-AB12", product: "อะคริลิค", picks: PICKS, tax: true, total: 488 });
  assert.equal(verifyOrder(token, "other-secret"), null);
  const [data, sig] = token.split(".");
  const forged = Buffer.from(Buffer.from(data, "base64url").toString().replace("488", "1")).toString("base64url");
  assert.equal(verifyOrder(`${forged}.${sig}`, "secret"), null);
});

test("สรุปออเดอร์: ใช้เทมเพลตจักร คำผู้ชาย มีเลขบัญชีจาก PAYMENT_INFO · ไม่มีเลขบัญชี → บอกว่าแอดมินจะส่งให้", () => {
  const o = priceOrder(sampleSets(), { code: "XR-AB12", product: "อะคริลิค", picks: PICKS, tax: true })!;
  const text = orderSummaryText(o, "🏦 KTB : 000-0-00000-0", true);
  assert.match(text, /ออเดอร์ XR-AB12/);
  assert.match(text, /กรอบป้ายอะคริลิค: สีดำ มีเส้นขอบ \/ สั้น-ยาว \/ มีเส้นคาดกลาง  419\.-/);
  assert.match(text, /ค่าส่ง SPX: ฟรี/);
  assert.match(text, /ยอดชำระ 488\.-/);
  assert.match(text, /KTB/);
  assert.doesNotMatch(text, /ค่ะ|นะคะ/);
  assert.match(orderSummaryText(o, "", true), /แอดมินส่งเลขบัญชีให้/);
});

test("ตรวจแบบฟอร์มที่อยู่", () => {
  assert.equal(validateAddress({ name: "สมชาย ใจดี", phone: "081-234-5678", address: "99/1 ถ.สุขุมวิท บางนา กรุงเทพฯ", zip: "10260" }).ok, true);
  assert.match((validateAddress({ name: "สมชาย", phone: "12345", address: "99/1 ถ.สุขุมวิท บางนา", zip: "10260" }) as any).error, /เบอร์โทร/);
  assert.match((validateAddress({ name: "สมชาย", phone: "0812345678", address: "สั้น", zip: "10260" }) as any).error, /ที่อยู่/);
  assert.match((validateAddress({ name: "สมชาย", phone: "0812345678", address: "99/1 ถ.สุขุมวิท บางนา", zip: "102" }) as any).error, /รหัสไปรษณีย์/);
});

const postbackEvent = (data: string, userId = "U1") => ({ type: "postback", source: { type: "user", userId }, replyToken: "rt", postback: { data } }) as any;

test("กดการ์ดขั้นสุดท้าย → ชวนเพิ่มป้ายภาษี (ไม่ต้องรอ AI)", async () => {
  const { line, sent } = fakeLine();
  const sets = sampleSets();
  let asked = false;
  await handleEvent(msgEvent({ type: "text", text: choiceText(sets[3], sets[3].items[0], ["สีดำ มีเส้นขอบ", "สั้น-ยาว"]) }), {
    line, getFaq: async () => "faq", getImageSets: async () => sets, ask: async () => { asked = true; return { reply: "", needsAdmin: false, adminNote: "" }; },
  });
  assert.equal(asked, false);
  const msg = sent[0].texts[0];
  assert.equal(msg.type, "flex");
  assert.match(msg.altText, /เพิ่มกรอบป้ายภาษี/);
  const photo = msg.contents.body.contents[0].contents[0];
  assert.equal(photo.width, "200px"); // ย่อจากเต็มการ์ด
  assert.match(photo.contents[0].url, /^https:\/\/.+\/products\/tax-car\.jpg$/);
  // ปุ่มใหญ่พื้นขาวตัวดำ + ✅ / ❌
  const buttons = msg.contents.footer.contents;
  assert.deepEqual(buttons.map((b: any) => [b.contents[0].text, b.backgroundColor, b.contents[0].color, b.contents[0].size]), [
    ["✅ เพิ่มป้าย พรบ. 69.-", "#FFFFFF", "#111111", "lg"],
    ["❌ ไม่เพิ่ม", "#FFFFFF", "#111111", "lg"],
  ]);
  assert.ok(buttons.every((b: any) => b.action.label.length <= 20));
  const yes = decodePostback(upsellChoice(msg, 0))!;
  assert.deepEqual(yes, { k: "tax", y: 1, p: "อะคริลิค", s: PICKS });
});

test("กด 'เพิ่มป้ายภาษี' → สรุปยอด + ปุ่มกรอกที่อยู่ (ลิงก์ LIFF พร้อมออเดอร์ที่เซ็นแล้ว)", async () => {
  const { line, sent } = fakeLine();
  await handleEvent(postbackEvent(JSON.stringify({ k: "tax", y: 1, p: "อะคริลิค", s: PICKS })), {
    line, getImageSets: async () => sampleSets(), liffId: "1234-abcd", paymentInfo: "🏦 KTB : 000", orderSecret: "secret", adminUserId: "UADMIN",
  });
  const [summary, button] = sent[0].texts;
  assert.match(summary, /ยอดชำระ 488\.-/);
  const uri = button.contents.body.contents[2].action.uri as string;
  assert.match(uri, /^https:\/\/liff\.line\.me\/1234-abcd\?o=/);
  const order = verifyOrder(decodeURIComponent(uri.split("?o=")[1]), "secret")!;
  assert.equal(order.total, 488);
  assert.equal(sent.length, 1); // มีเลขบัญชีแล้ว ไม่ต้องรบกวนแอดมิน
});

test("ปุ่มแอดมิน: แอดมินกด ✅ → แจ้งลูกค้า · คนอื่นกด → ไม่มีผล", async () => {
  const data = JSON.stringify({ k: "adm", a: "ok", c: "XR-AB12", u: "UCUST", t: 488 });
  const a = fakeLine();
  await handleEvent(postbackEvent(data, "UADMIN"), { line: a.line, adminUserId: "UADMIN" });
  assert.equal(a.sent[0].to, "UCUST");
  assert.match(a.sent[0].texts[0].altText, /ได้รับยอดชำระ 488\.- แล้วครับ ✅ ออเดอร์ XR-AB12/);
  assert.match(a.sent[1].texts[0], /ยืนยันออเดอร์ XR-AB12 แล้ว/);
  const b = fakeLine();
  await handleEvent(postbackEvent(data, "UHACKER"), { line: b.line, adminUserId: "UADMIN" });
  assert.equal(b.sent.length, 0);
});

test("ลูกค้าส่งแบบฟอร์มแล้ว (ข้อความจากแบบฟอร์ม) → บอทยืนยันทันที ไม่เรียก AI", async () => {
  const { line, sent } = fakeLine();
  await handleEvent(msgEvent({ type: "text", text: addressSentText("XR-AB12", 488) }), { line, ask: async () => { throw new Error("ไม่ควรเรียก"); } });
  assert.match(sent[0].texts[0], /รับที่อยู่จัดส่งแล้วครับ ✅ ออเดอร์ XR-AB12\nโอนยอด 488\.-/);
});

const OK_RES = { text: '{"reply":"ได้ครับ","needs_admin":false,"admin_note":"","show_set":""}', candidates: [{ finishReason: FinishReason.STOP }], usageMetadata: {} };
const noWait = async () => {};
// generate ปลอม: ตอบตามลำดับที่กำหนด (Error = โยน) และจดว่าเรียกรุ่นไหน ด้วย config อะไร
function scripted(...steps: (Error | "ok")[]) {
  const calls: { model: string; config: any }[] = [];
  const fn = (async (p: any) => {
    calls.push({ model: p.model, config: p.config });
    const s = steps[calls.length - 1];
    if (s instanceof Error) throw s;
    return OK_RES;
  }) as any;
  return { fn, calls };
}
const HIGH_DEMAND = new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}');
const DEADLINE = new Error('{"error":{"code":504,"message":"Deadline expired before operation could complete.","status":"DEADLINE_EXCEEDED"}}');

test("Gemini ชนโควตา/ขัดข้องชั่วคราว → ลองใหม่ได้ · error อื่นไม่ลองซ้ำ", () => {
  assert.equal(isRetryable('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}'), true);
  assert.equal(isRetryable(HIGH_DEMAND.message), true);
  assert.equal(isRetryable(DEADLINE.message), true);
  assert.equal(isRetryable("404 NOT_FOUND model"), false);
  assert.equal(isRetryable("API key not valid"), false);
});

test("รุ่นหลักล่ม 503 (เหตุการณ์จริง 29 ต.ค. 21:02) → ลองรุ่นสำรอง (ไม่ส่ง thinkingLevel ให้รุ่นเก่า) แล้วตอบได้", async () => {
  const g = scripted(HIGH_DEMAND, "ok");
  const a = await askGemini("faq", [], "กรอบป้ายอะคริลิคกันน้ำไหม", "now", { generate: g.fn, model: "gemini-3.5-flash", fallbackModel: "gemini-2.5-flash", wait: noWait });
  assert.equal(a.reply, "ได้ครับ");
  assert.deepEqual(g.calls.map((c) => c.model), ["gemini-3.5-flash", "gemini-2.5-flash"]);
  assert.ok(g.calls[0].config.thinkingConfig);
  assert.equal(g.calls[1].config.thinkingConfig, undefined);
});

test("504 ทั้งรุ่นหลักและรุ่นสำรอง → กลับไปลองรุ่นหลักอีกครั้ง · รุ่นสำรองชื่อผิด (404) ก็ข้ามไปลองต่อ", async () => {
  const a = scripted(DEADLINE, DEADLINE, "ok");
  assert.equal((await askGemini("faq", [], "q", "now", { generate: a.fn, model: "gemini-3.5-flash", fallbackModel: "gemini-2.5-flash", wait: noWait })).reply, "ได้ครับ");
  assert.deepEqual(a.calls.map((c) => c.model), ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-3.5-flash"]);
  const b = scripted(HIGH_DEMAND, new Error("404 NOT_FOUND models/gemini-x"), "ok");
  assert.equal((await askGemini("faq", [], "q", "now", { generate: b.fn, model: "gemini-3.5-flash", fallbackModel: "gemini-x", wait: noWait })).reply, "ได้ครับ");
  assert.equal(b.calls.length, 3);
});

test("รุ่นหลัก error ที่ลองซ้ำไม่ช่วย (คีย์ผิด) → หยุดทันที · ล่มครบทุกรอบ → โยน error เดิม", async () => {
  const a = scripted(new Error("API key not valid"));
  await assert.rejects(askGemini("faq", [], "q", "now", { generate: a.fn, wait: noWait }), /API key not valid/);
  assert.equal(a.calls.length, 1);
  const b = scripted(HIGH_DEMAND, HIGH_DEMAND, HIGH_DEMAND);
  await assert.rejects(askGemini("faq", [], "q", "now", { generate: b.fn, model: "gemini-3.5-flash", fallbackModel: "gemini-2.5-flash", wait: noWait }), /high demand/);
  assert.equal(b.calls.length, 3);
});

test("AI ล่มจนตอบไม่ได้ → ข้อความขอโทษ + ปุ่มเมนู สั่งซื้อ/ราคา/วิธีติดตั้ง/รีวิว ที่ข้อความสุดท้าย + แจ้งแอดมิน", async () => {
  const { line, sent } = fakeLine();
  await handleEvent(msgEvent({ type: "text", text: "กรอบป้ายอะคริลิคส่งกี่วันถึงครับ" }), {
    line, adminUserId: "UADMIN", getFaq: async () => "faq", getImageSets: async () => sampleSets(), ask: async () => { throw HIGH_DEMAND; },
  });
  const texts = sent[0].texts;
  assert.match(texts[0], /ขัดข้องชั่วคราว/);
  const last = texts[texts.length - 1];
  assert.deepEqual(last.quickReply.items.map((i: any) => i.action.text), [MENU.order, MENU.price, MENU.promo, MENU.install, MENU.review, MENU.admin, MENU.design]);
  assert.equal(sent[1].to, "UADMIN");
});

test("รุ่นสำรองถูก Google ปิด (404 แนะนำรุ่นใหม่ — เหตุการณ์จริง 30 ต.ค. 08:34) → ลองรุ่นที่แนะนำต่อทันที", async () => {
  const GONE = new Error('{"error":{"code":404,"message":"This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash-lite instead.","status":"NOT_FOUND"}}');
  const QUOTA = new Error('{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details.","status":"RESOURCE_EXHAUSTED"}}');
  assert.equal(suggestedModel(GONE.message), "gemini-3.8-flash-lite");
  assert.equal(suggestedModel(QUOTA.message), null);
  const g = scripted(QUOTA, GONE, "ok");
  const a = await askGemini("faq", [], "กันน้ำไหม", "now", { generate: g.fn, model: "gemini-3.5-flash", fallbackModel: "gemini-2.5-flash", wait: noWait });
  assert.equal(a.reply, "ได้ครับ");
  assert.deepEqual(g.calls.map((c) => c.model), ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-3.8-flash-lite"]);
});

test("โควตาฟรีเต็ม (429): ไล่รุ่นสำรองหลายรุ่นตามลำดับ · ไม่ลองรุ่นที่เต็มซ้ำ · ข้อความถัดไปข้ามรุ่นที่เต็มเลย", async () => {
  _resetQuotaMemory();
  const QUOTA = new Error('{"error":{"code":429,"message":"You exceeded your current quota","status":"RESOURCE_EXHAUSTED"}}');
  const opts = (fn: any) => ({ generate: fn, model: "gemini-a", fallbackModel: "gemini-b, gemini-c", wait: noWait });
  const g1 = scripted(QUOTA, QUOTA, "ok");
  assert.equal((await askGemini("faq", [], "q1", "now", opts(g1.fn))).reply, "ได้ครับ");
  assert.deepEqual(g1.calls.map((c) => c.model), ["gemini-a", "gemini-b", "gemini-c"]); // ไม่กลับไปลอง a ซ้ำ
  const g2 = scripted("ok");
  await askGemini("faq", [], "q2", "now", opts(g2.fn));
  assert.deepEqual(g2.calls.map((c) => c.model), ["gemini-c"]); // a, b เต็ม → ข้าม ไม่เสียโควตา/เวลา
  _resetQuotaMemory();
});
