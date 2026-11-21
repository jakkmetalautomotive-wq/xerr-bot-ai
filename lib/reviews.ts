// รูปรีวิวลูกค้าจริงตามรุ่นรถ — จาก Google Drive โฟลเดอร์ "Xerr Autoteam - Edited Reviews"
// โครงโฟลเดอร์: <รุ่นรถ>/<สินค้า - ลาย>/<รูป>  เช่น  Toyota Fortuner/Acrylic License Plate Frame - Black/xxx.png
// รายชื่อรูปอ่านผ่าน Apps Script (action list_reviews) แล้วจำไว้ 30 นาที → วางรูปใหม่ใน Drive บอทเห็นเองภายใน ~30 นาที
// lib/review-tags.json = ข้อมูลที่ดูจากรูปไว้แล้ว (ตัวสั้น/ยาว · มี/ไม่มีเส้นคาดกลาง · รูปที่ไม่ควรส่ง · รูปที่อยู่ผิดโฟลเดอร์รุ่น)
// รูปใหม่ที่ยังไม่มีในไฟล์นี้ → ใช้รุ่นรถ + ลายจากชื่อโฟลเดอร์ (ยังไม่รู้ขนาด/เส้นคาดกลาง)
import { REVIEW_TAGS } from "./review-tags.ts";
import { baseUrl, CARD_THEME, CATEGORY_SET, firstStepSet, type ImageSet, type ImageItem } from "./images.ts";
import { MENU } from "./shop.ts";
import { encodePostback } from "./order.ts";
import { callOrderSheet } from "./orderlog.ts";
import type { StateStore } from "./state.ts";

export const REVIEW_FOLDER_ID = process.env.REVIEW_FOLDER_ID || "1bLSYWyebvlcpDSJtb1MZYc0u2OxGT6tU";

type Tag = { size?: "S" | "L"; bar?: "Y" | "N"; title?: string; sub?: string; skip?: string; model?: string };
const TAGS: Record<string, Tag> = REVIEW_TAGS;

export type DriveFile = { id: string; name: string; path: string[] };
export type ReviewPhoto = {
  id: string;
  file: string;
  model: string | null; // "Toyota Fortuner" · null = ไม่รู้รุ่น
  brand: string | null; // "Toyota"
  family: string; // ลาย: plain / carbon / sincity / keepcalm / vip / guitar / goldborder / stainless / steel / tax / abs / undercut / speedfoxx
  colors: string[]; // black / white / gray / red / blue / pink / gold
  label: string; // ชื่อลายภาษาไทยบนการ์ด
  size?: "S" | "L";
  bar?: "Y" | "N";
};

// ---------- แปลงรายชื่อไฟล์จาก Drive → รูปรีวิว ----------
const UNKNOWN_MODEL = /model (unknown|unconfirmed)|multiple models/i;

function splitModel(folder: string): { model: string | null; brand: string | null } {
  if (/^(vehicle|motorcycle)\b/i.test(folder)) return { model: null, brand: null };
  const brand = folder.split(/\s+-\s+|\s+/)[0] ?? null;
  return UNKNOWN_MODEL.test(folder) ? { model: null, brand } : { model: folder, brand };
}

const COLOR_WORDS: [RegExp, string][] = [
  [/black/i, "black"], [/white/i, "white"], [/gr[ae]y/i, "gray"], [/red/i, "red"], [/blue/i, "blue"], [/pink/i, "pink"], [/gold/i, "gold"],
];

function familyOf(product: string): string {
  const p = product.toLowerCase();
  if (/tax disc/.test(p)) return "tax";
  if (/carbon/.test(p)) return "carbon";
  if (/sin city/.test(p)) return "sincity";
  if (/keep calm/.test(p)) return "keepcalm";
  if (/vip/.test(p)) return "vip";
  if (/guitar/.test(p)) return "guitar";
  if (/gold border/.test(p)) return "goldborder";
  if (/speed foxx/.test(p)) return "speedfoxx";
  if (/undercut|frameless/.test(p)) return "undercut";
  if (/abs/.test(p)) return "abs";
  if (/stainless/.test(p)) return "stainless";
  if (/painted steel|steel/.test(p)) return "steel";
  return "plain";
}

