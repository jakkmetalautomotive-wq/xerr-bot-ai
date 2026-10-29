// ตรรกะตอบข้อความ 1 ข้อความ (แยกจาก route.ts เพื่อทดสอบได้โดยไม่ต้องมี LINE จริง)
import type { webhook } from "@line/bot-sdk";
import { getFaq } from "./sheet.ts";
import { askGemini, type BotAnswer } from "./gemini.ts";
import { getHistory, addTurn } from "./history.ts";
import {
  getImageSets, findSet, buildCarousel, buildQuickReply, parseChoice, nextStepSet, firstStepSet, stepOf, stepTitle, isQuickSet,
  CATEGORY_SET, INSTALL_SET, REVIEW_SET, type FlexOut, type ImageSet,
} from "./images.ts";
import { DEFAULT_REPLY, ERROR_REPLY, IMAGE_REPLY, MENU, SHIPPING, TAX_CAR, DESIGN_TEXT, adminNotice, bangkokClock, promoText } from "./shop.ts";
import {
  priceOrder, newOrderCode, signOrder, orderSummaryText, taxUpsellMessage, addressButtonMessage,
  decodePostback, parseAddressSent, productLabel, isTaxOnly, type PricedOrder,
} from "./order.ts";
import { slipImageMessage } from "./slip.ts";

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
    // รูป → ส่งรูปนั้นเข้าแชทแอดมินด้วย (ดูสลิปแล้วกด ✅ ได้เลย) · ไฟล์ / วิดีโอ → แจ้งให้ไปดูใน OA Manager
    const image = msg.type === "image" && deps.orderSecret ? slipImageMessage(msg, deps.orderSecret) : null;
    await notifyAdmin(
      deps,
      userId,
      image ? "ลูกค้าส่งรูป (อาจเป็นสลิปหรือรูปของเสียหาย) — รูปอยู่ด้านล่าง 👇" : "ลูกค้าส่งรูป/ไฟล์ (อาจเป็นสลิปหรือรูปของเสียหาย)",
      image ? [image] : [],
    );
    return;
  }

  const question = msg.type === "text" ? msg.text : msg.type === "sticker" ? STICKER : null;
  if (!question) return; // ตำแหน่งที่ตั้ง / เสียง ฯลฯ — ปล่อยให้แอดมินดูเอง

  await deps.line.showLoading(userId).catch(() => {});

  const faqPromise = (deps.getFaq ?? getFaq)();
  faqPromise.catch(() => {}); // error จัดการด้านล่าง
  const sets: ImageSet[] = await (deps.getImageSets ?? getImageSets)().catch(() => []);
  const choice = parseChoice(question, sets); // ลูกค้าเพิ่งกดปุ่มเลือกจากการ์ดไหม

  // ปุ่ม Rich Menu ที่ตอบได้ด้วยโค้ด
  const category = sets.find((s) => s.name === CATEGORY_SET);
  if (question.trim() === MENU.order && category) {
    await send(deps, replyToken, userId, ["เลือกประเภทกรอบป้ายได้เลยครับ 😊", buildCarousel(category)]);
    addTurn(userId, question, `[ส่งการ์ด "${CATEGORY_SET}" ให้ลูกค้าเลือกแล้ว]`);
    return;
  }
  // ปุ่มที่ตอบเป็นข้อความ + ปุ่มด่วน "🛒 สั่งซื้อ"
  const textMenus: [text: string, reply: () => string | null][] = [
    [MENU.price, () => (category ? priceListText(category) : null)],
    [MENU.promo, promoText],
    [MENU.design, () => DESIGN_TEXT],
  ];
  for (const [menuText, reply] of textMenus) {
    const text = question.trim() === menuText ? reply() : null;
    if (!text) continue;
    await send(deps, replyToken, userId, [{ type: "text", text, quickReply: { items: [{ type: "action", action: { type: "message", label: MENU.order, text: MENU.order } }] } }]);
    addTurn(userId, question, text);
    return;
  }
  // ปุ่มเมนูที่ตอบด้วยการ์ดลิงก์ (กดแล้วเปิดคลิป / หน้ารีวิว)
  const linkMenus: [text: string, setName: string, intro: string][] = [
    [MENU.install, INSTALL_SET, "เลือกรุ่นที่ต้องการดูวิธีติดตั้งได้เลยครับ 😊 กดปุ่มใต้การ์ดเพื่อเปิดคลิปใน YouTube"],
    [MENU.review, REVIEW_SET, "รีวิวจากลูกค้าจริงครับ 😊 กดปุ่มใต้การ์ดเพื่อดูรีวิวแต่ละรุ่นได้เลย"],
  ];
  for (const [text, setName, intro] of linkMenus) {
    const linkSet = sets.find((s) => s.name === setName);
    if (question.trim() !== text || !linkSet?.items.length) continue;
    await send(deps, replyToken, userId, [intro, buildCarousel(linkSet)]);
    addTurn(userId, question, `[ส่งการ์ด "${setName}" ให้ลูกค้าแล้ว]`);
    return;
  }
  if (question.trim() === MENU.admin) {
    await send(deps, replyToken, userId, ["รับทราบครับ 🙏 แจ้งแอดมินให้แล้ว", adminNotice()]);
    await notifyAdmin(deps, userId, "ลูกค้ากดปุ่ม \"คุยกับแอดมิน\"");
    return;
  }

  // กดการ์ดประเภทสินค้า → ส่งขั้นแรกของสินค้านั้น (ไม่ต้องรอ AI) · ไม่มีตัวเลือก → สั่งได้เลย
  if (choice && choice.set.name === CATEGORY_SET) {
    const product = choice.item.name;
    const first = firstStepSet(sets, product);
    if (first) {
      const price = choice.item.price ? ` ${choice.item.price}` : "";
      await send(deps, replyToken, userId, withSet([`${productLabel(product)}${price} 😊 ${stepTitle(first.name) || "เลือกแบบ"}ได้เลยครับ`], first, []));
      addTurn(userId, question, `[ส่งตัวเลือกชุด "${first.name}" ให้ลูกค้าเลือกแล้ว]`);
      return;
    }
    if (await startOrder(deps, replyToken, userId, sets, product, [], question)) return;
  }

  // กดการ์ดขั้นสุดท้าย + คิดราคาได้ → เข้าขั้นสั่งซื้อทันที (ไม่ต้องรอ AI)
  if (choice && !nextStepSet(sets, choice.set, choice.picked)) {
    const product = stepOf(choice.set.name)?.product;
    if (product && (await startOrder(deps, replyToken, userId, sets, product, choice.picked, question))) return;
  }

  let answer: BotAnswer;
  try {
    answer = await (deps.ask ?? defaultAsk)(await faqPromise, question, userId, sets.map((s) => s.name));
  } catch (err) {
    console.error("[bot] ตอบไม่ได้:", (err as Error).message);
    // ลูกค้ากดการ์ดอยู่ → ไปต่อได้แม้ AI ล่ม (ส่งขั้นถัดไป หรือสรุปที่เลือกให้แอดมิน)
    answer = choice ? choiceFallback(sets, choice) : { reply: ERROR_REPLY, needsAdmin: true, adminNote: `ระบบขัดข้อง (${(err as Error).message}) ลูกค้าพิมพ์ว่า: ${question.slice(0, 200)}` };
  }

  let out: OutMessage[] = [answer.reply];
  if (answer.needsAdmin) out.push(adminNotice());
  let set = answer.showSet ? findSet(sets, answer.showSet) : undefined;
  // กันพลาด: ลูกค้ากดเลือกขั้น N แต่ AI ลืมส่งขั้นถัดไป → ส่งให้เอง
  if (!set && !answer.needsAdmin && choice) set = nextStepSet(sets, choice.set, choice.picked);
  // ปุ่มของการ์ดชุดถัดไปพกตัวเลือกที่เลือกมาแล้ว → บอทรู้ครบแม้หน่วยความจำหาย
  if (set?.items.length) out = withSet(out, set, choice && set !== choice.set && choice.set.name !== CATEGORY_SET ? choice.picked : []);
  // AI ล่มทุกครั้งที่ลอง → แนบปุ่มเมนูให้ลูกค้าดูราคา/สั่งซื้อ/วิธีติดตั้ง/รีวิว ต่อเองได้ (ปุ่มพวกนี้ตอบด้วยโค้ด ไม่ต้องใช้ AI)
  if (answer.reply === ERROR_REPLY) out = withMenuButtons(out);
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
      await notifyAdmin(deps, userId, `คิดยอดไม่ได้ (ข้อมูลการ์ดเปลี่ยน?) ลูกค้าเลือก: ${pb.p} ${pb.s.join(", ")}`);
      return;
    }
    await sendOrderSummary(deps, replyToken, userId, order, pb.y ? "เพิ่มป้ายภาษี" : "ไม่เพิ่มป้ายภาษี");
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

