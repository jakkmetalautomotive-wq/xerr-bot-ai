// ตรรกะตอบข้อความ 1 ข้อความ (แยกจาก route.ts เพื่อทดสอบได้โดยไม่ต้องมี LINE จริง)
import type { webhook } from "@line/bot-sdk";
import { getFaq } from "./sheet.ts";
import { askGemini, type BotAnswer } from "./gemini.ts";
import { getHistory, addTurn } from "./history.ts";
import { getImageSets, findSet, buildCarousel, parseChoice, nextStepSet, stepOf, type FlexOut, type ImageSet } from "./images.ts";
import { DEFAULT_REPLY, ERROR_REPLY, IMAGE_REPLY, adminNotice, bangkokClock } from "./shop.ts";
import {
  priceOrder, newOrderCode, signOrder, orderSummaryText, taxUpsellMessage, addressButtonMessage,
  decodePostback, parseAddressSent,
} from "./order.ts";

// ข้อความที่ส่งออก: ข้อความธรรมดา / การ์ด (Flex) / ข้อความที่มีปุ่มด่วน
export type OutMessage = string | FlexOut | { type: string; [key: string]: unknown };

// สิ่งที่บอทต้องใช้จาก LINE (ทำเป็น interface เพื่อสลับเป็นตัวปลอมตอนทดสอบ)
export interface LinePort {
  reply(replyToken: string, messages: OutMessage[]): Promise<void>;
  push(to: string, messages: OutMessage[]): Promise<void>;
  showLoading(userId: string): Promise<void>;
  displayName(userId: string): Promise<string>;
}

export interface BotDeps {
  line: LinePort;
  adminUserId?: string;
  getFaq?: typeof getFaq;
  getImageSets?: () => Promise<ImageSet[]>;
  ask?: (faq: string, question: string, userId: string, imageSets: string[]) => Promise<BotAnswer>;
  // สั่งซื้อ: LIFF ID ของแบบฟอร์ม · ข้อความเลขบัญชี · คีย์เซ็นออเดอร์ (ใช้ Channel secret)
  liffId?: string;
  paymentInfo?: string;
  orderSecret?: string;
}

const STICKER = "[ลูกค้าส่งสติกเกอร์]";