const COLOR_TH: Record<string, string> = { black: "ดำ", white: "ขาว", gray: "เทา", red: "แดง", blue: "น้ำเงิน", pink: "ชมพู", gold: "ทอง" };
const FAMILY_TH: Record<string, string> = {
  carbon: "ลายเคฟล่า", sincity: "ลาย Sin City", keepcalm: "ลาย Keep Calm", vip: "ลาย VIP", guitar: "ลายกีต้าร์",
  goldborder: "ลายเรียบดำ เส้นทอง", speedfoxx: "ลาย Speed Foxx", undercut: "กรอบไร้ขอบ", abs: "กรอบ ABS",
  stainless: "กรอบสแตนเลส", steel: "กรอบเหล็กพ่นดำ", tax: "กรอบป้ายภาษีอะคริลิคใส",
};

function labelOf(family: string, colors: string[], tag?: Tag): string {
  if (tag?.title) return tag.title.replace(/^ลาย\s*/, "ลาย");
  if (family === "plain") return `ลายเรียบ${COLOR_TH[colors[0]] ?? ""}`;
  return FAMILY_TH[family] ?? "กรอบป้ายทะเบียน";
}

// เฉพาะสินค้าที่ LINE ขาย: กรอบป้ายทะเบียน + กรอบป้ายภาษี (ไม่เอากันรอยประตู)
const SOLD_HERE = /license plate frame|tax disc/i;

export function toReviewPhotos(files: DriveFile[], tags: Record<string, Tag> = TAGS): ReviewPhoto[] {
  const out: ReviewPhoto[] = [];
  for (const f of files) {
    const [modelFolder = "", product = ""] = f.path;
    if (!SOLD_HERE.test(product)) continue;
    const tag = tags[f.name];
    if (tag?.skip) continue; // รูปไม่ชัด / ซ้ำ / มีคนในรูป
    const { model, brand } = splitModel(tag?.model ?? modelFolder);
    const variant = product.split(/\s+-\s+/).slice(1).join(" ") || product;
    const family = familyOf(product);
    const colors = COLOR_WORDS.filter(([re]) => re.test(variant)).map(([, c]) => c);
    out.push({ id: f.id, file: f.name, model, brand, family, colors, label: labelOf(family, colors, tag), size: tag?.size, bar: tag?.bar });
  }
  return out;
}

// ---------- ดึงรายชื่อรูปจาก Drive (ผ่าน Apps Script) + จำไว้ ----------
const CACHE_KEY = "reviews:v1";
const FRESH_MS = 30 * 60_000;
let memo: { at: number; files: DriveFile[] } | null = null;

// มีรายชื่อเก่า → รอ Drive แค่ 8 วิ ไม่ทันก็ใช้ของเก่า (Apps Script อ่านเสร็จแล้วจำไว้ให้ครั้งหน้าเร็ว) · ไม่มีเลย → รอได้ 25 วิ
export async function loadReviewFiles(state: StateStore, fetchList: (timeoutMs: number) => Promise<DriveFile[] | null> = fetchDriveList, now = Date.now()): Promise<DriveFile[]> {
  if (!memo) {
    const raw = await state.get(CACHE_KEY).catch(() => null);
    if (raw) {
      try {
        memo = JSON.parse(raw);
      } catch {
        memo = null;
      }
    }
  }
  if (memo && now - memo.at < FRESH_MS) return memo.files;
  const files = await fetchList(memo ? 8_000 : 25_000).catch(() => null);
  if (files?.length) {
    memo = { at: now, files };
    await state.set(CACHE_KEY, JSON.stringify(memo), 7 * 24 * 60 * 60).catch(() => {});
    return files;
  }
  return memo?.files ?? []; // Drive/Apps Script ล่ม → ใช้รายชื่อเก่าไปก่อน
}
export const _resetReviewMemo = () => {
  memo = null;
};

async function fetchDriveList(timeoutMs: number): Promise<DriveFile[] | null> {
  const data = await callOrderSheet<{ ok: boolean; files?: DriveFile[] }>({ action: "list_reviews", folder: REVIEW_FOLDER_ID }, "อ่านรายชื่อรูปรีวิว", { timeoutMs });
  return data?.files ?? null;
}

// ---------- อ่านคำถามลูกค้า ----------
const norm = (s: string) => s.toLowerCase().replace(/[\s\-_.]+/g, "");