// เลือกครบแล้ว + คิดราคาได้ → ชวนเพิ่มป้ายภาษี (ปุ่ม) · สั่งป้ายภาษีอย่างเดียว → สรุปยอดเลย (ค่าส่ง 15 ไม่ชวนซื้อเพิ่ม)
// คิดราคาไม่ได้ → false (ให้ AI / แอดมินดูต่อ)
async function startOrder(deps: BotDeps, replyToken: string, userId: string, sets: ImageSet[], product: string, picks: string[], question: string): Promise<boolean> {
  if (isTaxOnly(product)) {
    const order = priceOrder(sets, { code: newOrderCode(), product, picks, tax: false });
    if (!order) return false;
    await sendOrderSummary(deps, replyToken, userId, order, question);
    return true;
  }
  if (!priceOrder(sets, { code: "", product, picks, tax: false })) return false;
  await send(deps, replyToken, userId, [taxUpsellMessage(product, picks)]);
  addTurn(userId, question, `สรุปที่เลือก ${productLabel(product)} ${picks.join(" / ")} · ชวนเพิ่มกรอบป้ายภาษีแล้ว รอลูกค้ากดปุ่ม`);
  return true;
}

// สรุปยอด + เลขบัญชี + ปุ่มกรอกที่อยู่
async function sendOrderSummary(deps: BotDeps, replyToken: string, userId: string, order: PricedOrder, turnText: string) {
  const hasForm = Boolean(deps.liffId && deps.orderSecret);
  const out: OutMessage[] = [orderSummaryText(order, deps.paymentInfo ?? "", hasForm)];
  if (hasForm) out.push(addressButtonMessage(deps.liffId!, signOrder({ code: order.code, product: order.product, picks: order.picks, tax: order.tax, total: order.total }, deps.orderSecret!)));
  await send(deps, replyToken, userId, out);
  addTurn(userId, turnText, `ส่งสรุปออเดอร์ ${order.code} ยอด ${order.total}.- แล้ว รอลูกค้ากรอกที่อยู่และโอน`);
  if (!deps.paymentInfo?.trim()) await notifyAdmin(deps, userId, `ออเดอร์ ${order.code} ยอด ${order.total}.- — ยังไม่ได้ตั้ง PAYMENT_INFO ต้องส่งเลขบัญชีให้ลูกค้าเอง`);
}

