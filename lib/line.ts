// LINE Messaging API ตัวจริง (ใช้ร่วมกันระหว่าง webhook กับ /api/order)
import { messagingApi } from "@line/bot-sdk";
import type { LinePort, OutMessage } from "./bot.ts";

let client: messagingApi.MessagingApiClient | null = null;
function lineClient() {
  client ??= new messagingApi.MessagingApiClient({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN! });
  return client;
}

// LINE ส่งได้ครั้งละไม่เกิน 5 ข้อความ · ข้อความละไม่เกิน 5,000 ตัวอักษร
const toMessages = (messages: OutMessage[]): messagingApi.Message[] =>
  messages
    .filter((m) => (typeof m === "string" ? m.trim() !== "" : true))
    .slice(0, 5)
    .map((m) => (typeof m === "string" ? { type: "text", text: m.trim().slice(0, 5000) } : (m as unknown as messagingApi.Message)));

export const line: LinePort = {
  async reply(replyToken, msgs) {
    await lineClient().replyMessage({ replyToken, messages: toMessages(msgs) });
  },
  async push(to, msgs) {
    await lineClient().pushMessage({ to, messages: toMessages(msgs) });
  },
  async showLoading(userId) {
    await lineClient().showLoadingAnimation({ chatId: userId, loadingSeconds: 20 });
  },
  async displayName(userId) {
    return (await lineClient().getProfile(userId)).displayName;
  },
};

// เลขบัญชีจาก Vercel (PAYMENT_INFO) · พิมพ์ \n ในช่องเดียวก็ได้ จะกลายเป็นขึ้นบรรทัดใหม่
export function paymentInfo() {
  return (process.env.PAYMENT_INFO ?? "").replace(/\\n/g, "\n");
}
