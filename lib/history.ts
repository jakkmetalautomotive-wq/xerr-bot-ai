// จำบทสนทนาล่าสุดของลูกค้าแต่ละคนไว้ในหน่วยความจำ (ให้บอทรู้ว่า "เอาสีดำครับ" หมายถึงสินค้าอะไร)
// หมายเหตุ: Vercel อาจล้างหน่วยความจำได้ตลอด → เป็นแบบ "จำได้ถ้าโชคดี" · อยากจำแน่นอนต้องต่อฐานข้อมูล (Upstash Redis) ภายหลัง
import type { Content } from "@google/genai";

const MAX_MESSAGES = 8; // 4 รอบถาม-ตอบ
const TTL_MS = 30 * 60_000; // เงียบเกิน 30 นาที เริ่มใหม่

const store = new Map<string, { messages: Content[]; at: number }>();

export function getHistory(userId: string, now = Date.now()): Content[] {
  const h = store.get(userId);
  if (!h || now - h.at > TTL_MS) return [];
  return h.messages;
}

export function addTurn(userId: string, question: string, reply: string, now = Date.now()) {
  const messages = [
    ...getHistory(userId, now),
    { role: "user", parts: [{ text: question }] },
    { role: "model", parts: [{ text: reply }] },
  ].slice(-MAX_MESSAGES);
  store.set(userId, { messages, at: now });
  if (store.size > 5000) store.delete(store.keys().next().value!);
}
