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
  // ตั้งชื่อชุดเป็น "สินค้า ขั้น N ..." → บอทส่งทีละขั้นตามลำดับ
  return [
    {
      name: "อะคริลิค ขั้น 1 เลือกสี",
      items: [
        { order: 1, name: "สีดำ มีเส้นขอบ", price, image: img("black-border.png"), detail: "สีเรียบ" },
        { order: 2, name: "สีดำ ไร้เส้นขอบ", price, image: img("black-noborder.png"), detail: "สีเรียบ" },
        { order: 3, name: "สีขาว มีเส้นขอบ", price, image: img("white-border.png"), detail: "สีเรียบ" },
        { order: 4, name: "สีขาว ไร้เส้นขอบ", price, image: img("white-noborder.png"), detail: "สีเรียบ" },
        { order: 5, name: "สีเทา มีเส้นขอบ", price, image: img("gray-border.png"), detail: "สีเรียบ" },
        { order: 6, name: "สีเทา ไร้เส้นขอบ", price, image: img("gray-noborder.png"), detail: "สีเรียบ" },
        { order: 7, name: "ลายเคฟล่า ดำ มีเส้นขอบ", price, image: img("kevlar-border.png"), detail: "ลายเคฟล่ามีแบบมีเส้นขอบเท่านั้น" },
      ],
    },
    {
      name: "อะคริลิค ขั้น 2 เลือกขนาด",
      items: [
        { order: 1, name: "สั้น-สั้น", price: "399.-", image: img("size-ss.png"), detail: "หน้าสั้น หลังสั้น · ตัวสั้น 39.5 × 16.2 ซม." },
        { order: 2, name: "สั้น-ยาว", price: "419.-", image: img("size-sl.png"), detail: "หน้าสั้น หลังยาว (แนะนำ) · ตัวยาว 49.5 × 16.2 ซม." },
        { order: 3, name: "ยาว-ยาว", price: "419.-", image: img("size-ll.png"), detail: "หน้ายาว หลังยาว · รถช่องป้ายหน้าเล็ก (เช่น Mazda 2) ใส่ไม่ได้" },
      ],
    },
    {
      name: "อะคริลิค ขั้น 3 เลือกเส้นกลาง",
      items: [
        { order: 1, name: "มีเส้นกลาง", price: "", image: img("center-yes.png"), detail: "ราคาเท่าเดิม" },
        { order: 2, name: "ไม่มีเส้นกลาง", price: "", image: img("center-no.png"), detail: "ราคาเท่าเดิม" },
      ],
    },
  ];
}

// ข้อความจากปุ่ม "เลือกแบบที่ N: ชื่อแบบ (ชื่อชุด) | เลือกแล้ว: a, b" → ชุด + แบบ + ทุกแบบที่เลือกมา (รวมแบบนี้)
export function parseChoice(text: string, sets: ImageSet[]): { set: ImageSet; item: ImageItem; picked: string[] } | null {
  const m = text.trim().match(/^เลือกแบบที่\s*(\d+):\s*(.+?)\s+\(([^()]+)\)(?:\s*\|\s*เลือกแล้ว:\s*(.+))?$/);
  if (!m) return null;
  const set = sets.find((s) => s.name === m[3].trim());
  const item = set?.items.find((i) => i.order === Number(m[1]));
  if (!set || !item) return null;
  const before = m[4] ? m[4].split(",").map((x) => x.trim()).filter(Boolean) : [];
  return { set, item, picked: [...before, item.name] };
}

// ขั้นถัดไปของสินค้าเดียวกัน · แบบที่เลือกไว้มี "ข้ามขั้นXXX" ในรายละเอียด → ข้ามชุดที่ชื่อมี XXX
export function nextStepSet(sets: ImageSet[], set: ImageSet, picked: string[]): ImageSet | undefined {
  const cur = stepOf(set.name);
  if (!cur) return undefined;
  const sameProduct = sets
    .map((s) => ({ s, st: stepOf(s.name) }))
    .filter((x): x is { s: ImageSet; st: { product: string; step: number } } => x.st?.product === cur.product)
    .sort((a, b) => a.st.step - b.st.step);
  const skips = sameProduct
    .flatMap((x) => x.s.items)
    .filter((i) => picked.includes(i.name))
    .map((i) => i.detail.match(/ข้ามขั้น\s*([^)·,|]+)/)?.[1].trim())
    .filter((p): p is string => !!p);
  return sameProduct.find((x) => x.st.step > cur.step && !skips.some((p) => x.s.name.includes(p)))?.s;
}

// ชุดที่อยู่ในขั้นตอนเดียวกัน: "อะคริลิค ขั้น 2 เลือกขนาด" → { product: "อะคริลิค", step: 2 }
export function stepOf(setName: string): { product: string; step: number } | null {
  const m = setName.match(/^(.*?)\s*ขั้น(?:ที่)?\s*(\d+)/);
  return m ? { product: m[1].trim(), step: Number(m[2]) } : null;
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

// ข้อความที่ลูกค้าส่งกลับเมื่อกดปุ่ม — มีชื่อชุด + ชื่อแบบ + ที่เลือกมาก่อน บอทจึงรู้ครบแม้ลืมบทสนทนา
export function choiceText(set: ImageSet, item: ImageItem, picked: string[] = []): string {
  const base = `เลือกแบบที่ ${item.order}: ${item.name} (${set.name})`;
  return (picked.length ? `${base} | เลือกแล้ว: ${picked.join(", ")}` : base).slice(0, 300); // LINE จำกัด 300 ตัวอักษร
}

export function buildCarousel(set: ImageSet, picked: string[] = []): FlexOut {
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
          action: { type: "message", label: `เลือกแบบที่ ${item.order}`.slice(0, 20), text: choiceText(set, item, picked) },
        },
      ],
    },
  }));
  const altText = `${set.name}: ` + set.items.map((i) => `แบบที่ ${i.order} ${i.name}`).join(" / ");
  return { type: "flex", altText: altText.slice(0, 400), contents: { type: "carousel", contents: bubbles } };
}
