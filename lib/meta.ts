// Facebook Messenger + Instagram DM → ใช้สมองบอทตัวเดียวกับ LINE (lib/bot.ts)
// หลักการ: แปลงข้อความ Meta เป็นรูปแบบ event ของ LINE → handleEvent เดิม → แปลงคำตอบ (ข้อความ/การ์ด Flex/ปุ่มด่วน) กลับเป็นรูปแบบ Meta
// รหัสลูกค้าขึ้นต้นด้วย "fb:" / "ig:" (กันชนกับรหัส LINE ในความจำ/ประวัติแชท) · reply token ของ Meta = รหัสลูกค้า (Meta ไม่มี reply token)
// ค่าที่ต้องตั้งใน Vercel: META_PAGE_ACCESS_TOKEN · META_APP_SECRET · META_VERIFY_TOKEN
import crypto from "node:crypto";
import type { webhook } from "@line/bot-sdk";
import type { LinePort, OutMessage } from "./bot.ts";

const GRAPH = "https://graph.facebook.com/v21.0";
export const BOT_METADATA = "xerr-bot"; // แปะกับข้อความที่บอทส่ง → echo ที่ไม่มีป้ายนี้ = แอดมินตอบเองจากกล่องข้อความ
const TEXT_LIMIT = 1000; // Instagram รับข้อความละไม่เกิน 1,000 ตัวอักษร (Messenger 2,000)
const CARDS_PER_MESSAGE = 10;
const BUTTON_TITLE = 20;

export type MetaChannel = "fb" | "ig";
export const metaChannel = (id: string): MetaChannel | null => (id.startsWith("fb:") ? "fb" : id.startsWith("ig:") ? "ig" : null);
const rawId = (id: string) => id.replace(/^(fb|ig):/, "");

