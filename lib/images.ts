// ชุดรูปสินค้า → การ์ดปัดดูใน LINE (Flex carousel) พร้อมปุ่ม "เลือกแบบที่ N"
// รูปมาจากแท็บ "รูปสินค้า" ใน Google Sheet: ชุดรูป | ลำดับ | ชื่อแบบ | ราคา | ลิงก์รูป | รายละเอียด | ลิงก์คลิป (ไม่บังคับ)
// ชุดที่ไม่ใส่ลิงก์รูปเลย = ตัวเลือกง่าย → ส่งเป็นปุ่มด่วน (quick reply) ใต้ข้อความ
// ยังไม่มีแท็บนี้ → ใช้ชุดตัวอย่างในโค้ด (รูปสีพื้นชั่วคราว)
import { parseCsv, expandSheetUrl } from "./sheet.ts";

export const IMAGE_TAB = "รูปสินค้า";
const CACHE_MS = 60_000;
const MAX_CARDS = 12; // LINE carousel ได้สูงสุด 12 ใบ

export type ImageItem = { order: number; name: string; price: string; image: string; detail: string; link?: string };
export type ImageSet = { name: string; items: ImageItem[] };
export type FlexOut = { type: "flex"; altText: string; contents: Record<string, unknown> };

export function baseUrl(): string {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || "xerr-bot-ai.vercel.app";
  return `https://${host.replace(/^https?:\/\//, "")}`;
}

// ชุด "ขั้น 0": การ์ดเลือกประเภทสินค้า · ชื่อแบบ = ชื่อสินค้าที่ใช้ตั้งชื่อชุด "<สินค้า> ขั้น N ..."
// ราคาบนการ์ดนี้ใช้คิดยอดเมื่อมีราคาเดียว (เช่น ABS 199.-) · สินค้าไม่มีชุดขั้นตอน (ไร้ขอบ) = กดแล้วสั่งได้เลย
export const CATEGORY_SET = "เลือกประเภทสินค้า";

// ชุดการ์ดวิธีติดตั้ง (ปุ่มเมนู 🔧) · แบบที่มีลิงก์คลิป → ปุ่มเปิด YouTube · ไม่ใส่รูป = ใช้ภาพปกคลิปเอง
export const INSTALL_SET = "วิธีติดตั้ง";
const INSTALL_BUTTON = "▶ ดูคลิปวิธีติดตั้ง";

// ลิงก์ YouTube (watch / youtu.be / shorts) → ภาพปกคลิป
export function youtubeThumb(url: string): string {
  const id = url.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/)?.[1];
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : "";
}

// การ์ดวิธีติดตั้ง ↔ แถวในแท็บ "สินค้าและราคา" (คอลัมน์ รหัส) · ลิงก์คลิปอ่านจากคอลัมน์ "คลิปวิธีติดตั้ง" ของแถวนั้น
// ลิงก์สำรองด้านล่าง = ค่าในชีท ณ 29 ต.ค. 2026 (ใช้ตอนอ่านชีทไม่ได้)
export const PRODUCT_TAB = "สินค้าและราคา";
const INSTALL_ROWS: [code: string, name: string, detail: string, fallback: string][] = [
  ["acrylic-ss", "อะคริลิค", "ต้องลอกฟิล์มกันรอยสีน้ำตาลก่อนติดตั้ง", "https://www.youtube.com/shorts/TAfBgMMPaLo"],
  ["stainless", "สแตนเลส", "ทั้งแบบมีและไม่มีแผ่นอะคริลิคใส", "https://www.youtube.com/shorts/gPLZ3Q1U3cM"],
  ["steel", "เหล็กพ่นสี", "ทั้งแบบมีและไม่มีแผ่นอะคริลิคใส", "https://www.youtube.com/shorts/4T8q5ub69XM"],
  ["abs", "พลาสติก ABS", "ใส่ไม่ลงให้กดไล่จากล่างขึ้นบน", "https://www.youtube.com/shorts/YbnSyMiTUYE"],
  ["borderless", "ไร้ขอบ", "กาว 3M เทปแดง ไม่ต้องตัดป้าย", "https://www.youtube.com/shorts/9_rTKGa4n7U"],
  ["truck", "รถตู้/บรรทุก", "ป้ายทะเบียน 30 · 45 × 24 ซม.", "https://www.youtube.com/shorts/0ImfgQxLS_M"],
  ["tax-car", "ป้ายภาษี พรบ. รถยนต์", "เทปกาวเหนียว ไม่ทิ้งคราบ", "https://www.youtube.com/shorts/r7i0wnkWZmk"],
  ["tax-moto", "ป้ายภาษี พรบ. มอเตอร์ไซค์", "ใช้ซ้ำได้ ลอกกาวเปลี่ยนใหม่", "https://www.youtube.com/shorts/jlbwvEijfAQ"],
];

