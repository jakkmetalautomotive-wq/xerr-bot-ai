// ส่งต่อรูปที่ลูกค้าส่งมา (สลิป / รูปของเสียหาย) เข้าแชทแอดมิน
// รูปอยู่ที่ LINE ต้องใช้ token ดึง → ผ่าน /api/slip ของเรา · ลิงก์มีลายเซ็น (Channel secret) เดาเลขข้อความเองไม่ได้
import crypto from "node:crypto";
import { baseUrl } from "./images.ts";

const sign = (id: string, secret: string) => crypto.createHmac("sha256", secret).update(`slip:${id}`).digest("base64url").slice(0, 22);

export function signSlip(messageId: string, secret: string): string {
  return `${messageId}.${sign(messageId, secret)}`;
}

// คืนเลขข้อความเมื่อลายเซ็นถูก
export function verifySlip(token: string, secret: string): string | null {
  const m = token.match(/^(\d{1,30})\.([\w-]{22})$/);
  if (!m || !secret) return null;
  const expected = sign(m[1], secret);
  return crypto.timingSafeEqual(Buffer.from(m[2]), Buffer.from(expected)) ? m[1] : null;
}

type ImageContent = { id: string; contentProvider?: { type?: string; originalContentUrl?: string; previewImageUrl?: string } };

// ข้อความรูปสำหรับส่งเข้าแชทแอดมิน (รูปขนาดเต็ม + รูปย่อ)
export function slipImageMessage(msg: ImageContent, secret: string) {
  const ext = msg.contentProvider;
  if (ext?.type === "external" && ext.originalContentUrl?.startsWith("https://")) {
    return { type: "image", originalContentUrl: ext.originalContentUrl, previewImageUrl: ext.previewImageUrl?.startsWith("https://") ? ext.previewImageUrl : ext.originalContentUrl };
  }
  const url = `${baseUrl()}/api/slip?t=${encodeURIComponent(signSlip(msg.id, secret))}`;
  return { type: "image", originalContentUrl: url, previewImageUrl: `${url}&p=1` };
}