// ชื่อเรียกรุ่นรถ (ไทย/อังกฤษ) → ชื่อโฟลเดอร์ · เรียงยาวไปสั้นตอนจับคู่ (yaris cross ก่อน yaris)
const MODEL_ALIASES: Record<string, string[]> = {
  "Toyota Fortuner": ["fortuner", "ฟอร์จูนเนอร์", "ฟอจูนเนอร์", "ฟอร์จูนเนอ", "ฟอจูน", "ฟอร์จูน"],
  "Toyota Corolla Altis": ["altis", "อัลติส", "อันติส", "corollaaltis", "โคโรล่าอัลติส"],
  "Toyota Corolla Cross": ["corollacross", "โคโรล่าครอส", "โคโลล่าครอส"],
  "Toyota Yaris Cross": ["yariscross", "ยาริสครอส"],
  "Toyota Yaris Ativ": ["yarisativ", "ativ", "เอทีฟ", "ยาริสเอทีฟ", "เอทิฟ"],
  "Toyota Yaris": ["yaris", "ยาริส"],
  "Toyota Vios": ["vios", "วีออส", "วีอ๊อส"],
  "Toyota Camry": ["camry", "แคมรี่", "คัมรี่"],
  "Toyota Hilux Revo": ["revo", "รีโว่", "รีโว้", "hiluxrevo"],
  "Toyota Hilux Vigo": ["vigo", "วีโก้", "hiluxvigo"],
  "Toyota Hiace": ["hiace", "ไฮเอซ", "คอมมิวเตอร์", "commuter"],
  "Toyota Sienta": ["sienta", "เซียนต้า"],
  "Toyota Veloz": ["veloz", "เวลอซ", "เวลอส"],
  "Toyota Avanza": ["avanza", "อแวนซ่า", "อาวานซ่า"],
  "Honda City": ["hondacity", "city", "ซิตี้", "ซิตี"],
  "Honda Civic": ["civic", "ซีวิค", "ซีวิก"],
  "Honda HR-V": ["hrv", "เอชอาร์วี"],
  "Honda Jazz": ["jazz", "แจ๊ส", "แจ๊ซ"],
  "Honda Accord": ["accord", "แอคคอร์ด", "แอคคอด"],
  "Honda WR-V": ["wrv", "ดับบลิวอาร์วี"],
  "Isuzu D-Max": ["dmax", "ดีแม็ก", "ดีแม็ค", "ดีแมก", "ดีแมค", "ดีแม็กซ์"],
  "Isuzu MU-X": ["mux", "มิวเอ็กซ์", "มิวx"],
  "Mitsubishi Triton": ["triton", "ไทรทัน", "ไททัน"],
  "Mitsubishi Pajero Sport": ["pajero", "ปาเจโร่", "ปาเจโร"],
  "Mitsubishi Xpander": ["xpander", "เอ็กซ์แพนเดอร์", "เอ็กแพนเดอร์"],
  "Mitsubishi Attrage": ["attrage", "แอททราจ", "แอททาจ", "แอทราจ"],
  "Mazda 2": ["mazda2", "มาสด้า2", "มาสด้าสอง"],
  "Mazda 3": ["mazda3", "มาสด้า3"],
  "Mazda BT-50": ["bt50", "บีที50"],
  "Ford Ranger": ["ranger", "เรนเจอร์"],
  "Ford Everest": ["everest", "เอเวอเรสต์", "เอเวอร์เรส"],
  "Nissan Almera": ["almera", "อัลเมร่า", "อัลมีร่า"],
  "Nissan X-Trail": ["xtrail", "เอ็กซ์เทรล"],
  "Suzuki Swift": ["swift", "สวิฟ", "สวิฟท์", "สวิฟต์"],
  "Chevrolet Colorado": ["colorado", "โคโลราโด"],
  "Chevrolet Cruze": ["cruze", "ครูซ"],
  "Chevrolet Sonic": ["sonic", "โซนิค"],
  "BYD Atto 3": ["atto3", "อัตโต้3", "อัตโต้"],
  "Geely EX5": ["ex5", "geely", "จีลี่"],
  "Jaecoo J5": ["jaecoo", "เจคู"],
  "Proton Exora": ["exora", "เอ็กซ์โซร่า"],
  "Tank 300": ["tank300", "แทงค์300", "แทงค์"],
};
const BRAND_ALIASES: Record<string, string[]> = {
  Toyota: ["toyota", "โตโยต้า"], Honda: ["honda", "ฮอนด้า"], Isuzu: ["isuzu", "อีซูซุ", "อิซูซุ"], Mitsubishi: ["mitsubishi", "มิตซู", "มิตซูบิชิ"],
  Mazda: ["mazda", "มาสด้า"], Ford: ["ford", "ฟอร์ด"], Nissan: ["nissan", "นิสสัน"], Suzuki: ["suzuki", "ซูซูกิ"], Chevrolet: ["chevrolet", "เชฟ", "เชฟโรเลต"],
  BYD: ["byd", "บีวายดี"], MG: ["mg", "เอ็มจี"], BMW: ["bmw", "บีเอ็ม"], Volvo: ["volvo", "วอลโว่"], ORA: ["ora", "โอร่า"], Hino: ["hino", "ฮีโน่"],
};

