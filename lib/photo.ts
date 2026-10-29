// เตรียมรูปสินค้าก่อนส่งให้ LINE: พื้นหลังโปร่งใส → ขาว · ย่อให้อยู่ในกรอบจัตุรัสพื้นขาวทั้งรูป (ไม่ตกขอบ)
// การ์ดใช้รูปสัดส่วน 1:1 (lib/images.ts) — รูปแนวนอน/แนวตั้งจะมีขอบขาวเติม แทนการโดนตัด
import crypto from "node:crypto";
import sharp from "sharp";
import { CLEAN_PHOTOS } from "./clean-photos.ts";

// มีรูปที่ลบพื้นหลังแล้ว และรูปใน Drive ยังเป็นต้นฉบับเดิม → ใช้รูปที่ตัดแล้ว · ไม่มี / เปลี่ยนเวอร์ชันแล้ว → null
export function cleanPhotoPath(id: string, original: Buffer | ArrayBuffer): string | null {
  const known = CLEAN_PHOTOS[id];
  if (!known) return null;
  const hash = crypto.createHash("sha1").update(Buffer.from(original as ArrayBuffer)).digest("hex");
  return hash === known ? `/products/${id}.jpg` : null;
}

export const PHOTO_SIZE = 1040;
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

export async function squareOnWhite(input: Buffer | ArrayBuffer): Promise<Buffer> {
  return sharp(Buffer.from(input as ArrayBuffer))
    .rotate() // หมุนตาม EXIF ของรูปจากมือถือ
    .flatten({ background: WHITE })
    .resize(PHOTO_SIZE, PHOTO_SIZE, { fit: "contain", background: WHITE, withoutEnlargement: false })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}