// ส่งชุดตัวเลือก: มีรูป → การ์ดปัดดู · ไม่มีรูป → ปุ่มด่วนติดข้อความสุดท้าย (ปุ่มด่วนแสดงเฉพาะใต้ข้อความล่าสุด)
function withMenuButtons(out: OutMessage[]): OutMessage[] {
  const last = out[out.length - 1];
  if (typeof last !== "string") return out;
  const items = [MENU.order, MENU.price, MENU.install, MENU.review].map((t) => ({ type: "action", action: { type: "message", label: t, text: t } }));
  return [...out.slice(0, -1), { type: "text", text: last, quickReply: { items } }];
}

function withSet(out: OutMessage[], set: ImageSet, picked: string[]): OutMessage[] {
  if (!isQuickSet(set)) return [...out, buildCarousel(set, picked)];
  const i = out.findLastIndex((m) => typeof m === "string");
  if (i < 0) return [...out, { type: "text", text: "เลือกได้เลยครับ 😊", quickReply: buildQuickReply(set, picked) }];
  return [...out.slice(0, i), { type: "text", text: out[i] as string, quickReply: buildQuickReply(set, picked) }, ...out.slice(i + 1)];
}

// ปุ่ม "ราคา": ราคาจากการ์ดประเภทสินค้า + กติกาค่าส่ง
export function priceListText(category: ImageSet): string {
  return [
    "💰 ราคาสั่งตรงทาง LINE (1 ชุด = หน้า + หลัง)",
    ...category.items.map((i) => `🔺 ${productLabel(i.name)}  ${i.price}`),
    "",
    `🚚 ค่าส่ง SPX ${SHIPPING.default}.- · ซื้อคู่${TAX_CAR.name} ส่งฟรี · สั่งป้ายภาษีอย่างเดียว ค่าส่ง ${SHIPPING.taxOnly}.-`,
    "กด \"🛒 สั่งซื้อ\" เพื่อเลือกแบบได้เลยครับ 😊",
  ].join("\n");
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

async function notifyAdmin(deps: BotDeps, userId: string, note: string, extra: OutMessage[] = []) {
  if (!deps.adminUserId) {
    console.warn("[admin] ยังไม่ได้ตั้ง ADMIN_LINE_USER_ID — แจ้งแอดมินไม่ได้:", note);
    return;
  }
  if (userId === deps.adminUserId) return; // แอดมินทดสอบเอง ไม่ต้องแจ้งตัวเอง
  const name = await deps.line.displayName(userId).catch(() => "");
  const text = `🔔 ลูกค้าต้องการแอดมิน\nชื่อ: ${name || "-"}\nเรื่อง: ${note}\n\nตอบได้ใน LINE OA Manager › แชท`;
  await deps.line.push(deps.adminUserId, [text, ...extra]).catch((err) => console.error("[admin] แจ้งไม่สำเร็จ:", (err as Error).message));
}
