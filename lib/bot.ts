// ตรรกะตอบข้อความ 1 ข้อความ (แยกจาก route.ts เพื่อทดสอบได้โดยไม่ต้องมี LINE จริง)
import type { webhook } from "@line/bot-sdk";
import { getFaq } from "./sheet.ts";
import { askGemini, type BotAnswer } from "./gemini.ts";
import { getHistory, addTurn } from "./history.ts";
import { getImageSets, findSet, buildCarousel, parseChoice, nextStepSet, type FlexOut, type ImageSet } from "./images.ts";
import { DEFAULT_REPLY, ERROR_REPLY, IMAGE_REPLY, adminNotice, bangkokClock } from "./shop.ts";

// ข้อความที่ส่งออก: ข้อความธรรมดา หรือการ์ด (Flex)
export type OutMessage = string | FlexOut;

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
}

const STICKER = "[ลูกค้าส่งสติกเกอร์]";

export async function handleEvent(event: webhook.Event, deps: BotDeps): Promise<void> {
  if (event.type !== "message" || event.source?.type !== "user" || !event.source.userId) return;
  const e = event as webhook.MessageEvent;
  const userId = event.source.userId;
  const replyToken = e.replyToken!;
  const msg = e.message;

  if (msg.type === "text" && msg.text.trim().toLowerCase() === "myid") {
    await deps.line.reply(replyToken, [userId]);
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