export async function handleEvent(event: webhook.Event, deps: BotDeps): Promise<void> {
  if (event.source?.type !== "user" || !event.source.userId) return;
  if (event.type === "postback") return handlePostback(event as webhook.PostbackEvent, event.source.userId, deps);
  if (event.type !== "message") return;
  const e = event as webhook.MessageEvent;
  const userId = event.source.userId;
  const replyToken = e.replyToken!;
  const msg = e.message;

  if (msg.type === "text" && msg.text.trim().toLowerCase() === "myid") {
    await deps.line.reply(replyToken, [userId]);
    return;
  }

  // ลูกค้ากดส่งแบบฟอร์มที่อยู่แล้ว (ข้อความนี้ส่งจากแบบฟอร์มในนามลูกค้า)
  const sent = msg.type === "text" ? parseAddressSent(msg.text.trim()) : null;
  if (sent) {
    await send(deps, replyToken, userId, [`รับที่อยู่จัดส่งแล้วครับ ✅ ออเดอร์ ${sent.code}\nโอนยอด ${sent.total}.- แล้วส่งสลิปในแชทนี้ได้เลยครับ 🙏`]);
    return;
  }

  if (msg.type === "image" || msg.type === "file" || msg.type === "video") {
    await send(deps, replyToken, userId, [IMAGE_REPLY, adminNotice()]);
    await notifyAdmin(deps, userId, "ลูกค้าส่งรูป/ไฟล์ (อาจเป็นสลิปหรือรูปของเสียหาย)");
    return;
  }

  const question = msg.type === "text" ? msg.text : msg.type === "sticker" ? STICKER : null;
  if (!question) return; // ตำแหน่งที่ตั้ง / เสียง ฯลฯ — ปล่อยให้แอดมินดูเอง

  await deps.line.showLoading(userId).catch(() => {});

  const faqPromise = (deps.getFaq ?? getFaq)();
  faqPromise.catch(() => {}); // error จัดการด้านล่าง
  const sets: ImageSet[] = await (deps.getImageSets ?? getImageSets)().catch(() => []);
  const choice = parseChoice(question, sets); // ลูกค้าเพิ่งกดปุ่มเลือกจากการ์ดไหม

  // กดการ์ดขั้นสุดท้าย + คิดราคาได้ → เข้าขั้นสั่งซื้อทันที (ไม่ต้องรอ AI): ชวนเพิ่มป้ายภาษี
  if (choice && !nextStepSet(sets, choice.set, choice.picked)) {
    const product = stepOf(choice.set.name)?.product;
    if (product && priceOrder(sets, { code: "", product, picks: choice.picked, tax: false })) {
      await send(deps, replyToken, userId, [taxUpsellMessage(product, choice.picked)]);
      addTurn(userId, question, `สรุปที่เลือก ${choice.picked.join(" / ")} · ชวนเพิ่มกรอบป้ายภาษีแล้ว รอลูกค้ากดปุ่ม`);
      return;
    }
  }

  let answer: BotAnswer;
  try {
    answer = await (deps.ask ?? defaultAsk)(await faqPromise, question, userId, sets.map((s) => s.name));
  } catch (err) {
    console.error("[bot] ตอบไม่ได้:", (err as Error).message);
    // ลูกค้ากดการ์ดอยู่ → ไปต่อได้แม้ AI ล่ม (ส่งขั้นถัดไป หรือสรุปที่เลือกให้แอดมิน)
    answer = choice ? choiceFallback(sets, choice) : { reply: ERROR_REPLY, needsAdmin: true, adminNote: `ระบบขัดข้อง (${(err as Error).message}) ลูกค้าพิมพ์ว่า: ${question.slice(0, 200)}` };
  }

  const out: OutMessage[] = [answer.reply];
  let set = answer.showSet ? findSet(sets, answer.showSet) : undefined;
  // กันพลาด: ลูกค้ากดเลือกขั้น N แต่ AI ลืมส่งขั้นถัดไป → ส่งให้เอง
  if (!set && !answer.needsAdmin && choice) set = nextStepSet(sets, choice.set, choice.picked);
  // ปุ่มของการ์ดชุดถัดไปพกตัวเลือกที่เลือกมาแล้ว → บอทรู้ครบแม้หน่วยความจำหาย
  if (set?.items.length) out.push(buildCarousel(set, choice && set !== choice.set ? choice.picked : []));
  if (answer.needsAdmin) out.push(adminNotice());
  await send(deps, replyToken, userId, out);
  if (answer.reply !== ERROR_REPLY) addTurn(userId, question, set ? `${answer.reply}\n[ส่งการ์ดรูปชุด "${set.name}" ให้ลูกค้าเลือกแล้ว]` : answer.reply);
  if (answer.needsAdmin) await notifyAdmin(deps, userId, answer.adminNote || (answer.reply === DEFAULT_REPLY ? `คำถามที่ไม่มีใน FAQ: ${question}` : question));
}

