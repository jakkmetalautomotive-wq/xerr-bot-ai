// LINE Webhook: ตรวจลายเซ็น → ตอบ LINE ว่า "ได้รับแล้ว" ทันที → ประมวลผลต่อเบื้องหลัง
import { messagingApi, validateSignature, type webhook } from "@line/bot-sdk";
import { waitUntil } from "@vercel/functions";
import { handleEvent, type LinePort, type OutMessage } from "@/lib/bot.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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
    .map((m) => (typeof m === "string" ? { type: "text", text: m.trim().slice(0, 5000) } : (m as unknown as messagingApi.FlexMessage)));

const line: LinePort = {
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

export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get("x-line-signature") ?? "";
  const secret = process.env.LINE_CHANNEL_SECRET ?? "";
  if (!secret || !signature || !validateSignature(body, secret, signature)) {
    return new Response("invalid signature", { status: 401 });
  }

  let events: webhook.Event[] = [];
  try {
    events = (JSON.parse(body) as webhook.CallbackRequest).events ?? [];
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const deps = { line, adminUserId: process.env.ADMIN_LINE_USER_ID };
  waitUntil(
    Promise.all(events.map((e) => handleEvent(e, deps).catch((err) => console.error("[webhook] error:", err)))),
  );
  return new Response("ok");
}

// เปิด URL นี้ในเบราว์เซอร์เพื่อเช็คว่า endpoint ขึ้นแล้ว
export function GET() {
  return new Response("XERR LINE webhook ✅ (LINE จะส่งข้อความมาแบบ POST)");
}