const ALIAS_LIST = Object.entries(MODEL_ALIASES)
  .flatMap(([model, names]) => names.map((n) => [norm(n), model] as const))
  .sort((a, b) => b[0].length - a[0].length);
const BRAND_LIST = Object.entries(BRAND_ALIASES)
  .flatMap(([brand, names]) => names.map((n) => [norm(n), brand] as const))
  .sort((a, b) => b[0].length - a[0].length);

export type ReviewQuery = { model?: string; brand?: string; family?: string; color?: string; bar?: "Y" | "N"; size?: "S" | "L" };

const INTENT = /รีวิว|review|รูปติด|ติดจริง|ภาพติด|ภาพจริง|รูปจริง|ตัวอย่าง|ขอดู|อยากดู|ดูรูป|มีรูป|ขอรูป/i;
const PHOTO_WORD = /รีวิว|review|รูป|ภาพ|ตัวอย่าง/i;
const PRICE_WORD = /ราคา|เท่าไหร่|เท่าไร|กี่บาท|ค่าส่ง|โปร/;

export function parseReviewQuery(text: string): ReviewQuery | null {
  if (!INTENT.test(text)) return null;
  if (PRICE_WORD.test(text) && !PHOTO_WORD.test(text)) return null; // "ขอดูราคา Fortuner" = ถามราคา ไม่ใช่ขอรีวิว
  const t = norm(text);
  const q: ReviewQuery = {};
  const model = ALIAS_LIST.find(([a]) => t.includes(a));
  // "city" ต้องไม่ใช่ "sin city"
  if (model && !(model[1] === "Honda City" && /sincity|ซินซิตี้/.test(t) && !/ฮอนด้าซิตี้|hondacity/.test(t))) q.model = model[1];
  if (!q.model) {
    const brand = BRAND_LIST.find(([a]) => t.includes(a));
    if (brand) q.brand = brand[1];
  }
  if (/เคฟล่า|เคฟลา|คาร์บอน|carbon/.test(t)) q.family = "carbon";
  else if (/sincity|ซินซิตี้|ซินซิตี/.test(t)) q.family = "sincity";
  else if (/keepcalm|คีพคาม|คีปคาม|คีพคาล์ม/.test(t)) q.family = "keepcalm";
  else if (/vip|วีไอพี/.test(t)) q.family = "vip";
  else if (/กีต้าร์|กีตาร์|guitar/.test(t)) q.family = "guitar";
  else if (/เส้นทอง|ขอบทอง/.test(t)) q.family = "goldborder";
  else if (/สแตนเลส|สแตนเลต|stainless/.test(t)) q.family = "stainless";
  else if (/เหล็ก|พ่นดำ|พ่นสี/.test(t)) q.family = "steel";
  else if (/ป้ายภาษี|พรบ|พ\.ร\.บ|ภาษี/.test(text)) q.family = "tax";
  else if (/ไร้ขอบ|undercut/.test(t)) q.family = "undercut";
  else if (/abs/.test(t)) q.family = "abs";
  else if (/เรียบ|สีพื้น/.test(t)) q.family = "plain";
  const color = /ดำ/.test(t) ? "black" : /ขาว/.test(t) ? "white" : /เทา/.test(t) ? "gray" : /แดง/.test(t) ? "red" : /น้ำเงิน|ฟ้า/.test(t) ? "blue" : /ชมพู/.test(t) ? "pink" : undefined;
  if (color && !(q.family === "steel" && color === "black")) q.color = color;
  if (color && !q.family) q.family = "plain";
  if (/ไม่มีเส้น/.test(t)) q.bar = "N";
  else if (/มีเส้น|เส้นคาด/.test(t)) q.bar = "Y";
  if (/ตัวสั้น|แบบสั้น|ขนาดสั้น|รุ่นสั้น|40ซม|40cm|40เซน/.test(t)) q.size = "S";
  else if (/ตัวยาว|แบบยาว|ขนาดยาว|รุ่นยาว|50ซม|50cm|50เซน/.test(t)) q.size = "L";
  // ต้องรู้อย่างน้อย 1 อย่างว่าอยากดูอะไร (ไม่งั้น "ขอดูราคา" ก็จะกลายเป็นรีวิว)
  if (!q.model && !q.brand && !q.family && !q.bar && !q.size && !/รีวิว|review/i.test(text)) return null;
  return q;
}

