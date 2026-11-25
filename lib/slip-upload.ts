// สลิปที่ลูกค้าแนบในแบบฟอร์มที่อยู่ → ตรวจว่าเป็นรูปจริง + ย่อ → เก็บ 30 วัน (Redis) → ส่งเข้าแชทแอดมินผ่าน /api/slip?u=
// ลิงก์มีลายเซ็น (Channel secret) + รหัสสุ่มต่อรูป · แนบใหม่ = รูปใหม่ ไม่ทับรูปเดิมในแชทแอดมิน
import crypto from "node:crypto";
import sharp from "sharp";
import { baseUrl } from "./images.ts";
import type { StateStore } from "./state.ts";

const SLIP_SECONDS = 30 * 24 * 60 * 60;
const MAX_UPLOAD = 4_000_000; // ตัวอักษร base64 (Vercel รับไม่เกิน 4.5 MB)
const MAX_STORED = 600_000; // ไบต์ (Upstash รับคำสั่งละไม่เกิน 1 MB)
const slipImageKey = (id: string) => `slipimg:${id}`;

// รูปจากแบบฟอร์ม (data URL) → JPEG ที่ย่อแล้ว · ไม่ใช่รูป / เสีย / ใหญ่เกิน → null
export async function readSlipUpload(dataUrl: unknown): Promise<Buffer | null> {
  if (typeof dataUrl !== "string" || dataUrl.length > MAX_UPLOAD) return null;
  const m = dataUrl.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$/);
  if (!m) return null;
  const input = Buffer.from(m[1], "base64");
  try {
    for (const [size, quality] of [[1600, 80], [1280, 70], [1000, 60]]) {
      const out = await sharp(input, { limitInputPixels: 40_000_000 })
        .rotate()
        .flatten({ background: "#ffffff" })
        .resize(size, size, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();
      if (out.length <= MAX_STORED) return out;
    }
  } catch {}
  return null;
}

export async function saveSlipImage(state: StateStore, code: string, image: Buffer): Promise<string> {
  const id = `${code}-${crypto.randomBytes(5).toString("hex")}`;
  await state.set(slipImageKey(id), image.toString("base64"), SLIP_SECONDS);
  return id;
}

export async function getSlipImage(state: StateStore, id: string): Promise<Buffer | null> {
  const v = await state.get(slipImageKey(id)).catch(() => null);
  return v ? Buffer.from(v, "base64") : null;
}

const sign = (id: string, secret: string) => crypto.createHmac("sha256", secret).update(`slipimg:${id}`).digest("base64url").slice(0, 22);

export function verifySlipImage(token: string, secret: string): string | null {
  const m = token.match(/^(XR-[A-Z0-9]{2,12}-[0-9a-f]{10})\.([\w-]{22})$/);
  if (!m || !secret) return null;
  return crypto.timingSafeEqual(Buffer.from(m[2]), Buffer.from(sign(m[1], secret))) ? m[1] : null;
}

export function uploadedSlipMessage(id: string, secret: string) {
  const url = `${baseUrl()}/api/slip?u=${encodeURIComponent(`${id}.${sign(id, secret)}`)}`;
  return { type: "image", originalContentUrl: url, previewImageUrl: url };
}
