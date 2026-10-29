// ชุดรูปสินค้า → การ์ดปัดดูใน LINE (Flex carousel) พร้อมปุ่ม "เลือกแบบที่ N"
// รูปมาจากแท็บ "รูปสินค้า" ใน Google Sheet: ชุดรูป | ลำดับ | ชื่อแบบ | ราคา | ลิงก์รูป | รายละเอียด
// ยังไม่มีแท็บนี้ → ใช้ชุดตัวอย่างในโค้ด (รูปสีพื้นชั่วคราว)
import { parseCsv, expandSheetUrl } from "./sheet.ts";

export const IMAGE_TAB = "รูปสินค้า";
const CACHE_MS = 60_000;
const MAX_CARDS = 12; // LINE carousel ได้สูงสุด 12 ใบ

export type ImageItem = { order: number; name: string; price: string; image: string; detail: string };
export type ImageSet = { name: string; items: ImageItem[] };
export type FlexOut = { type: "flex"; altText: string; contents: Record<string, unknown> };

export function baseUrl(): string {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || "xerr-bot-ai.vercel.app";
  return `https://${host.replace(/^https?:\/\//, "")}`;
}

// ชุดตัวอย่าง (ใช้จนกว่าจะมีแท็บ "รูปสินค้า") — ข้อมูลตาม product-specs ที่จักรยืนยัน 29 ต.ค. 2026
export function sampleSets(): ImageSet[] {
  const img = (f: string) => `${baseUrl()}/samples/${f}`;
  const price = "สั้น-สั้น 399.- / สั้น-ยาว, ยาว-ยาว 419.-";
  return [
    {
      name: "สีกรอบอะคริลิค",
      items: [
        { order: 1, name: "สีเรียบ ดำ", price, image: img("acrylic-black.png"), detail: "มีเส้นขอบ หรือ ไร้เส้นขอบ" },
        { order: 2, name: "สีเรียบ ขาว", price, image: img("acrylic-white.png"), detail: "มีเส้นขอบ หรือ ไร้เส้นขอบ" },
        { order: 3, name: "สีเรียบ เทา", price, image: img("acrylic-gray.png"), detail: "มีเส้นขอบ หรือ ไร้เส้นขอบ" },
        { order: 4, name: "ลายเคฟล่า ดำ", price, image: img("acrylic-kevlar.png"), detail: "มีเส้นขอบเท่านั้น" },
      ],
    },
  ];
}

// ลิงก์แชร์ Google Drive → id ของไฟล์
export function driveFileId(url: string): string | null {
  if (!/drive\.google\.com|docs\.google\.com/.test(url)) return null;
  return url.match(/\/d\/([A-Za-z0-9_-]{10,})/)?.[1] ?? url.match(/[?&]id=([A-Za-z0-9_-]{10,})/)?.[1] ?? null;
}

// LINE ต้องการลิงก์รูป https ตรง ๆ → ลิงก์ Drive ส่งผ่าน /api/img ของเราเอง
export function lineImageUrl(url: string): string {
  const id = driveFileId(url);
  if (id) return `${baseUrl()}/api/img?id=${id}`;
  return url;
}

export function parseImageSets(csv: string): ImageSet[] {
  const [header, ...rows] = parseCsv(csv);
  const col = (name: string) => header?.findIndex((h) => h.trim() === name) ?? -1;
  const c = { set: col("ชุดรูป"), order: col("ลำดับ"), name: col("ชื่อแบบ"), price: col("ราคา"), image: col("ลิงก์รูป"), detail: col("รายละเอียด") };
  // gviz คืนแท็บแรกถ้าหาแท็บไม่เจอ → เช็คหัวคอลัมน์ให้แน่ใจว่าเป็นแท็บรูปจริง
  if (c.set < 0 || c.name < 0 || c.image < 0) return [];
  const sets = new Map<string, ImageItem[]>();
  for (const r of rows) {
    const set = r[c.set]?.trim();
    const image = r[c.image]?.trim();
    if (!set || !image || !/^https:\/\//.test(image)) continue;
    const items = sets.get(set) ?? [];
    items.push({
      order: Number(r[c.order]) || items.length + 1,
      name: r[c.name]?.trim() || `แบบที่ ${items.length + 1}`,
      price: c.price >= 0 ? r[c.price]?.trim() ?? "" : "",
      image,
      detail: c.detail >= 0 ? r[c.detail]?.trim() ?? "" : "",
    });
    sets.set(set, items);
  }
  return [...sets].map(([name, items]) => ({ name, items: items.sort((a, b) => a.order - b.order).slice(0, MAX_CARDS) }));
}

let cache: { sets: ImageSet[]; at: number } | null = null;

export async function getImageSets(now = Date.now()): Promise<ImageSet[]> {
  if (cache && now - cache.at < CACHE_MS) return cache.sets;
  let sets: ImageSet[] = [];
  const sheetLink = (process.env.SHEET_CSV_URL ?? "").split(",").map((u) => u.trim()).find((u) => /docs\.google\.com\/spreadsheets\/d\//.test(u));
  if (sheetLink) {
    try {
      const [url] = expandSheetUrl(sheetLink.replace(/[?#].*$/, ""), [IMAGE_TAB]);
      const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(4_000) });
      if (res.ok) sets = parseImageSets(await res.text());
    } catch (err) {
      console.warn("[images] อ่านแท็บรูปไม่ได้:", (err as Error).message);
    }
  }
  if (!sets.length) sets = sampleSets();
  cache = { sets, at: now };
  return sets;
}

export function _resetImageCache() {
  cache = null;
}

export function findSet(sets: ImageSet[], name: string): ImageSet | undefined {
  const n = name.trim();
  if (!n) return undefined;
  return sets.find((s) => s.name === n) ?? sets.find((s) => s.name.includes(n) || n.includes(s.name));
}

// ข้อความที่ลูกค้าส่งกลับเมื่อกดปุ่ม — มีชื่อชุด + ชื่อแบบ บอทจึงรู้ว่าเลือกอะไรแม้ลืมบทสนทนา
export function choiceText(set: ImageSet, item: ImageItem): string {
  return `เลือกแบบที่ ${item.order}: ${item.name} (${set.name})`;
}

export function buildCarousel(set: ImageSet): FlexOut {
  const bubbles = set.items.map((item) => ({
    type: "bubble",
    size: "kilo",
    hero: { type: "image", url: lineImageUrl(item.image), size: "full", aspectRatio: "20:13", aspectMode: "cover" },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        { type: "text", text: `แบบที่ ${item.order}`, size: "xs", color: "#888888" },
        { type: "text", text: item.name, weight: "bold", size: "md", wrap: true },
        ...(item.price ? [{ type: "text", text: item.price, size: "sm", color: "#D32F2F", wrap: true }] : []),
        ...(item.detail ? [{ type: "text", text: item.detail, size: "xs", color: "#666666", wrap: true }] : []),
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#1F2937",
          height: "sm",
          action: { type: "message", label: `เลือกแบบที่ ${item.order}`.slice(0, 20), text: choiceText(set, item) },
        },
      ],
    },
  }));
  const altText = `${set.name}: ` + set.items.map((i) => `แบบที่ ${i.order} ${i.name}`).join(" / ");
  return { type: "flex", altText: altText.slice(0, 400), contents: { type: "carousel", contents: bubbles } };
}