// ---------- เลือกรูป ----------
const matchers: [keyof ReviewQuery, (p: ReviewPhoto, q: ReviewQuery) => boolean][] = [
  ["size", (p, q) => p.size === q.size],
  ["bar", (p, q) => p.bar === q.bar],
  ["color", (p, q) => p.colors.includes(q.color!) && (p.family !== "plain" || p.colors[0] === q.color)],
  ["family", (p, q) => p.family === q.family || (q.family === "plain" && p.family === "goldborder" && q.color === "black")],
  ["model", (p, q) => p.model === q.model],
  ["brand", (p, q) => p.brand === q.brand],
];

const describe: Record<string, (q: ReviewQuery) => string> = {
  size: (q) => (q.size === "S" ? "ตัวสั้น" : "ตัวยาว"),
  bar: (q) => (q.bar === "Y" ? "มีเส้นคาดกลาง" : "ไม่มีเส้นคาดกลาง"),
  color: (q) => `สี${COLOR_TH[q.color!] ?? ""}`,
  family: (q) => (q.family === "plain" ? "ลายเรียบ" : FAMILY_TH[q.family!] ?? ""),
  model: (q) => q.model!,
  brand: (q) => q.brand!,
};

export type ReviewPick = { photos: ReviewPhoto[]; total: number; wanted: string; shown: string; relaxed: string[] };

// ตรงทุกข้อก่อน · ไม่เจอ → ผ่อนทีละข้อ (ขนาด → เส้นคาดกลาง → สี → ลาย) · รุ่นไม่มี → ยี่ห้อเดียวกัน → ทั้งหมด
export function pickReviews(all: ReviewPhoto[], q: ReviewQuery, limit = 10): ReviewPick {
  const active = matchers.filter(([k]) => q[k] !== undefined).map(([k]) => k);
  const wanted = active.map((k) => describe[k](q)).filter(Boolean).join(" · ");
  const order: (keyof ReviewQuery)[] = ["size", "bar", "color", "family"];
  let cur: ReviewQuery = { ...q };
  const relaxed: string[] = [];
  const run = (qq: ReviewQuery) => all.filter((p) => matchers.every(([k, fn]) => qq[k] === undefined || fn(p, qq)));
  let found = run(cur);
  // รุ่นรถสำคัญที่สุด → ผ่อนเรื่องลาย/ขนาดก่อน แล้วค่อยถอยไปยี่ห้อ
  for (const k of order) {
    if (found.length) break;
    if (cur[k] === undefined) continue;
    relaxed.push(describe[k](cur));
    cur = { ...cur, [k]: undefined };
    if (k === "family") cur.color = undefined;
    found = run(cur);
  }
  if (!found.length && cur.model) {
    relaxed.push(cur.model);
    const brand = cur.model.split(" ")[0];
    cur = { ...q, model: undefined, brand };
    found = run(cur);
    for (const k of order) {
      if (found.length) break;
      if (cur[k] === undefined) continue;
      cur = { ...cur, [k]: undefined };
      found = run(cur);
    }
  }
  if (!found.length && (cur.brand || cur.model)) {
    cur = { size: q.size, bar: q.bar, family: q.family, color: q.color };
    found = run(cur);
  }
  if (!found.length) {
    cur = {};
    found = all.filter((p) => p.family !== "tax");
  }
  // รูปที่รู้รุ่นรถก่อน · ลายสลับกันให้หลากหลาย
  const sorted = [...found].sort((a, b) => Number(!a.model) - Number(!b.model));
  const shownActive = matchers.filter(([k]) => cur[k] !== undefined).map(([k]) => describe[k](cur));
  return { photos: sorted.slice(0, limit), total: sorted.length, wanted, shown: shownActive.join(" · "), relaxed };
}