// ---------- ตรวจลายเซ็น webhook ----------
export function verifyMetaSignature(body: string, header: string | null, appSecret: string): boolean {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(body).digest("hex");
  const got = header.slice(7);
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

// ---------- Meta → event รูปแบบ LINE ----------
type MetaAttachment = { type: string; payload?: { url?: string; sticker_id?: number } };
export type MetaMessaging = {
  sender: { id: string };
  recipient: { id: string };
  message?: { mid?: string; text?: string; is_echo?: boolean; app_id?: number; metadata?: string; quick_reply?: { payload: string }; attachments?: MetaAttachment[] };
  postback?: { title?: string; payload: string };
};
export type MetaWebhookBody = { object?: string; entry?: { id: string; messaging?: MetaMessaging[] }[] };

// ปุ่มบนการ์ด/ปุ่มด่วน: TX: = กดแล้วเหมือนลูกค้าพิมพ์ข้อความนั้น · PB: = ปุ่ม postback ของ LINE (สั่งลายนี้ / ป้ายภาษี / ขอเลขพัสดุ)
const TX = "TX:";
const PB = "PB:";

export type MetaEvent = { kind: "line"; event: webhook.Event } | { kind: "human"; userId: string };

export function toLineEvents(body: MetaWebhookBody): MetaEvent[] {
  const channel: MetaChannel | null = body.object === "page" ? "fb" : body.object === "instagram" ? "ig" : null;
  if (!channel) return [];
  const out: MetaEvent[] = [];
  for (const entry of body.entry ?? []) {
    for (const m of entry.messaging ?? []) {
      // ข้อความที่ร้านส่งออกไป (echo) · Messenger: ไม่มีป้ายบอท = แอดมินตอบเอง → บอทพักกับลูกค้าคนนั้น
      if (m.message?.is_echo) {
        if (channel === "fb" && m.message.metadata !== BOT_METADATA) out.push({ kind: "human", userId: `fb:${m.recipient.id}` });
        continue;
      }
      if (m.sender.id === entry.id) continue; // บัญชีร้านเอง
      const userId = `${channel}:${m.sender.id}`;
      const base = { source: { type: "user" as const, userId }, replyToken: userId, timestamp: Date.now(), mode: "active" as const, webhookEventId: m.message?.mid ?? "", deliveryContext: { isRedelivery: false } };
      const payload = m.postback?.payload ?? m.message?.quick_reply?.payload;
      if (payload?.startsWith(PB)) {
        out.push({ kind: "line", event: { ...base, type: "postback", postback: { data: payload.slice(PB.length) } } as webhook.Event });
        continue;
      }
      const text = payload?.startsWith(TX) ? payload.slice(TX.length) : payload ? (m.postback?.title ?? payload) : m.message?.text;
      const id = m.message?.mid ?? `${Date.now()}`;
      if (text?.trim()) {
        out.push({ kind: "line", event: { ...base, type: "message", message: { type: "text", id, text, quoteToken: "" } } as webhook.Event });
        continue;
      }
      const att = m.message?.attachments?.[0];
      if (!att) continue;
      let message: Record<string, unknown> | null = null;
      if (att.type === "image" && att.payload?.sticker_id) message = { type: "sticker", id, packageId: "meta", stickerId: String(att.payload.sticker_id) };
      else if (att.type === "image" && att.payload?.url) message = { type: "image", id, contentProvider: { type: "external", originalContentUrl: att.payload.url, previewImageUrl: att.payload.url } };
      else if (att.type === "video") message = { type: "video", id, contentProvider: { type: "external" } };
      else if (att.type === "file" || att.type === "audio") message = { type: "file", id, fileName: att.type, fileSize: 0 };
      if (message) out.push({ kind: "line", event: { ...base, type: "message", message } as webhook.Event });
    }
  }
  return out;
}

// ---------- คำตอบรูปแบบ LINE → ข้อความ Meta ----------
type MetaButton = { type: "postback"; title: string; payload: string } | { type: "web_url"; title: string; url: string };
type MetaQuickReply = { content_type: "text"; title: string; payload: string };
export type MetaMessage =
  | { text: string; quick_replies?: MetaQuickReply[] }
  | { attachment: { type: "image"; payload: { url: string; is_reusable: boolean } } }
  | { attachment: { type: "template"; payload: { template_type: "generic"; image_aspect_ratio?: "square" | "horizontal"; elements: MetaCard[] } } };
type MetaCard = { title: string; subtitle?: string; image_url?: string; buttons?: MetaButton[] };

type LineAction = { type: string; label?: string; text?: string; data?: string; uri?: string; displayText?: string };
type Node = { type?: string; text?: string; url?: string; contents?: unknown; action?: LineAction; hero?: Node; body?: Node; footer?: Node; header?: Node; [k: string]: unknown };

// ร้านขายราคาเดียวกันทุกช่องทาง → คำว่า "ทาง LINE" ในข้อความลูกค้า เปลี่ยนเป็น "ทางแชท"
const forMeta = (s: string) => s.replace(/ทาง\s*LINE/g, "ทางแชท");
const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

function toButton(a: LineAction): MetaButton | null {
  const title = cut(a.label || a.displayText || a.text || "เลือก", BUTTON_TITLE);
  if (a.type === "uri" && a.uri?.startsWith("http")) return { type: "web_url", title, url: a.uri };
  if (a.type === "message" && a.text) return { type: "postback", title, payload: TX + a.text };
  if (a.type === "postback" && a.data) return { type: "postback", title, payload: PB + a.data };
  return null;
}
function toQuickReply(a: LineAction): MetaQuickReply | null {
  const b = toButton(a);
  return b?.type === "postback" ? { content_type: "text", title: b.title, payload: b.payload } : null;
}

// เดินทั้งการ์ด: เก็บข้อความ (ตามลำดับ) · รูปแรก · ปุ่มทั้งหมด
function collect(node: unknown, acc: { texts: string[]; image?: string; actions: LineAction[] }) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((n) => collect(n, acc));
  const n = node as Node;
  if (n.type === "image" && typeof n.url === "string") acc.image ??= n.url;
  if (n.type === "text") {
    const spans = Array.isArray(n.contents) ? (n.contents as Node[]).map((s) => s.text ?? "").join("") : "";
    const t = (n.text || spans).trim();
    if (t) acc.texts.push(t);
  }
  if (n.action && (n.type === "button" || n.type === "box")) {
    acc.actions.push(n.action);
    return; // ตัวหนังสือในกล่องที่กดได้ = ป้ายปุ่ม ไม่ใช่เนื้อความ
  }
  for (const key of ["header", "hero", "body", "footer", "contents"] as const) if (key in n && key !== "contents") collect(n[key], acc);
  if (Array.isArray(n.contents) && n.type !== "text") collect(n.contents, acc);
}

function bubbleParts(bubble: unknown) {
  const acc: { texts: string[]; image?: string; actions: LineAction[] } = { texts: [], actions: [] };
  collect(bubble, acc);
  return acc;
}