// ปุ่ม: ลูกค้าตอบเรื่องป้ายภาษี → ส่งสรุปยอด · แอดมินกดยืนยัน/ยอดไม่ตรง → แจ้งลูกค้า
async function handlePostback(event: webhook.PostbackEvent, userId: string, deps: BotDeps) {
  const replyToken = event.replyToken!;
  const pb = decodePostback(event.postback.data);
  if (!pb) return;

  if (pb.k === "tax") {
    const sets = await (deps.getImageSets ?? getImageSets)().catch(() => []);
    const order = priceOrder(sets, { code: newOrderCode(), product: pb.p, picks: pb.s, tax: pb.y === 1 });
    if (!order) {
      await send(deps, replyToken, userId, [DEFAULT_REPLY, adminNotice()]);
      await notifyAdmin(deps, userId, `คิดยอดไม่ได้ (ข้อมูลการ์ดเปลี่ยน?) ลูกค้าเลือก: ${pb.s.join(", ")}`);
      return;
    }
    const hasForm = Boolean(deps.liffId && deps.orderSecret);
    const out: OutMessage[] = [orderSummaryText(order, deps.paymentInfo ?? "", hasForm)];
    if (hasForm) out.push(addressButtonMessage(deps.liffId!, signOrder({ code: order.code, product: order.product, picks: order.picks, tax: order.tax, total: order.total }, deps.orderSecret!)));
    await send(deps, replyToken, userId, out);
    addTurn(userId, pb.y ? "เพิ่มป้ายภาษี" : "ไม่เพิ่มป้ายภาษี", `ส่งสรุปออเดอร์ ${order.code} ยอด ${order.total}.- แล้ว รอลูกค้ากรอกที่อยู่และโอน`);
    if (!deps.paymentInfo?.trim()) await notifyAdmin(deps, userId, `ออเดอร์ ${order.code} ยอด ${order.total}.- — ยังไม่ได้ตั้ง PAYMENT_INFO ต้องส่งเลขบัญชีให้ลูกค้าเอง`);
    return;
  }

  // ปุ่มของแอดมิน — รับเฉพาะจากแอดมินจริง
  if (pb.k === "adm") {
    if (!deps.adminUserId || userId !== deps.adminUserId) return;
    if (pb.a === "ok") {
      await deps.line.push(pb.u, [`ได้รับยอดชำระ ${pb.t.toLocaleString("en-US")}.- แล้วครับ ✅ ออเดอร์ ${pb.c}\nจัดส่ง SPX รอบถัดไป (ตัดรอบเที่ยง จันทร์–เสาร์) ขอบคุณที่อุดหนุนครับ 🙏`]);
      await deps.line.reply(replyToken, [`✅ ยืนยันออเดอร์ ${pb.c} แล้ว · แจ้งลูกค้าแล้ว`]);
    } else {
      await deps.line.push(pb.u, [`ขออภัยครับ ยอดโอนของออเดอร์ ${pb.c} ยังไม่ตรง/ยังไม่พบยอด เดี๋ยวแอดมินติดต่อกลับในแชทนี้นะครับ 🙏`]);
      await deps.line.reply(replyToken, [`แจ้งลูกค้าแล้วว่ายอดออเดอร์ ${pb.c} ยังไม่ตรง · คุยต่อใน LINE OA Manager ได้เลย`]);
    }
  }
}

function choiceFallback(sets: ImageSet[], choice: NonNullable<ReturnType<typeof parseChoice>>): BotAnswer {
  const next = nextStepSet(sets, choice.set, choice.picked);
  if (next) return { reply: "รับทราบครับ 😊 เลือกต่อได้เลยครับ", needsAdmin: false, adminNote: "", showSet: next.name };
  return {
    reply: `รับทราบครับ สรุปที่เลือก: ${choice.picked.join(", ")} 🙏 เดี๋ยวแอดมินสรุปยอดและค่าส่งให้นะครับ`,
    needsAdmin: true,
    adminNote: `ลูกค้าเลือกครบแล้ว: ${choice.picked.join(", ")} (${choice.set.name.replace(/\s*ขั้น.*$/, "")})`,
  };
}

function defaultAsk(faq: string, question: string, userId: string, imageSets: string[]) {
  return askGemini(faq, getHistory(userId), question, bangkokClock().label, { imageSets });
}

// ตอบด้วย reply token ก่อน (ฟรี) ถ้าไม่ได้ค่อย push
async function send(deps: BotDeps, replyToken: string, userId: string, messages: OutMessage[]) {
  try {
    await deps.line.reply(replyToken, messages);
  } catch (err) {
    console.error("[line] reply ไม่สำเร็จ ลอง push แทน:", (err as Error).message);
    try {
      await deps.line.push(userId, messages);
    } catch (err2) {
      console.error("[line] push ไม่สำเร็จ:", (err2 as Error).message);
    }
  }
}

async function notifyAdmin(deps: BotDeps, userId: string, note: string) {
  if (!deps.adminUserId) {
    console.warn("[admin] ยังไม่ได้ตั้ง ADMIN_LINE_USER_ID — แจ้งแอดมินไม่ได้:", note);
    return;
  }
  if (userId === deps.adminUserId) return; // แอดมินทดสอบเอง ไม่ต้องแจ้งตัวเอง
  const name = await deps.line.displayName(userId).catch(() => "");
  const text = `🔔 ลูกค้าต้องการแอดมิน\nชื่อ: ${name || "-"}\nเรื่อง: ${note}\n\nตอบได้ใน LINE OA Manager › แชท`;
  await deps.line.push(deps.adminUserId, [text]).catch((err) => console.error("[admin] แจ้งไม่สำเร็จ:", (err as Error).message));
}