// ---------- ข้อความ + การ์ด ----------
const IMG_V = 1;
export const reviewImageUrl = (id: string) => `${baseUrl()}/api/img?id=${id}&v=r${IMG_V}`;

function chip(text: string) {
  return { type: "box", layout: "vertical", backgroundColor: "#2A2A2A", cornerRadius: "md", paddingAll: "4px", paddingStart: "8px", paddingEnd: "8px", flex: 0, contents: [{ type: "text", text, size: "xxs", color: CARD_THEME.title }] };
}

// ปุ่มใต้รูป: กดแล้วได้การ์ดสั่งซื้อของลายนี้เลย (ไม่ต้องไล่เลือกประเภทสินค้าใหม่)
function orderAction(p: ReviewPhoto) {
  if (!PRODUCT_OF[p.family]) return { type: "message", label: "🛒 สั่งซื้อ", text: MENU.order };
  const label = `🛒 สั่ง${p.family === "tax" ? "กรอบป้ายภาษี" : p.label.replace(/^กรอบ/, "")}`.slice(0, 40);
  return { type: "postback", label: "🛒 สั่งลายนี้", data: encodePostback({ k: "rv", f: p.family, ...(p.colors[0] ? { c: p.colors[0] } : {}) }), displayText: label };
}

function bubble(p: ReviewPhoto) {
  const t = CARD_THEME;
  const chips = [p.size === "S" ? "ตัวสั้น 40 ซม." : p.size === "L" ? "ตัวยาว 50 ซม." : null, p.bar === "Y" ? "มีเส้นคาดกลาง" : p.bar === "N" ? "ไม่มีเส้นคาดกลาง" : null].filter(Boolean) as string[];
  return {
    type: "bubble",
    size: "kilo",
    hero: { type: "image", url: reviewImageUrl(p.id), size: "full", aspectRatio: "1:1", aspectMode: "cover", action: { type: "uri", uri: reviewImageUrl(p.id) } },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      background: { type: "linearGradient", angle: "0deg", startColor: t.bgBottom, endColor: t.bgTop },
      contents: [
        { type: "text", text: p.label, weight: "bold", size: "md", color: t.title, wrap: true },
        { type: "text", text: p.model ?? (p.brand ? `${p.brand} (ไม่ระบุรุ่น)` : "รีวิวลูกค้า"), size: "xs", color: t.label, wrap: true },
        ...(chips.length ? [{ type: "box", layout: "horizontal", spacing: "sm", contents: chips.map(chip) }] : []),
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      backgroundColor: t.bgBottom,
      contents: [{ type: "button", style: "primary", color: t.accent, height: "sm", action: orderAction(p) }],
    },
  };
}

// ข้อความของจักร (21 พ.ย. 2026) — ต่อท้ายทุกครั้งที่ส่งรูปรีวิว
export const PRIVACY_NOTE = "🔒 ทางร้านใช้ระบบ AI เปลี่ยนเลขทะเบียนในรูปแล้ว เพื่อความปลอดภัยและความเป็นส่วนตัวของลูกค้าทุกท่านครับ";

