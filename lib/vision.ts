// อ่านรูปที่ลูกค้าส่ง (Gemini ดูรูป): สลิป / รูปกรอบป้าย / อื่น ๆ + ประเภทกรอบโดยประมาณ
// ใช้แค่ช่วยเลือกการ์ดที่จะส่ง — ไม่ยืนยันสี/ลายให้ลูกค้า (ลูกค้ากดเลือกจากการ์ดเอง แอดมินดูรูปซ้ำ)
import { GoogleGenAI, Type } from "@google/genai";
import { MODEL, FALLBACK_MODEL } from "./gemini.ts";
import type { ImageSet } from "./images.ts";

export type PhotoKind = "slip" | "plate_frame" | "damage" | "other";
export type PhotoRead = { kind: PhotoKind; product: string; color: string; note: string };
export type ImageBytes = { data: string; mimeType: string }; // data = base64

const KINDS: PhotoKind[] = ["slip", "plate_frame", "damage", "other"];
const TIMEOUT_MS = 12_000;
const BUDGET_MS = 20_000;
const MAX_BYTES = 6 * 1024 * 1024;

// ---------- ดึงรูป ----------
type ImageContent = { id: string; contentProvider?: { type?: string; originalContentUrl?: string } };

export async function fetchCustomerImage(msg: ImageContent, fetchFn: typeof fetch = fetch): Promise<ImageBytes | null> {
  const ext = msg.contentProvider;
  const external = ext?.type === "external" && ext.originalContentUrl?.startsWith("https://");
  const url = external ? ext!.originalContentUrl! : `https://api-data.line.me/v2/bot/message/${msg.id}/content`;
  const headers: Record<string, string> = external ? {} : { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN ?? ""}` };
  return fetchBytes(url, headers, fetchFn);
}

async function fetchBytes(url: string, headers: Record<string, string>, fetchFn: typeof fetch): Promise<ImageBytes | null> {
  const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(8_000) }).catch(() => null);
  const mimeType = (res?.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!res?.ok || !mimeType.startsWith("image/")) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length || buf.length > MAX_BYTES) return null;
  return { data: buf.toString("base64"), mimeType };
}

// รูปการ์ดประเภทสินค้า (รูปสินค้าจริงของร้าน) → ให้ AI เทียบ · จำไว้ในเครื่องที่ยังอุ่น
const refCache = new Map<string, ImageBytes | null>();
async function referenceImages(category: ImageSet, fetchFn: typeof fetch) {
  const items = category.items.filter((i) => i.image);
  return Promise.all(items.map(async (i) => {
    if (!refCache.has(i.image)) refCache.set(i.image, await fetchBytes(i.image, {}, fetchFn).catch(() => null));
    return { name: i.name, img: refCache.get(i.image) ?? null };
  }));
}

// ---------- ถาม Gemini ----------
type GenerateFn = (params: Parameters<GoogleGenAI["models"]["generateContent"]>[0]) => ReturnType<GoogleGenAI["models"]["generateContent"]>;
let client: GoogleGenAI | null = null;
const defaultGenerate = (): GenerateFn => {
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return (params) => client!.models.generateContent(params);
};

export async function readPhoto(
  photo: ImageBytes,
  category: ImageSet | undefined,
  { generate = defaultGenerate(), fetchFn = fetch, models = [MODEL, ...FALLBACK_MODEL.split(",")] }: { generate?: GenerateFn; fetchFn?: typeof fetch; models?: string[] } = {},
): Promise<PhotoRead | null> {
  const products = category?.items.map((i) => i.name) ?? [];
  const refs = category ? await referenceImages(category, fetchFn) : [];
  const parts: { text?: string; inlineData?: ImageBytes }[] = [];
  for (const r of refs) if (r.img) parts.push({ text: `รูปตัวอย่างสินค้าของร้าน: "${r.name}"` }, { inlineData: r.img });
  parts.push({ text: "รูปที่ลูกค้าส่งมา:" }, { inlineData: photo });

  const instruction = `คุณช่วยร้านกรอบป้ายทะเบียนรถ ดูรูปที่ลูกค้าส่งในแชทแล้วจัดประเภท
- kind: "slip" = สลิปโอนเงิน/หน้าจอแอปธนาคาร · "plate_frame" = รูปกรอบป้ายทะเบียน (สินค้าเดี่ยว ๆ หรือติดบนรถ) · "damage" = ของชำรุด/แตก/ส่งมาผิด · "other" = อย่างอื่น (รูปรถเฉย ๆ ไม่เห็นกรอบ, แคปหน้าจอแชท ฯลฯ)
- product: ถ้า kind = plate_frame ให้เลือกประเภทที่ใกล้ที่สุดจากรายการ ${products.map((p) => `"${p}"`).join(", ") || "(ไม่มี)"} โดยเทียบกับรูปตัวอย่างของร้าน · ไม่มั่นใจ = ""
- color: สี/ลายที่เห็น เช่น "ดำเรียบ", "ลายเคฟล่าดำ", "ขาว", "สแตนเลสเงา" · ไม่แน่ใจ = ""
- note: อธิบายสั้นมากว่าเห็นอะไร (ไทย ไม่เกิน 1 ประโยค) เพื่อแจ้งแอดมิน`;

  const schema = {
    type: Type.OBJECT,
    properties: {
      kind: { type: Type.STRING, enum: KINDS },
      product: { type: Type.STRING, enum: [...products, ""] },
      color: { type: Type.STRING },
      note: { type: Type.STRING },
    },
    required: ["kind", "product", "color", "note"],
  };

  const t0 = Date.now();
  for (const model of [...new Set(models.map((m) => m.trim()).filter(Boolean))]) {
    const left = BUDGET_MS - (Date.now() - t0);
    if (left < 4_000) break;
    try {
      const res = await generate({
        model,
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: instruction,
          temperature: 0.2,
          maxOutputTokens: 1024,
          responseMimeType: "application/json",
          responseSchema: schema,
          httpOptions: { timeout: Math.min(TIMEOUT_MS, left) },
        },
      });
      return parsePhotoRead(res.text, products);
    } catch (err) {
      console.warn(`[vision] อ่านรูปไม่ได้ (${model}): ${String((err as Error)?.message ?? err).slice(0, 300)}`);
    }
  }
  return null;
}

export function parsePhotoRead(text: string | undefined, products: string[]): PhotoRead | null {
  try {
    const d = JSON.parse(text ?? "");
    const kind = KINDS.includes(d.kind) ? (d.kind as PhotoKind) : null;
    if (!kind) return null;
    const product = kind === "plate_frame" && products.includes(d.product) ? String(d.product) : "";
    return { kind, product, color: String(d.color ?? "").trim().slice(0, 60), note: String(d.note ?? "").trim().slice(0, 200) };
  } catch {
    return null;
  }
}