// แท็บสินค้าและราคา → { รหัส: ลิงก์คลิป }
export function parseInstallLinks(csv: string): Record<string, string> {
  const [header, ...rows] = parseCsv(csv);
  const code = header?.findIndex((h) => h.trim() === "รหัส") ?? -1;
  const clip = header?.findIndex((h) => h.trim() === "คลิปวิธีติดตั้ง") ?? -1;
  if (code < 0 || clip < 0) return {};
  return Object.fromEntries(rows.map((r) => [r[code]?.trim(), r[clip]?.trim()]).filter(([c, l]) => c && /^https:\/\//.test(l ?? "")));
}

// แถวที่ชีทไม่มีลิงก์ https → ใช้ลิงก์สำรอง
export function installSet(links: Record<string, string> = {}): ImageSet {
  return {
    name: INSTALL_SET,
    items: INSTALL_ROWS.map(([code, name, detail, fallback], i) => {
      const link = links[code] ?? fallback;
      return { order: i + 1, name, price: "", image: youtubeThumb(link), detail, link };
    }),
  };
}

// ชุดตัวอย่าง (ใช้จนกว่าจะมีแท็บ "รูปสินค้า") — ข้อมูลตาม product-specs / price-promo-2026 ที่จักรยืนยัน 29 ต.ค. 2026
// ชุดที่ไม่มีรูปเลยสักแบบ = ตัวเลือกง่าย → ส่งเป็นปุ่มด่วนใต้ข้อความแทนการ์ด
export function sampleSets(): ImageSet[] {
  const img = (f: string) => `${baseUrl()}/samples/${f}`;
  const items = (rows: [name: string, price: string, image: string, detail: string][]): ImageItem[] =>
    rows.map(([name, price, image, detail], i) => ({ order: i + 1, name, price, image: image && img(image), detail }));
  const acrylicPrice = "สั้น-สั้น 399.- / สั้น-ยาว, ยาว-ยาว 419.-";
  const shapes = (detail: string) => items([
    ["สี่เหลี่ยมขอบใหญ่", "", "shape-rect-wide.png", `35.5 × 15.5 ซม. · ${detail}`],
    ["สี่เหลี่ยมขอบเล็ก", "", "shape-rect-thin.png", `35.5 × 15.5 ซม. · ${detail}`],
    ["คางหมู", "", "shape-trapezoid.png", `38.5 × 16.5 ซม. · ${detail}`],
  ]);
  // ตั้งชื่อชุดเป็น "สินค้า ขั้น N ..." → บอทส่งทีละขั้นตามลำดับ
  return [
    {
      name: CATEGORY_SET,
      items: items([
        ["อะคริลิค", "399.- / 419.-", "cat-acrylic.png", "ปกติ 550.- · สกรีนสีด้านใน ไม่ซีด · 3 ขนาด"],
        ["สแตนเลส", "279.- / 319.- (มีแผ่นใส)", "cat-stainless.png", "ปกติ 450.- · สแตนเลส 100% ไม่เป็นสนิม · 3 ทรง"],
        ["เหล็กพ่นสี", "249.- / 299.- (มีแผ่นใส)", "cat-steel.png", "ปกติ 390.- · สีขาว / ดำ · 3 ทรง"],
        ["พลาสติก ABS", "199.-", "cat-abs.png", "ปกติ 350.- · กิ๊ปล็อค 34.5 × 17 ซม. เหมาะป้ายรุ่นใหม่"],
        ["ไร้ขอบ", "199.-", "cat-undercut.png", "ปกติ 250.- · บางเฉียบ 33 × 14.5 ซม. กาว 3M แท้"],
        ["รถตู้/บรรทุก", "399.-", "cat-truck.png", "ปกติ 590.- · ป้ายทะเบียน 30 · 45 × 24 ซม."],
        ["กรอบป้ายภาษี พรบ.", "69.- / 129.-", "cat-tax.png", "รถยนต์ 69.- · มอเตอร์ไซค์ 129.- · ใช้ซ้ำได้"],
      ]),
    },
    {
      name: "อะคริลิค ขั้น 1 เลือกสี",
      items: items([
        ["สีดำ มีเส้นขอบ", acrylicPrice, "black-border.png", "สีเรียบ"],
        ["สีดำ ไร้เส้นขอบ", acrylicPrice, "black-noborder.png", "สีเรียบ"],
        ["สีขาว มีเส้นขอบ", acrylicPrice, "white-border.png", "สีเรียบ"],
        ["สีขาว ไร้เส้นขอบ", acrylicPrice, "white-noborder.png", "สีเรียบ"],
        ["สีเทา มีเส้นขอบ", acrylicPrice, "gray-border.png", "สีเรียบ"],
        ["สีเทา ไร้เส้นขอบ", acrylicPrice, "gray-noborder.png", "สีเรียบ"],
        ["ลายเคฟล่า ดำ มีเส้นขอบ", acrylicPrice, "kevlar-border.png", "ลายเคฟล่ามีแบบมีเส้นขอบเท่านั้น"],
      ]),
    },
    {
      name: "อะคริลิค ขั้น 2 เลือกขนาด",
      items: items([
        ["สั้น-สั้น", "399.-", "size-ss.png", "หน้าสั้น หลังสั้น · ตัวสั้น 39.5 × 16.2 ซม."],
        ["สั้น-ยาว", "419.-", "size-sl.png", "หน้าสั้น หลังยาว (แนะนำ) · ตัวยาว 49.5 × 16.2 ซม."],
        ["ยาว-ยาว", "419.-", "size-ll.png", "หน้ายาว หลังยาว · รถช่องป้ายหน้าเล็ก (เช่น Mazda 2) ใส่ไม่ได้"],
      ]),
    },
    {
      name: "อะคริลิค ขั้น 3 เลือกเส้นคาดกลาง",
      items: items([
        ["มีเส้นคาดกลาง", "", "center-yes.png", "ราคาเท่าเดิม"],
        ["ไม่มีเส้นคาดกลาง", "", "center-no.png", "ราคาเท่าเดิม"],
      ]),
    },
    { name: "สแตนเลส ขั้น 1 เลือกทรง", items: shapes("สแตนเลสเงา") },
    {
      name: "สแตนเลส ขั้น 2 เลือกแผ่นอะคริลิคใส",
      items: items([["ไม่มีแผ่นใส", "279.-", "", ""], ["มีแผ่นใส", "319.-", "", "แผ่นอะคริลิคใส กันฝน/ฝุ่น (กันน้ำไม่ 100%)"]]),
    },
    { name: "เหล็กพ่นสี ขั้น 1 เลือกสี", items: items([["สีขาว", "", "", ""], ["สีดำ", "", "", ""]]) },
    { name: "เหล็กพ่นสี ขั้น 2 เลือกทรง", items: shapes("เหล็กพ่นสี") },
    {
      name: "เหล็กพ่นสี ขั้น 3 เลือกแผ่นอะคริลิคใส",
      items: items([["ไม่มีแผ่นใส", "249.-", "", ""], ["มีแผ่นใส", "299.-", "", "แผ่นอะคริลิคใส กันฝน/ฝุ่น (กันน้ำไม่ 100%)"]]),
    },
    { name: "พลาสติก ABS ขั้น 1 เลือกสี", items: items([["สีขาว", "", "", ""], ["สีดำ", "", "", ""]]) },
    { name: "พลาสติก ABS ขั้น 2 เลือกเส้นคาดกลาง", items: items([["มีเส้นคาดกลาง", "", "", ""], ["ไม่มีเส้นคาดกลาง", "", "", ""]]) },
    { name: "รถตู้/บรรทุก ขั้น 1 เลือกวัสดุ", items: items([["สแตนเลส", "", "", ""], ["เหล็กพ่นสีขาว", "", "", ""], ["เหล็กพ่นสีดำ", "", "", ""]]) },
    { name: "กรอบป้ายภาษี พรบ. ขั้น 1 เลือกประเภทรถ", items: items([["รถยนต์", "69.-", "", "12 × 11 ซม."], ["มอเตอร์ไซค์", "129.-", "", "11.8 × 5.8 ซม."]]) },
    installSet(),
  ];
}

// ชุดไม่มีรูปเลย → ส่งเป็นปุ่มด่วน
export const isQuickSet = (set: ImageSet) => set.items.length > 0 && set.items.every((i) => !i.image);

// ขั้นแรกของสินค้า (ไม่มี = สินค้าไม่มีตัวเลือก สั่งได้เลย)
export function firstStepSet(sets: ImageSet[], product: string): ImageSet | undefined {
  return sets
    .map((s) => ({ s, st: stepOf(s.name) }))
    .filter((x) => x.st?.product === product)
    .sort((a, b) => a.st!.step - b.st!.step)[0]?.s;
}

// "อะคริลิค ขั้น 2 เลือกขนาด" → "เลือกขนาด"
export const stepTitle = (setName: string) => setName.replace(/^.*?ขั้น(?:ที่)?\s*\d+\s*/, "").trim();

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
  const c = { set: col("ชุดรูป"), order: col("ลำดับ"), name: col("ชื่อแบบ"), price: col("ราคา"), image: col("ลิงก์รูป"), detail: col("รายละเอียด"), link: col("ลิงก์คลิป") };
  // gviz คืนแท็บแรกถ้าหาแท็บไม่เจอ → เช็คหัวคอลัมน์ให้แน่ใจว่าเป็นแท็บรูปจริง
  if (c.set < 0 || c.name < 0 || c.image < 0) return [];
  const sets = new Map<string, ImageItem[]>();
  for (const r of rows) {
    const set = r[c.set]?.trim();
    const link = c.link >= 0 ? r[c.link]?.trim() ?? "" : "";
    const image = r[c.image]?.trim() || youtubeThumb(link);
    if (!set || !r[c.name]?.trim() || (image && !/^https:\/\//.test(image))) continue;
    const items = sets.get(set) ?? [];
    items.push({
      order: Number(r[c.order]) || items.length + 1,
      name: r[c.name]?.trim() || `แบบที่ ${items.length + 1}`,
      price: c.price >= 0 ? r[c.price]?.trim() ?? "" : "",
      image,
      detail: c.detail >= 0 ? r[c.detail]?.trim() ?? "" : "",
      ...(/^https:\/\//.test(link) ? { link } : {}),
    });
    sets.set(set, items);
  }
  return [...sets].map(([name, items]) => ({ name, items: items.sort((a, b) => a.order - b.order).slice(0, MAX_CARDS) }));
}

let cache: { sets: ImageSet[]; at: number } | null = null;

export async function getImageSets(now = Date.now()): Promise<ImageSet[]> {
  if (cache && now - cache.at < CACHE_MS) return cache.sets;
  let sets: ImageSet[] = [];
  let links: Record<string, string> = {};
  const sheetLink = (process.env.SHEET_CSV_URL ?? "").split(",").map((u) => u.trim()).find((u) => /docs\.google\.com\/spreadsheets\/d\//.test(u));
  if (sheetLink) {
    const [imageUrl, productUrl] = expandSheetUrl(sheetLink.replace(/[?#].*$/, ""), [IMAGE_TAB, PRODUCT_TAB]);
    const read = async (url: string, what: string) => {
      try {
        const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(4_000) });
        return res.ok ? await res.text() : "";
      } catch (err) {
        console.warn(`[images] อ่าน${what}ไม่ได้:`, (err as Error).message);
        return "";
      }
    };
    const [imageCsv, productCsv] = await Promise.all([read(imageUrl, "แท็บรูป"), read(productUrl, "ลิงก์คลิป")]);
    sets = parseImageSets(imageCsv);
    links = parseInstallLinks(productCsv);
  }
  // ชุดวิธีติดตั้ง: แท็บรูปไม่ได้ตั้งเอง → ใช้ชุดในโค้ด + ลิงก์คลิปจากแท็บสินค้าและราคา
  const customInstall = sets.some((s) => s.name === INSTALL_SET);
  if (!sets.length) sets = sampleSets();
  if (!customInstall) sets = [...sets.filter((s) => s.name !== INSTALL_SET), installSet(links)];
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
    ...(item.image ? { hero: { type: "image", url: lineImageUrl(item.image), size: "full", aspectRatio: "20:13", aspectMode: "cover" } } : {}),
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
    // ชุดวิธีติดตั้ง: แบบที่ไม่มีคลิป (ไร้ขอบ) อ่านขั้นตอนบนการ์ดได้เลย ไม่ต้องมีปุ่ม
    ...(item.link || set.name !== INSTALL_SET
      ? {
          footer: {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "button",
                style: "primary",
                color: item.link ? "#D32F2F" : "#1F2937",
                height: "sm",
                action: item.link
                  ? { type: "uri", label: INSTALL_BUTTON, uri: item.link }
                  : { type: "message", label: `เลือกแบบที่ ${item.order}`.slice(0, 20), text: choiceText(set, item, picked) },
              },
            ],
          },
        }
      : {}),
  }));
  const altText = `${set.name}: ` + set.items.map((i) => `แบบที่ ${i.order} ${i.name}`).join(" / ");
  return { type: "flex", altText: altText.slice(0, 400), contents: { type: "carousel", contents: bubbles } };
}

// ตัวเลือกง่าย → ปุ่มด่วนใต้ข้อความ (สูงสุด 13 ปุ่ม · ป้ายปุ่มไม่เกิน 20 ตัวอักษร)
export function buildQuickReply(set: ImageSet, picked: string[] = []) {
  return {
    items: set.items.slice(0, 13).map((item) => {
      const withPrice = item.price ? `${item.name} ${item.price}` : item.name;
      return { type: "action", action: { type: "message", label: (withPrice.length <= 20 ? withPrice : item.name).slice(0, 20), text: choiceText(set, item, picked) } };
    }),
  };
}