function splitText(text: string): string[] {
  const out: string[] = [];
  let rest = forMeta(text.trim());
  while (rest.length > TEXT_LIMIT) {
    let at = rest.lastIndexOf("\n", TEXT_LIMIT);
    if (at < TEXT_LIMIT / 2) at = TEXT_LIMIT;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function textWithQuickReplies(text: string, replies: MetaQuickReply[]): MetaMessage[] {
  const parts = splitText(text);
  if (!parts.length) return [];
  // ปุ่มด่วนแสดงใต้ข้อความสุดท้ายเท่านั้น
  return parts.map((p, i) => (i === parts.length - 1 && replies.length ? { text: p, quick_replies: replies.slice(0, 13) } : { text: p }));
}

function cardsMessage(cards: MetaCard[]): MetaMessage[] {
  const out: MetaMessage[] = [];
  for (let i = 0; i < cards.length; i += CARDS_PER_MESSAGE) {
    out.push({ attachment: { type: "template", payload: { template_type: "generic", image_aspect_ratio: "square", elements: cards.slice(i, i + CARDS_PER_MESSAGE) } } });
  }
  return out;
}

function toCard(parts: ReturnType<typeof bubbleParts>): MetaCard {
  const [title = "XERR AUTOTEAM", ...rest] = parts.texts.map(forMeta);
  const buttons = parts.actions.map(toButton).filter((b): b is MetaButton => b !== null).slice(0, 3);
  return { title: cut(title, 80), ...(rest.length ? { subtitle: cut(rest.join(" · "), 80) } : {}), ...(parts.image ? { image_url: parts.image } : {}), ...(buttons.length ? { buttons } : {}) };
}

export function toMetaMessages(messages: OutMessage[]): MetaMessage[] {
  const out: MetaMessage[] = [];
  for (const m of messages) {
    if (typeof m === "string") {
      out.push(...textWithQuickReplies(m, []));
      continue;
    }
    const msg = m as { type: string; text?: string; quickReply?: { items?: { action: LineAction }[] }; contents?: Node; altText?: string; originalContentUrl?: string };
    const quick = (msg.quickReply?.items ?? []).map((i) => toQuickReply(i.action)).filter((q): q is MetaQuickReply => q !== null);
    if (msg.type === "text" && msg.text) {
      out.push(...textWithQuickReplies(msg.text, quick));
    } else if (msg.type === "image" && msg.originalContentUrl) {
      out.push({ attachment: { type: "image", payload: { url: msg.originalContentUrl, is_reusable: false } } });
    } else if (msg.type === "flex" && msg.contents) {
      const bubbles = msg.contents.type === "carousel" && Array.isArray(msg.contents.contents) ? (msg.contents.contents as Node[]) : [msg.contents];
      const parts = bubbles.map(bubbleParts);
      if (msg.contents.type === "carousel" || parts[0]?.image) {
        out.push(...cardsMessage(parts.map(toCard)));
      } else {
        // การ์ดข้อความล้วน (ชวนเพิ่มป้ายภาษี / ยืนยันชำระเงิน) → ข้อความ + ปุ่มด่วน · ลิงก์ → ต่อท้ายข้อความ
        const p = parts[0];
        const links = p.actions.filter((a) => a.type === "uri" && a.uri).map((a) => `🔗 ${a.label ?? "เปิดลิงก์"}: ${a.uri}`);
        const replies = p.actions.map(toQuickReply).filter((q): q is MetaQuickReply => q !== null);
        out.push(...textWithQuickReplies([...p.texts, ...links].join("\n") || msg.altText || "", [...replies, ...quick]));
      }
    } else if (msg.altText) {
      out.push(...textWithQuickReplies(msg.altText, quick));
    }
  }
  return out;
}

// ---------- ส่งผ่าน Graph API ----------
type Fetch = typeof fetch;
export function metaPort(token = process.env.META_PAGE_ACCESS_TOKEN ?? "", fetchFn: Fetch = fetch): LinePort {
  const call = async (path: string, body: unknown) => {
    if (!token) throw new Error("ยังไม่ได้ตั้ง META_PAGE_ACCESS_TOKEN");
    const res = await fetchFn(`${GRAPH}${path}?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Meta ${res.status}: ${(await res.text()).slice(0, 300)}`);
  };
  const send = async (to: string, messages: OutMessage[]) => {
    const fb = metaChannel(to) === "fb";
    for (const message of toMetaMessages(messages)) {
      await call("/me/messages", { recipient: { id: rawId(to) }, messaging_type: "RESPONSE", message: fb ? { ...message, metadata: BOT_METADATA } : message });
    }
  };
  return {
    reply: send,
    push: send,
    async showLoading(userId) {
      await call("/me/messages", { recipient: { id: rawId(userId) }, sender_action: "typing_on" });
    },
    async displayName(userId) {
      const fields = metaChannel(userId) === "ig" ? "name,username" : "first_name,last_name";
      const res = await fetchFn(`${GRAPH}/${rawId(userId)}?fields=${fields}&access_token=${encodeURIComponent(token)}`);
      if (!res.ok) return "";
      const p = (await res.json()) as { name?: string; username?: string; first_name?: string; last_name?: string };
      return p.name || [p.first_name, p.last_name].filter(Boolean).join(" ") || (p.username ? `@${p.username}` : "");
    },
  };
}

// ส่งตามช่องทางของผู้รับ: fb:/ig: → Meta · นอกนั้น → LINE (แอดมินอยู่ LINE เสมอ · ปุ่มยืนยันสลิปของแอดมินส่งหาลูกค้า FB/IG ได้)
export function routedPort(line: LinePort, meta: LinePort): LinePort {
  const pick = (id: string) => (metaChannel(id) ? meta : line);
  return {
    reply: (token, msgs) => pick(token).reply(token, msgs),
    push: (to, msgs) => pick(to).push(to, msgs),
    showLoading: (id) => pick(id).showLoading(id),
    displayName: (id) => pick(id).displayName(id),
  };
}