export function reviewMessages(pick: ReviewPick) {
  const totalForQuery = pick.total;
  const n = pick.photos.length;
  const more = totalForQuery > n ? ` (จากทั้งหมด ${totalForQuery} รูป)` : "";
  let intro: string; // + PRIVACY_NOTE ต่อท้ายทุกครั้ง
  if (!pick.wanted) intro = `📸 รีวิวจากลูกค้าจริงครับ ${n} รูป${more}\nพิมพ์รุ่นรถมาได้เลย เช่น "รีวิว Fortuner" หรือ "ขอดูเรียบดำตัวสั้น" 😊`;
  else if (!pick.relaxed.length) intro = `📸 รีวิวจากลูกค้าจริง ${pick.wanted} — ${n} รูป${more} 😊`;
  else intro = `ยังไม่มีรูปรีวิว ${pick.wanted} ครับ 🙏\nส่งรูป${pick.shown ? ` ${pick.shown}` : "รีวิวอื่น"} ให้ดูก่อนนะครับ (${n} รูป)`;
  return [
    `${intro}\n\n${PRIVACY_NOTE}`,
    { type: "flex" as const, altText: `รูปรีวิว ${pick.shown || pick.wanted || "ลูกค้าจริง"}`, contents: { type: "carousel", contents: pick.photos.map(bubble) } },
  ];
}

// ---------- รูปรีวิว → การ์ดสั่งซื้อ ----------
// ลาย → สินค้าในชีท (ชื่อชุด "<สินค้า> ขั้น 1 ...")
const PRODUCT_OF: Record<string, string> = {
  plain: "อะคริลิค", carbon: "อะคริลิค", sincity: "อะคริลิค", keepcalm: "อะคริลิค", vip: "อะคริลิค", guitar: "อะคริลิค", goldborder: "อะคริลิค", speedfoxx: "อะคริลิค",
  steel: "เหล็กพ่นสี", stainless: "สแตนเลส", abs: "พลาสติก ABS", tax: "กรอบป้ายภาษี พรบ.", undercut: "ไร้ขอบ",
};
const FAMILY_WORDS: Record<string, RegExp> = {
  carbon: /เคฟล่า|เคฟลา|คาร์บอน|carbon/i, sincity: /sin\s*city|ซินซิตี้/i, keepcalm: /keep\s*calm|คีพคาม/i, vip: /vip|วีไอพี/i,
  guitar: /กีต้าร์|กีตาร์|guitar/i, goldborder: /ทอง/, speedfoxx: /speed|foxx/i,
};
const COLOR_RE: Record<string, RegExp> = { black: /ดำ/, white: /ขาว/, gray: /เทา/, red: /แดง/, blue: /น้ำเงิน|ฟ้า/, pink: /ชมพู/, gold: /ทอง/ };
const ANY_PATTERN = new RegExp(Object.values(FAMILY_WORDS).map((r) => r.source).join("|"), "i");

function matchItem(items: ImageItem[], family: string, color?: string): ImageItem | undefined {
  const text = (i: ImageItem) => `${i.name} ${i.detail ?? ""}`;
  let pool = family in FAMILY_WORDS ? items.filter((i) => FAMILY_WORDS[family].test(text(i))) : items.filter((i) => !ANY_PATTERN.test(i.name));
  if (color && pool.length > 1) {
    const byColor = pool.filter((i) => COLOR_RE[color]?.test(i.name));
    if (byColor.length) pool = byColor;
  } else if (color && family === "plain") {
    pool = pool.filter((i) => COLOR_RE[color]?.test(i.name));
  }
  return pool.length === 1 || (pool.length && family !== "plain") ? pool[0] : undefined;
}

// คืนชุดการ์ดที่ส่งให้ลูกค้ากดต่อ: ตรงลาย → การ์ดใบเดียว · หาไม่เจอ → ทั้งขั้นแรกของสินค้านั้น · ไม่รู้สินค้า → การ์ดเลือกประเภท
export function reviewOrderCard(sets: ImageSet[], family: string, color?: string): { set: ImageSet; exact: boolean } | null {
  const product = PRODUCT_OF[family];
  const category = sets.find((s) => s.name === CATEGORY_SET);
  if (!product) return category ? { set: category, exact: false } : null;
  const step1 = firstStepSet(sets, product);
  if (!step1) {
    // สินค้าที่ไม่มีขั้นตอน (เช่น ไร้ขอบ) → การ์ดใบนั้นจากชุดเลือกประเภท
    const item = category?.items.find((i) => i.name.includes(product));
    if (category && item) return { set: { ...category, items: [item] }, exact: true };
    return category ? { set: category, exact: false } : null;
  }
  const item = matchItem(step1.items, family, color);
  return item ? { set: { ...step1, items: [item] }, exact: true } : { set: step1, exact: false };
}
