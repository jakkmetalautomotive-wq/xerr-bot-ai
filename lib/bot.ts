// ตรรกะตอบข้อความ 1 ข้อความ (แยกจาก route.ts เพื่อทดสอบได้โดยไม่ต้องมี LINE จริง)
import type { webhook } from "@line/bot-sdk";
import { getFaq } from "./sheet.ts";
import { askGemini, type BotAnswer } from "./gemini.ts";
import { getHistory, addTurn } from "./history.ts";
import {
  baseUrl, getImageSets, findSet, buildCarousel, buildQuickReply, parseChoice, nextStepSet, firstStepSet, stepOf, stepTitle, isQuickSet,
  CATEGORY_SET, INSTALL_SET, REVIEW_SET, type FlexOut, type ImageSet,
} from "./images.ts";
import { DEFAULT_REPLY, ERROR_REPLY, IMAGE_REPLY, MENU, SHIPPING, TAX_CAR, DESIGN_TEXT, adminNotice, bangkokClock, promoText, cannedAnswer, REVIEW_PROMO, REVIEW_REMINDER } from "./shop.ts";
import {
  priceOrder, newOrderCode, signOrder, orderSummaryText, taxUpsellMessage, addressButtonMessage, paidConfirmMessage,
  decodePostback, parseAddressSent, productLabel, isTaxOnly, isMetaUser, slipConfirmMessage, type PricedOrder,
} from "./order.ts";
import { accountNumber, promptPayEnabled, promptPayImageMessage } from "./promptpay.ts";
import { slipImageMessage } from "./slip.ts";
import { fetchCustomerImage, readPhoto, type PhotoRead } from "./vision.ts";
import { defaultState, type StateStore } from "./state.ts";
import { getLabel, labelReadyText, labelUrl } from "./label.ts";
import { parseReviewQuery, pickReviews, reviewMessages, toReviewPhotos, loadReviewFiles, reviewOrderCard, soldPhotos, isSold, askedDesign, type ReviewPhoto } from "./reviews.ts";
import { logOrder, statusEvent, ORDER_STATUS, setTracking, getTracking, parseTrackingLines, type OrderLogEvent, type TrackingInfo } from "./orderlog.ts";

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
  // บันทึกสถานะออเดอร์ลงชีท (ทดสอบสลับเป็นตัวปลอมได้)
  logOrder?: (event: OrderLogEvent) => Promise<boolean>;
  // ต่อท้ายคำตอบแรกของลูกค้าแต่ละคนด้วยโปรรีวิว (เปิดใน webhook จริง)
  reviewPromo?: boolean;
  // เลขพัสดุในชีทออเดอร์ (ทดสอบสลับเป็นตัวปลอมได้)
  setTracking?: (code: string, tracking: string) => Promise<boolean>;
  getTracking?: (code: string) => Promise<TrackingInfo | null>;
  // ความจำถาวร (ช่วงพัก/โปรรีวิว) · ไม่ใส่ = Upstash ถ้าตั้งไว้ ไม่งั้นหน่วยความจำชั่วคราว
  state?: StateStore;
  // รูปรีวิวลูกค้า (ใส่ในเทสต์) · ไม่ใส่ = อ่านจาก Drive ผ่าน Apps Script
  getReviewPhotos?: () => Promise<ReviewPhoto[]>;
  // ลูกค้าพิมพ์ "มีแบบนี้ไหม" → รอรูปที่ส่งตามมากี่มิลลิวินาที (เทสต์ใส่ค่าน้อย)
  photoWaitMs?: number;
  // อ่านรูปลูกค้าด้วย AI (เทสต์ใส่ตัวปลอม) · ไม่ใส่ = Gemini ดูรูป (ปิดได้ด้วย PHOTO_VISION=off)
  readPhoto?: (msg: { id: string; contentProvider?: { type?: string; originalContentUrl?: string } }, sets: ImageSet[]) => Promise<PhotoRead | null>;
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

  // แอดมินพิมพ์เลขพัสดุ: บรรทัดละ "XR-ABCD SPXTH0123456789" → ลงชีท (ลูกค้ากดปุ่ม 📦 ขอเลขพัสดุ ดูเอง)
  const trackingLines = msg.type === "text" && userId === deps.adminUserId ? parseTrackingLines(msg.text) : null;
  if (trackingLines) {
    const set = deps.setTracking ?? setTracking;
    const results = await Promise.all(trackingLines.map(async (t) => ({ ...t, ok: await set(t.code, t.tracking) })));
    const ok = results.filter((r) => r.ok);
    const bad = results.filter((r) => !r.ok);
    await deps.line.reply(replyToken, [
      [
        `📦 บันทึกเลขพัสดุแล้ว ${ok.length}/${results.length} ออเดอร์`,
        ...ok.map((r) => `✓ ${r.code} ${r.tracking}`),
        ...bad.map((r) => `✗ ${r.code} — ไม่พบออเดอร์ในชีท / ชีทล่ม`),
        ...(ok.length ? ["ลูกค้ากดปุ่ม \"📦 ขอเลขพัสดุ\" ในการ์ดยืนยันเพื่อดูเลขได้เลย"] : []),
      ].join("\n"),
    ]);
    return;
  }

  // ลูกค้ากดส่งแบบฟอร์มที่อยู่แล้ว (ข้อความนี้ส่งจากแบบฟอร์มในนามลูกค้า)
  const sent = msg.type === "text" ? parseAddressSent(msg.text.trim()) : null;
  if (sent) {
    await send(deps, replyToken, userId, [`รับที่อยู่จัดส่งแล้วครับ ✅ ออเดอร์ ${sent.code}\nโอนยอด ${sent.total}.- แล้วส่งสลิปในแชทนี้ได้เลยครับ 🙏`]);
    return;
  }

  const state = deps.state ?? defaultState;
  const isCustomer = userId !== deps.adminUserId;
  // ส่งเรื่องให้แอดมินไปแล้วไม่เกิน 10 นาที → เงียบกับข้อความที่พิมพ์เอง (กันตอบซ้ำจนดูเหมือนสแปม)
  // ใช้กับบัญชีแอดมินด้วย → ทดสอบจากมือถือตัวเองแล้วเห็นเหมือนลูกค้า
  const muted = (await state.get(muteKey(userId))) !== null;

  if (msg.type === "image" || msg.type === "file" || msg.type === "video") {
    const image = msg.type === "image" && deps.orderSecret ? slipImageMessage(msg, deps.orderSecret) : null;
    // AI ดูรูป: สลิป / รูปกรอบป้าย / ของเสียหาย · รูปกรอบป้าย หรือลูกค้าเพิ่งพิมพ์ "มีแบบนี้ไหม" → ส่งการ์ดให้เลือกลายเอง + รูปให้แอดมินยืนยัน (ไม่ยืนยันลายเอง)
    let read: PhotoRead | null = null;
    if (msg.type === "image" && isCustomer) {
      await state.set(photoKey(userId), "pending", PHOTO_SECONDS);
      read = await readCustomerPhoto(deps, msg).catch(() => null);
      const asked = (await state.get(photoAskKey(userId))) !== null;
      if (asked || read?.kind === "plate_frame") {
        await state.set(photoKey(userId), "ask", PHOTO_SECONDS);
        await sendPhotoAsk(deps, replyToken, userId, read?.product);
        await notifyAdmin(deps, userId, `ลูกค้าส่งรูปกรอบป้าย${asked ? " ถามว่ามีแบบนี้ไหม" : ""}${aiSaw(read)} — ส่งการ์ดให้ลูกค้าเลือกลายเองแล้ว ช่วยดูรูปแล้วยืนยันลายให้ลูกค้าด้วย 👇`, image ? [image] : []);
        return;
      }
      await state.set(photoKey(userId), "slip", PHOTO_SECONDS);
    }
    // ช่วงพัก: ส่งรูปเข้าแชทแอดมินตามปกติ แต่ไม่ตอบ "ได้รับรูปแล้ว" ซ้ำ
    if (!muted) await send(deps, replyToken, userId, [IMAGE_REPLY, adminNotice()]);
    await state.set(muteKey(userId), "1", MUTE_SECONDS);
    // รูป → ส่งรูปนั้นเข้าแชทแอดมินด้วย (ดูสลิปแล้วกด ✅ ได้เลย) · ไฟล์ / วิดีโอ → แจ้งให้ไปดูใน OA Manager
    const open = image && isCustomer ? await openOrder(state, userId) : null;
    await notifyAdmin(
      deps,
      userId,
      !image ? "ลูกค้าส่งรูป/ไฟล์ (อาจเป็นสลิปหรือรูปของเสียหาย)"
        : read?.kind === "slip" ? `ลูกค้าส่งสลิปโอนเงิน${aiSaw(read)} — รูปอยู่ด้านล่าง 👇`
        : read?.kind === "damage" ? `ลูกค้าส่งรูปของเสียหาย/ส่งผิด${aiSaw(read)} — รูปอยู่ด้านล่าง 👇`
        : read ? `ลูกค้าส่งรูป${aiSaw(read)} — รูปอยู่ด้านล่าง 👇`
        : "ลูกค้าส่งรูป (อาจเป็นสลิปหรือรูปของเสียหาย) — รูปอยู่ด้านล่าง 👇",
      // มีออเดอร์ค้าง (ไม่ใช่รูปของเสียหาย) → แนบปุ่ม ✅ ได้รับเงินแล้ว / ❌ ยอดไม่ตรง ใต้รูปสลิป
      image ? [image, ...(open && read?.kind !== "damage" ? [slipConfirmMessage(open.code, open.total, userId)] : [])] : [],
    );
    return;
  }

  const question = msg.type === "text" ? msg.text : msg.type === "sticker" ? STICKER : null;
  if (!question) return; // ตำแหน่งที่ตั้ง / เสียง ฯลฯ — ปล่อยให้แอดมินดูเอง

  // ลูกค้าทักครั้งแรกของเดือน → ต่อท้ายคำตอบด้วยโปรรีวิว (ช่วงพักไม่ส่ง)
  if (deps.reviewPromo && isCustomer && !muted && (await state.get(greetKey(userId))) === null) {
    await state.set(greetKey(userId), "1", GREET_SECONDS);
    deps = withReviewPromo(deps);
  }

  if (!muted) await deps.line.showLoading(userId).catch(() => {});

  const faqPromise = (deps.getFaq ?? getFaq)();
  faqPromise.catch(() => {}); // error จัดการด้านล่าง
  const sets: ImageSet[] = await (deps.getImageSets ?? getImageSets)().catch(() => []);
  const choice = parseChoice(question, sets); // ลูกค้าเพิ่งกดปุ่มเลือกจากการ์ดไหม

  // "มีแบบนี้ไหม / แบบในรูป" → ข้อความกับรูปมาแยกกัน (ลำดับไม่แน่นอน) → จับคู่กันก่อน ไม่ให้ AI เดาลายจากข้อความอย่างเดียว
  if (!choice && isCustomer && msg.type === "text" && PHOTO_ASK.test(question)) {
    await state.set(photoAskKey(userId), "1", PHOTO_ASK_SECONDS);
    const seen = await waitForPhoto(state, userId, deps.photoWaitMs ?? 4000);
    if (seen === "ask" || seen === "pending") return; // ฝั่งรูปตอบให้แล้ว / กำลังตอบ
    if (seen === "slip") {
      // รูปมาก่อน (ตอบไปแล้วว่า "ได้รับรูป") → ส่งการ์ดให้เลือกต่อ + บอกแอดมินว่ารูปนั้นคือรูปสินค้า
      await sendPhotoAsk(deps, replyToken, userId);
      await notifyAdmin(deps, userId, `รูปที่ลูกค้าเพิ่งส่งคือรูปสินค้า (ไม่ใช่สลิป) ลูกค้าถามว่า: ${question.slice(0, 200)} — ส่งการ์ดให้เลือกเองแล้ว ช่วยยืนยันลายให้ลูกค้าด้วย`);
      return;
    }
  }

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
  // คำถามที่ร้านเขียนคำตอบไว้เอง (เช่น กันน้ำไหม) → ตอบตามนั้นทุกตัวอักษร ไม่ผ่าน AI
  const canned = cannedAnswer(question);
  if (canned) {
    await send(deps, replyToken, userId, [{ type: "text", text: canned, quickReply: { items: [{ type: "action", action: { type: "message", label: MENU.order, text: MENU.order } }] } }]);
    addTurn(userId, question, canned);
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
    await state.set(muteKey(userId), "1", MUTE_SECONDS);
    await notifyAdmin(deps, userId, "ลูกค้ากดปุ่ม \"คุยกับแอดมิน\"");
    return;
  }

  // ลูกค้าขอดูรีวิว / รูปติดจริง ตามรุ่นรถ หรือแบบกรอบ → การ์ดรูปรีวิวจาก Drive (ไม่ต้องรอ AI · ช่วงพักก็ยังตอบ)
  if (!choice) {
    const rq = parseReviewQuery(question);
    if (rq) {
      const all = await (deps.getReviewPhotos ?? (async () => toReviewPhotos(await loadReviewFiles(state))))().catch(() => []);
      const photos = soldPhotos(sets, all); // ไม่ส่งรูปลายที่ร้านไม่ได้ขาย
      if (photos.length) {
        // ถามลายที่ไม่มีขาย → บอกตรง ๆ แล้วส่งรีวิวแบบที่มีขาย (ยังกรองรุ่นรถ / ขนาด / เส้นคาดกลางตามที่ถาม)
        const notSold = rq.family && !isSold(sets, rq.family, rq.color) ? askedDesign(rq) : "";
        const pick = pickReviews(photos, notSold ? { ...rq, family: undefined, color: undefined } : rq);
        await send(deps, replyToken, userId, reviewMessages(pick, { notSold }));
        addTurn(userId, question, `[ส่งรูปรีวิว ${pick.shown || pick.wanted || "ลูกค้าจริง"} ${pick.photos.length} รูปแล้ว]`);
        return;
      }
    }
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

  // ช่วงพักหลังส่งเรื่องให้แอดมิน: ข้อความที่พิมพ์เอง → ไม่ตอบ (แอดมินเห็นใน OA Manager) · กดการ์ดเลือกแบบยังตอบปกติ
  if (muted && !choice) {
    console.log(`[bot] พักตอบ ${userId.slice(0, 8)}… (ส่งเรื่องให้แอดมินแล้ว ไม่เกิน ${MUTE_SECONDS / 60} นาที)`);
    return;
  }

  let answer: BotAnswer;
  try {
    answer = await (deps.ask ?? defaultAsk)(await faqPromise, question, userId, sets.map((s) => s.name));
  } catch (err) {
    console.error("[bot] ตอบไม่ได้:", (err as Error).message);
    // ลูกค้ากดการ์ดอยู่ → ไปต่อได้แม้ AI ล่ม (ส่งขั้นถัดไป หรือสรุปที่เลือกให้แอดมิน)
    answer = choice ? choiceFallback(sets, choice) : { reply: ERROR_REPLY, needsAdmin: true, adminNote: `ระบบขัดข้อง (${(err as Error).message}) ลูกค้าพิมพ์ว่า: ${question.slice(0, 200)}` };
  }

  let set = answer.showSet ? findSet(sets, answer.showSet) : undefined;
  // ห้ามข้ามขั้น: ตัวเลือกต้องมาจากการกดการ์ดเท่านั้น (ปุ่มพกตัวเลือกไปถึงสรุปยอด) → AI จะส่งขั้น 2+ เองไม่ได้
  const step = set ? stepOf(set.name) : null;
  if (step && choice && stepOf(choice.set.name)?.product === step.product) {
    set = nextStepSet(sets, choice.set, choice.picked);
  } else if (step && step.step > 1) {
    const first = firstStepSet(sets, step.product);
    if (first) {
      set = first;
      // คำตอบของ AI อาจอ้างลาย/สีที่ลูกค้ายังไม่ได้เลือก → ใช้ข้อความกลางแทน
      if (!answer.needsAdmin) answer = { ...answer, reply: `${productLabel(step.product)} 😊 ${stepTitle(first.name) || "เลือกแบบ"}ได้เลยครับ` };
    }
  }
  let out: OutMessage[] = [answer.reply];
  if (answer.needsAdmin) out.push(adminNotice());
  // กันพลาด: ลูกค้ากดเลือกขั้น N แต่ AI ลืมส่งขั้นถัดไป → ส่งให้เอง
  if (!set && !answer.needsAdmin && choice) set = nextStepSet(sets, choice.set, choice.picked);
  // ปุ่มของการ์ดชุดถัดไปพกตัวเลือกที่เลือกมาแล้ว → บอทรู้ครบแม้หน่วยความจำหาย
  if (set?.items.length) out = withSet(out, set, choice && set !== choice.set && choice.set.name !== CATEGORY_SET ? choice.picked : []);
  // AI ล่มทุกครั้งที่ลอง → แนบปุ่มเมนูให้ลูกค้าดูราคา/สั่งซื้อ/วิธีติดตั้ง/รีวิว ต่อเองได้ (ปุ่มพวกนี้ตอบด้วยโค้ด ไม่ต้องใช้ AI)
  if (answer.reply === ERROR_REPLY) out = withMenuButtons(out);
  await send(deps, replyToken, userId, out);
  if (answer.reply !== ERROR_REPLY) addTurn(userId, question, set ? `${answer.reply}\n[ส่งการ์ดรูปชุด "${set.name}" ให้ลูกค้าเลือกแล้ว]` : answer.reply);
  if (answer.needsAdmin) {
    await state.set(muteKey(userId), "1", MUTE_SECONDS);
    await notifyAdmin(deps, userId, answer.adminNote || (answer.reply === DEFAULT_REPLY ? `คำถามที่ไม่มีใน FAQ: ${question}` : question));
  }
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

  // ลูกค้ากด "📦 ขอเลขพัสดุ" → ค้นในชีทออเดอร์ (ตอบด้วย reply ไม่กินโควตา push) · ต้องเป็นเจ้าของออเดอร์
  // กด "🛒 สั่งลายนี้" ใต้รูปรีวิว → การ์ดสั่งซื้อของลายนั้นใบเดียว กดเลือกต่อได้เลย
  if (pb.k === "rv") {
    const sets = await (deps.getImageSets ?? getImageSets)().catch(() => []);
    const card = reviewOrderCard(sets, pb.f, pb.c, pb.b === 1);
    if (!card) {
      await send(deps, replyToken, userId, [DEFAULT_REPLY, adminNotice()]);
      return;
    }
    const intro = card.exact ? "ลายนี้เลยครับ 😊 กดเลือกที่การ์ดเพื่อสั่งต่อได้เลย" : "เลือกแบบที่ต้องการได้เลยครับ 😊";
    await send(deps, replyToken, userId, [intro, buildCarousel(card.set)]);
    addTurn(userId, "กดสั่งจากรูปรีวิว", `[ส่งการ์ด "${card.set.name}" ${card.set.items.map((i) => i.name).join(", ")} ให้ลูกค้าแล้ว]`);
    return;
  }

  if (pb.k === "trk") {
    const info = await (deps.getTracking ?? getTracking)(pb.c);
    const mine = info?.found && (!info.lineUserId || info.lineUserId === userId);
    if (mine && info!.tracking) {
      await send(deps, replyToken, userId, [`📦 ออเดอร์ ${pb.c}\nเลขพัสดุ SPX: ${info!.tracking}\nเช็คสถานะได้ในแอป SPX Express หรือเว็บ spx.co.th ครับ 🙏`]);
      return;
    }
    if (info && !mine && info.found) return; // ออเดอร์ของคนอื่น → ไม่ตอบ
    const { minutes } = bangkokClock();
    if (info && minutes < 20 * 60) {
      await send(deps, replyToken, userId, [`ออเดอร์ ${pb.c} ยังไม่มีเลขพัสดุครับ 🙏\nเลขพัสดุเช็คได้หลัง 20:00 น. ของวันที่จัดส่ง ลองกดอีกครั้งหลัง 2 ทุ่มนะครับ`]);
      return;
    }
    await send(deps, replyToken, userId, [`ออเดอร์ ${pb.c} ยังไม่มีเลขพัสดุในระบบครับ แจ้งแอดมินให้แล้ว เดี๋ยวส่งเลขให้นะครับ 🙏`]);
    await notifyAdmin(deps, userId, `ลูกค้าขอเลขพัสดุ ออเดอร์ ${pb.c} — ${info ? "ยังไม่ได้ใส่เลข" : "เช็คชีทออเดอร์ไม่ได้"} (พิมพ์ "${pb.c} เลขพัสดุ" ในแชทนี้เพื่อใส่เลข)`);
    return;
  }

  // ปุ่มของแอดมิน — รับเฉพาะจากแอดมินจริง
  if (pb.k === "adm") {
    if (!deps.adminUserId || userId !== deps.adminUserId) return;
    const log = deps.logOrder ?? logOrder;
    if (pb.a === "ok") {
      // ปุ่มยืนยันมีทั้งใต้การ์ดออเดอร์และใต้รูปสลิป → กดซ้ำไม่ส่งหาลูกค้าซ้ำ
      const st = deps.state ?? defaultState;
      if ((await st.get(paidKey(pb.c))) !== null) {
        await deps.line.reply(replyToken, [`ออเดอร์ ${pb.c} ยืนยันรับเงินไปแล้วครับ (ไม่ได้ส่งหาลูกค้าซ้ำ)`]);
        return;
      }
      await st.set(paidKey(pb.c), "1", OPEN_ORDER_SECONDS * 10);
      await deps.line.push(pb.u, [paidConfirmMessage(pb.c, pb.t)]);
      const logged = await log(statusEvent(pb.c, ORDER_STATUS.paid));
      // ใบปะหน้า: ที่อยู่ที่ลูกค้ากรอกไว้ → ลิงก์หน้าพิมพ์ ส่งต่อให้พนักงานได้เลย
      const label = await getLabel(deps.state ?? defaultState, pb.c).catch(() => null);
      const labelMsg = label && deps.orderSecret
        ? labelReadyText(pb.c, label.name, labelUrl(pb.c, deps.orderSecret))
        : `🖨️ ไม่มีที่อยู่ของ ${pb.c} ในระบบใบปะหน้า (ลูกค้าไม่ได้กรอกแบบฟอร์ม) — ดูที่อยู่ในแชทแทนนะครับ`;
      await deps.line.reply(replyToken, [`✅ ยืนยันออเดอร์ ${pb.c} แล้ว · แจ้งลูกค้าแล้ว${logged ? " · ลงชีทแล้ว" : ""}`, labelMsg]);
    } else {
      await deps.line.push(pb.u, [`ขออภัยครับ ยอดโอนของออเดอร์ ${pb.c} ยังไม่ตรง/ยังไม่พบยอด เดี๋ยวแอดมินติดต่อกลับในแชทนี้นะครับ 🙏`]);
      await log(statusEvent(pb.c, ORDER_STATUS.mismatch));
      await deps.line.reply(replyToken, [`แจ้งลูกค้าแล้วว่ายอดออเดอร์ ${pb.c} ยังไม่ตรง · คุยต่อใน ${replyPlace(pb.u)} ได้เลย`]);
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
// ลูกค้า LINE → แบบฟอร์มใน LINE (LIFF) · ลูกค้า Facebook/Instagram → หน้าเว็บ /order (ลิงก์มีลายเซ็นผูกกับลูกค้าคนนี้)
// จ่ายเงิน: QR พร้อมเพย์ใส่ยอด (ถ้าตั้ง PROMPTPAY_ID) + เลขบัญชีแยกข้อความ (กดค้างคัดลอก)
async function sendOrderSummary(deps: BotDeps, replyToken: string, userId: string, order: PricedOrder, turnText: string) {
  const meta = isMetaUser(userId);
  const token = deps.orderSecret
    ? signOrder({ code: order.code, product: order.product, picks: order.picks, tax: order.tax, total: order.total, ...(meta ? { u: userId } : {}) }, deps.orderSecret)
    : "";
  const formUrl = !token ? "" : meta ? `${baseUrl()}/order?o=${encodeURIComponent(token)}` : deps.liffId ? `https://liff.line.me/${deps.liffId}?o=${encodeURIComponent(token)}` : "";
  const qr = Boolean(token) && promptPayEnabled();
  const account = accountNumber(deps.paymentInfo ?? "");
  const out: OutMessage[] = [orderSummaryText(order, deps.paymentInfo ?? "", Boolean(formUrl), { qr, copyAccount: Boolean(account) })];
  if (qr) out.push(promptPayImageMessage(token));
  if (account) out.push(account);
  if (formUrl) out.push(addressButtonMessage(formUrl));
  await send(deps, replyToken, userId, out);
  // จำออเดอร์ล่าสุด → ลูกค้าส่งสลิปมา แอดมินได้ปุ่ม ✅/❌ ใต้รูปสลิปเลย
  await (deps.state ?? defaultState).set(openOrderKey(userId), JSON.stringify({ code: order.code, total: order.total }), OPEN_ORDER_SECONDS).catch(() => {});
  addTurn(userId, turnText, `ส่งสรุปออเดอร์ ${order.code} ยอด ${order.total}.- แล้ว รอลูกค้ากรอกที่อยู่และโอน`);
  if (!deps.paymentInfo?.trim()) await notifyAdmin(deps, userId, `ออเดอร์ ${order.code} ยอด ${order.total}.- — ยังไม่ได้ตั้ง PAYMENT_INFO ต้องส่งเลขบัญชีให้ลูกค้าเอง`);
}

// ส่งชุดตัวเลือก: มีรูป → การ์ดปัดดู · ไม่มีรูป → ปุ่มด่วนติดข้อความสุดท้าย (ปุ่มด่วนแสดงเฉพาะใต้ข้อความล่าสุด)
function withMenuButtons(out: OutMessage[]): OutMessage[] {
  const last = out[out.length - 1];
  if (typeof last !== "string") return out;
  // ปุ่มเดียวกับ Rich Menu 6 ช่อง (lib/richmenu.ts) + ราคา
  const items = [MENU.order, MENU.price, MENU.promo, MENU.install, MENU.review, MENU.admin, MENU.design].map((t) => ({ type: "action", action: { type: "message", label: t, text: t } }));
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
// ความจำถาวร (lib/state.ts): โปรรีวิวส่งครั้งเดียวต่อลูกค้าต่อ 30 วัน · ช่วงพักหลังส่งเรื่องให้แอดมิน 10 นาที
export const MUTE_SECONDS = 10 * 60;
const GREET_SECONDS = 30 * 24 * 60 * 60;
const muteKey = (userId: string) => `mute:${userId}`;
const greetKey = (userId: string) => `greet:${userId}`;

// ออเดอร์ล่าสุดที่ส่งสรุปยอดไป (รอสลิป) · ออเดอร์ที่แอดมินยืนยันรับเงินแล้ว
const OPEN_ORDER_SECONDS = 3 * 24 * 60 * 60;
const openOrderKey = (userId: string) => `order:${userId}`;
const paidKey = (code: string) => `paid:${code}`;
async function openOrder(state: StateStore, userId: string): Promise<{ code: string; total: number } | null> {
  const v = await state.get(openOrderKey(userId)).catch(() => null);
  if (!v) return null;
  try {
    const o = JSON.parse(v);
    if (typeof o.code !== "string" || typeof o.total !== "number") return null;
    return (await state.get(paidKey(o.code)).catch(() => null)) === null ? o : null; // จ่ายแล้ว = ไม่ค้าง
  } catch {
    return null;
  }
}

// รูปสินค้า + "มีแบบนี้ไหม": ฝั่งรูปบันทึกสถานะ pending → ask (ตอบเป็นคำถามสินค้า) / slip (ตอบแบบสลิป) · ฝั่งข้อความบันทึกว่าถามอยู่
export const PHOTO_ASK = /แบบนี้|อันนี้|ตัวนี้|ลายนี้|สีนี้|ทรงนี้|ตามรูป|ในรูป|ตามภาพ|ในภาพ|แบบรูป|เหมือนรูป|เหมือนในรูป/;
const PHOTO_SECONDS = 90;
const PHOTO_ASK_SECONDS = 60;
const photoKey = (userId: string) => `photo:${userId}`;
const photoAskKey = (userId: string) => `photoask:${userId}`;
export const PHOTO_ASK_REPLY = "ได้รับรูปแล้วครับ 🙏 แอดมินจะดูรูปให้อีกที ระหว่างนี้เลือกประเภทกรอบจากการ์ดด้านล่างได้เลยครับ จะได้ลายตรงตามที่ต้องการ 😊";

async function waitForPhoto(state: StateStore, userId: string, waitMs: number): Promise<string | null> {
  const until = Date.now() + waitMs;
  for (;;) {
    const v = await state.get(photoKey(userId)).catch(() => null);
    if (v === "ask" || v === "slip" || Date.now() >= until) return v;
    await new Promise((r) => setTimeout(r, Math.min(500, Math.max(1, until - Date.now()))));
  }
}

// AI รู้ประเภทกรอบ → ส่งขั้นแรกของประเภทนั้น (ลูกค้าเลือกสี/ลายเอง) · ไม่รู้ → การ์ดเลือกประเภท
async function sendPhotoAsk(deps: BotDeps, replyToken: string, userId: string, product = "") {
  const sets: ImageSet[] = await (deps.getImageSets ?? getImageSets)().catch(() => []);
  const first = product ? firstStepSet(sets, product) : undefined;
  if (first?.items.length) {
    const text = `ได้รับรูปแล้วครับ 🙏 ดูจากรูปน่าจะเป็น${productLabel(product)}ครับ ${stepTitle(first.name) || "เลือกแบบ"}ที่ต้องการจากการ์ดได้เลย แอดมินจะช่วยดูรูปให้อีกทีครับ 😊`;
    await send(deps, replyToken, userId, withSet([text], first, []));
    addTurn(userId, "[ลูกค้าส่งรูปกรอบป้าย]", `${text}
[ส่งการ์ดรูปชุด "${first.name}" ให้ลูกค้าเลือกแล้ว]`);
    return;
  }
  const category = sets.find((s) => s.name === CATEGORY_SET);
  await send(deps, replyToken, userId, category ? [PHOTO_ASK_REPLY, buildCarousel(category)] : [PHOTO_ASK_REPLY]);
  addTurn(userId, "[ลูกค้าส่งรูปสินค้า ถามว่ามีแบบนี้ไหม]", `[ไม่รู้ประเภทจากรูป · ส่งการ์ด "${CATEGORY_SET}" ให้เลือกเองแล้ว · แอดมินจะดูรูปให้]`);
}

async function readCustomerPhoto(deps: BotDeps, msg: { id: string; contentProvider?: { type?: string; originalContentUrl?: string } }): Promise<PhotoRead | null> {
  const sets: ImageSet[] = await (deps.getImageSets ?? getImageSets)().catch(() => []);
  if (deps.readPhoto) return deps.readPhoto(msg, sets);
  if (!process.env.GEMINI_API_KEY || process.env.PHOTO_VISION === "off") return null;
  const photo = await fetchCustomerImage(msg);
  return photo ? readPhoto(photo, sets.find((s) => s.name === CATEGORY_SET)) : null;
}

// สิ่งที่ AI เห็นในรูป → ต่อท้ายข้อความแจ้งแอดมิน
const aiSaw = (read: PhotoRead | null) => {
  if (!read) return "";
  const bits = [read.product && productLabel(read.product), read.color, read.note].filter(Boolean);
  return bits.length ? ` (AI ดูรูปแล้ว: ${bits.join(" · ")})` : "";
};

// แทรก REVIEW_PROMO ในคำตอบครั้งแรก (ครั้งเดียว) · ข้อความสุดท้ายมีปุ่มด่วน → แทรกก่อน (ปุ่มด่วนแสดงใต้ข้อความสุดท้ายเท่านั้น)
// LINE ส่งได้ไม่เกิน 5 ข้อความต่อครั้ง → เต็มแล้วข้ามไป
function withReviewPromo(deps: BotDeps): BotDeps {
  let done = false;
  const add = (messages: OutMessage[]): OutMessage[] => {
    if (done || messages.length >= 5) return messages;
    done = true;
    const last = messages[messages.length - 1];
    const hasQuickReply = typeof last === "object" && last !== null && "quickReply" in last;
    return hasQuickReply ? [...messages.slice(0, -1), REVIEW_PROMO, last] : [...messages, REVIEW_PROMO];
  };
  return {
    ...deps,
    line: {
      ...deps.line,
      reply: (token, messages) => deps.line.reply(token, add(messages)),
      push: (to, messages) => deps.line.push(to, to === deps.adminUserId ? messages : add(messages)),
    },
  };
}

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

// ลูกค้ามาจากช่องทางไหน (รหัส fb:/ig: มาจาก app/api/meta-webhook) → บอกแอดมินว่าไปตอบที่ไหน
const channelName = (userId: string) => (userId.startsWith("fb:") ? "Facebook" : userId.startsWith("ig:") ? "Instagram" : "");
const replyPlace = (userId: string) => (channelName(userId) ? `Meta Business Suite › กล่องข้อความ (${channelName(userId)})` : "LINE OA Manager › แชท");

async function notifyAdmin(deps: BotDeps, userId: string, note: string, extra: OutMessage[] = []) {
  if (!deps.adminUserId) {
    console.warn("[admin] ยังไม่ได้ตั้ง ADMIN_LINE_USER_ID — แจ้งแอดมินไม่ได้:", note);
    return;
  }
  if (userId === deps.adminUserId) return; // แอดมินทดสอบเอง ไม่ต้องแจ้งตัวเอง
  const name = await deps.line.displayName(userId).catch(() => "");
  const where = channelName(userId);
  const text = `🔔 ลูกค้าต้องการแอดมิน${where ? ` (${where})` : ""}\nชื่อ: ${name || "-"}\nเรื่อง: ${note}\n\nตอบได้ใน ${replyPlace(userId)}`;
  await deps.line.push(deps.adminUserId, [text, ...extra]).catch((err) => console.error("[admin] แจ้งไม่สำเร็จ:", (err as Error).message));
}
