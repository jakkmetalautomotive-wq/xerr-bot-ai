// ชุดรูปสินค้า → การ์ดปัดดูใน LINE (Flex carousel) พร้อมปุ่ม "เลือกแบบที่ N"
// รูปมาจากแท็บ "รูปสินค้า" ใน Google Sheet: ชุดรูป | ลำดับ | ชื่อแบบ | ราคา | ลิงก์รูป | รายละเอียด | ลิงก์คลิป, ราคาปกติ (ไม่บังคับ)
// ชุดที่ไม่ใส่ลิงก์รูปเลย = ตัวเลือกง่าย → ส่งเป็นปุ่มด่วน (quick reply) ใต้ข้อความ
// ยังไม่มีแท็บนี้ → ใช้ชุดตัวอย่างในโค้ด (รูปสีพื้นชั่วคราว)
import { parseCsv, expandSheetUrl } from "./sheet.ts";

export const IMAGE_TAB = "รูปสินค้า";
const CACHE_MS = 60_000;
const MAX_CARDS = 12; // LINE carousel ได้สูงสุด 12 ใบ

export type ImageItem = { order: number; name: string; price: string; image: string; detail: string; link?: string; normal?: string; variants?: ImageVariant[]; skip?: string };
// skip = เลือกแบบนี้แล้วข้ามชุดขั้นตอนที่ชื่อมีคำนี้ (เช่น คางหมู ไม่มีแบบแผ่นใส → ข้าม "แผ่นอะคริลิคใส")
// รูปแยกตามสิ่งที่ลูกค้าเลือกมาก่อน: ทุกคำใน when ต้องอยู่ในตัวเลือกก่อนหน้า (เช่น ["สีดำ"] หรือ ["สีขาว", "ขอบใหญ่"])
export type ImageVariant = { when: string[]; image: string };
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
// ชุดการ์ดรีวิว (ปุ่มเมนู ⭐) · ทุกแบบมีลิงก์ → ปุ่มเปิดหน้ารีวิว
export const REVIEW_SET = "รีวิวสินค้า";
const REVIEW_BUTTON = "⭐ ดูรีวิว";
// ชุดที่ทุกการ์ดเป็นลิงก์ออกไปข้างนอก (ไม่ใช่การเลือกแบบ)
const LINK_SETS = [INSTALL_SET, REVIEW_SET];

// ลิงก์ YouTube (watch / youtu.be / shorts) → ภาพปกคลิป
export function youtubeThumb(url: string): string {
  const id = url.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/)?.[1];
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : "";
}

// การ์ดวิธีติดตั้ง / รีวิว ↔ แถวในแท็บ "สินค้าและราคา" (คอลัมน์ รหัส)
// ลิงก์อ่านจากคอลัมน์ "คลิปวิธีติดตั้ง" / "ลิงก์รีวิว" ของแถวนั้น · ลิงก์สำรองด้านล่างใช้ตอนชีทไม่มีลิงก์ (ค่า ณ 29 ต.ค. 2026)
export const PRODUCT_TAB = "สินค้าและราคา";
export const CLIP_COLUMN = "คลิปวิธีติดตั้ง";
export const REVIEW_COLUMN = "ลิงก์รีวิว";
const PRODUCT_ROWS: { code: string; name: string; image: string; install: string; clip: string; review?: string }[] = [
  { code: "acrylic-ss", name: "อะคริลิค", image: "cat-acrylic.png", install: "ต้องลอกฟิล์มกันรอยสีน้ำตาลก่อนติดตั้ง", clip: "https://www.youtube.com/shorts/TAfBgMMPaLo", review: "https://canva.link/cm14wzc6vnbed6p" },
  { code: "stainless", name: "สแตนเลส", image: "cat-stainless.png", install: "ทั้งแบบมีและไม่มีแผ่นอะคริลิคใส", clip: "https://www.youtube.com/shorts/gPLZ3Q1U3cM", review: "https://canva.link/ve2f6ufpe1z3dx9" },
  { code: "steel", name: "เหล็กพ่นสี", image: "cat-steel.png", install: "ทั้งแบบมีและไม่มีแผ่นอะคริลิคใส", clip: "https://www.youtube.com/shorts/4T8q5ub69XM", review: "https://canva.link/pny4wokozswx4dq" },
  { code: "abs", name: "พลาสติก ABS", image: "cat-abs.png", install: "ใส่ไม่ลงให้กดไล่จากล่างขึ้นบน", clip: "https://www.youtube.com/shorts/YbnSyMiTUYE", review: "https://canva.link/2sz7a5wfwb41g3n" },
  { code: "borderless", name: "ไร้ขอบ", image: "cat-undercut.png", install: "กาว 3M เทปแดง ไม่ต้องตัดป้าย", clip: "https://www.youtube.com/shorts/9_rTKGa4n7U" },
  { code: "truck", name: "รถตู้/บรรทุก", image: "cat-truck.png", install: "ป้ายทะเบียน 30 · 45 × 24 ซม.", clip: "https://www.youtube.com/shorts/0ImfgQxLS_M", review: "https://canva.link/59ohj9ig99g7t1w" },
  { code: "tax-car", name: "ป้ายภาษี พรบ. รถยนต์", image: "cat-tax.png", install: "เทปกาวเหนียว ไม่ทิ้งคราบ", clip: "https://www.youtube.com/shorts/r7i0wnkWZmk" },
  { code: "tax-moto", name: "ป้ายภาษี พรบ. มอเตอร์ไซค์", image: "cat-tax.png", install: "ใช้ซ้ำได้ ลอกกาวเปลี่ยนใหม่", clip: "https://www.youtube.com/shorts/jlbwvEijfAQ" },
];

// แท็บสินค้าและราคา → { รหัส: ลิงก์ } ของคอลัมน์ที่ระบุ
export function parseLinkColumn(csv: string, column: string): Record<string, string> {
  const [header, ...rows] = parseCsv(csv);
  const code = header?.findIndex((h) => h.trim() === "รหัส") ?? -1;
  const col = header?.findIndex((h) => h.trim() === column) ?? -1;
  if (code < 0 || col < 0) return {};
  return Object.fromEntries(rows.map((r) => [r[code]?.trim(), r[col]?.trim()]).filter(([c, l]) => c && /^https:\/\//.test(l ?? "")));
}

// แถวที่ชีทไม่มีลิงก์ https → ใช้ลิงก์สำรอง
export function installSet(links: Record<string, string> = {}): ImageSet {
  return {
    name: INSTALL_SET,
    items: PRODUCT_ROWS.map((p, i) => {
      const link = links[p.code] ?? p.clip;
      return { order: i + 1, name: p.name, price: "", image: youtubeThumb(link), detail: p.install, link };
    }),
  };
}

// การ์ดรีวิว: เฉพาะรุ่นที่มีลิงก์รีวิว (ในชีทหรือลิงก์สำรอง) · รูป = รูปประเภทสินค้า
export function reviewSet(links: Record<string, string> = {}): ImageSet {
  const rows = PRODUCT_ROWS.map((p) => ({ ...p, link: links[p.code] ?? p.review })).filter((p) => p.link);
  return {
    name: REVIEW_SET,
    items: rows.map((p, i) => ({ order: i + 1, name: p.name, price: "", image: categoryPhoto(p.name) ?? `${baseUrl()}/samples/${p.image}`, detail: "รีวิวจากลูกค้าจริง", link: p.link! })),
  };
}

// ชุดตัวอย่าง (ใช้จนกว่าจะมีแท็บ "รูปสินค้า") — ข้อมูลตาม product-specs / price-promo-2026 ที่จักรยืนยัน 29 ต.ค. 2026
// ชุดที่ไม่มีรูปเลยสักแบบ = ตัวเลือกง่าย → ส่งเป็นปุ่มด่วนใต้ข้อความแทนการ์ด
export function sampleSets(): ImageSet[] {
  const img = (f: string) => `${baseUrl()}/samples/${f}`;
  const items = (rows: [name: string, price: string, image: string, detail: string, normal?: string][]): ImageItem[] =>
    rows.map(([name, price, image, detail, normal], i) => ({ order: i + 1, name, price, image: image && img(image), detail, ...(normal ? { normal } : {}) }));
  const acrylicPrice = "สั้น-สั้น 399.- / สั้น-ยาว, ยาว-ยาว 419.-";
  // ทรงคางหมูไม่มีแบบแผ่นอะคริลิคใส (จักรยืนยัน 29 ต.ค. 2026) → ราคาเดียว + ข้ามขั้นแผ่นใส
  const shapes = (detail: string, rectPrice: string, trapPrice: string) => items([
    ["สี่เหลี่ยมขอบใหญ่", rectPrice, "shape-rect-wide.png", `35.5 × 15.5 ซม. · ${detail}`],
    ["สี่เหลี่ยมขอบเล็ก", rectPrice, "shape-rect-thin.png", `35.5 × 15.5 ซม. · ${detail}`],
    ["คางหมู", trapPrice, "shape-trapezoid.png", `38.5 × 16.5 ซม. · ${detail} · ไม่มีแบบแผ่นใส`],
  ]).map((i) => (i.name === "คางหมู" ? { ...i, skip: "แผ่นอะคริลิคใส" } : i));
  // ตั้งชื่อชุดเป็น "สินค้า ขั้น N ..." → บอทส่งทีละขั้นตามลำดับ
  return [
    {
      name: CATEGORY_SET,
      items: items([
        // ราคาปกติตามแท็บสินค้าและราคา (ขีดฆ่าบนการ์ด) · จักรขอเอาแถวรายละเอียดออก 29 ต.ค. 2026
        ["อะคริลิค", "399.- / 419.-", "cat-acrylic.png", "", "550.-"],
        ["สแตนเลส", "279.- / 319.- (มีแผ่นใส)", "cat-stainless.png", "", "450.-"],
        ["เหล็กพ่นสี", "249.- / 299.- (มีแผ่นใส)", "cat-steel.png", "", "390.-"],
        ["พลาสติก ABS", "199.-", "cat-abs.png", "", "350.-"],
        ["ไร้ขอบ", "199.-", "cat-undercut.png", "", "250.-"],
        ["รถตู้/บรรทุก", "399.-", "cat-truck.png", "", "590.-"],
        ["กรอบป้ายภาษี พรบ.", "69.- / 129.-", "cat-tax.png", "", "99.- / 189.-"],
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
    { name: "สแตนเลส ขั้น 1 เลือกทรง", items: shapes("สแตนเลสเงา", "279.- / 319.- (มีแผ่นใส)", "279.-") },
    {
      name: "สแตนเลส ขั้น 2 เลือกแผ่นอะคริลิคใส",
      items: items([["ไม่มีแผ่นใส", "279.-", "", ""], ["มีแผ่นใส", "319.-", "", "แผ่นอะคริลิคใส กันฝน/ฝุ่น (กันน้ำไม่ 100%)"]]),
    },
    { name: "เหล็กพ่นสี ขั้น 1 เลือกสี", items: items([["สีขาว", "", "", ""], ["สีดำ", "", "", ""]]) },
    { name: "เหล็กพ่นสี ขั้น 2 เลือกทรง", items: shapes("เหล็กพ่นสี", "249.- / 299.- (มีแผ่นใส)", "249.-") },
    {
      name: "เหล็กพ่นสี ขั้น 3 เลือกแผ่นอะคริลิคใส",
      items: items([["ไม่มีแผ่นใส", "249.-", "", ""], ["มีแผ่นใส", "299.-", "", "แผ่นอะคริลิคใส กันฝน/ฝุ่น (กันน้ำไม่ 100%)"]]),
    },
    { name: "พลาสติก ABS ขั้น 1 เลือกสี", items: items([["สีขาว", "", "", ""], ["สีดำ", "", "", ""]]) },
    { name: "พลาสติก ABS ขั้น 2 เลือกเส้นคาดกลาง", items: items([["มีเส้นคาดกลาง", "", "", ""], ["ไม่มีเส้นคาดกลาง", "", "", ""]]) },
    { name: "รถตู้/บรรทุก ขั้น 1 เลือกวัสดุ", items: items([["สแตนเลส", "", "", ""], ["เหล็กพ่นสีขาว", "", "", ""], ["เหล็กพ่นสีดำ", "", "", ""]]) },
    { name: "กรอบป้ายภาษี พรบ. ขั้น 1 เลือกประเภทรถ", items: items([["รถยนต์", "69.-", "", "12 × 11 ซม."], ["มอเตอร์ไซค์", "129.-", "", "11.8 × 5.8 ซม."]]) },
    installSet(),
    reviewSet(),
  ].map(withRealPhotos);
}

// รูปสินค้าจริงจาก Google Drive โฟลเดอร์ "รูปบอท XERR" (บัญชี jakkxerr, แชร์ทุกคนที่มีลิงก์) · ผูกครบ 29 ต.ค. 2026 (ยกเว้นป้ายภาษี ยังไม่มีรูป)
// ค่า = id ไฟล์เดียว หรือ [[คำที่ต้องเลือกมาก่อน, id], ...] → รูปตามสี/ทรงที่ลูกค้าเลือก (แถวแรก = รูปตั้งต้น)
// แบบที่ไม่มีในตารางนี้ใช้ภาพประกอบเดิม
const byColour = (black: string, white: string): [string, string][] => [["สีดำ", black], ["สีขาว", white]];
// อะคริลิค: รูปตามสี + มี/ไร้เส้นขอบ ที่เลือกในขั้น 1 (ไฟล์ที่ไม่ระบุเส้นขอบใน Drive = มีเส้นขอบ)
const acrylic = (p: { black: string; blackNo: string; white: string; whiteNo: string; grey: string; greyNo: string; kevlar: string }): [string, string][] => [
  ["สีดำ มีเส้นขอบ", p.black], ["สีดำ ไร้เส้นขอบ", p.blackNo], ["สีขาว มีเส้นขอบ", p.white], ["สีขาว ไร้เส้นขอบ", p.whiteNo],
  ["สีเทา มีเส้นขอบ", p.grey], ["สีเทา ไร้เส้นขอบ", p.greyNo], ["เคฟล่า", p.kevlar],
];
const REAL_PHOTOS: Record<string, Record<string, string | [string, string][]>> = {
  [CATEGORY_SET]: {
    "อะคริลิค": "1ObHYDZaanBdC3UhtulEtHT41kmFgfrGh",
    "สแตนเลส": "1rQ41e0O9EniCzkn7p2AYAmZi1pcCz1Xg",
    "เหล็กพ่นสี": "1AeAPm3off9mlLeyX7tEQavwIXz1UZz_3",
    "พลาสติก ABS": "1IQTrmeUac5XSIFAetusDJah0hv9w13Mt",
    "ไร้ขอบ": "1XXIXmd7_CxwrLh8UiaPFcc5ZGFSNWxlq",
    "รถตู้/บรรทุก": "1eto3c7NCL1vlSSs2gFOEWj71MiF-hqGV",
  },
  "อะคริลิค ขั้น 1 เลือกสี": {
    "สีดำ มีเส้นขอบ": "1ObHYDZaanBdC3UhtulEtHT41kmFgfrGh",
    "สีดำ ไร้เส้นขอบ": "1f-jaB0clYwpcbD0cHq0jo-C4WRWUyzYS",
    "สีขาว มีเส้นขอบ": "1Bk9tNOmRx0WlxdyIHuywAYgKKnGYuFAr",
    "สีขาว ไร้เส้นขอบ": "1Bc_jT1pwapeYlJnifEfiI_jctIt1hu8w",
    "สีเทา มีเส้นขอบ": "1n0xoAFjp5HDd8t_bJ59ZDZieHgcBFCyT",
    "สีเทา ไร้เส้นขอบ": "14RPn5ODPEMbqh0Mbqaqz-V6yuYWH-pFn",
    "ลายเคฟล่า ดำ มีเส้นขอบ": "15UyD2nLQugAuI4-F8Ezdkz3YpnrfbwRe",
  },
  "อะคริลิค ขั้น 2 เลือกขนาด": {
    "สั้น-สั้น": acrylic({
      black: "1FlW6iibbam4RdKeJG0TUB3afz2ghnLnq", blackNo: "1mWrtE62y7tdMG8WErkXH7uwCGxZcHpVl", white: "127L_zbSGsLxSyn9cqXK5G6mA6y78blV7", whiteNo: "1x_OO49-VXTB_R9b4MfhKWVZujInAV53W",
      grey: "1LRc1yj2Q_bgUm1qsqwf9FWuSBU8V_SpL", greyNo: "1enKtjEX68h-Qb1lzo08RSf2hE2EJKO9k", kevlar: "1EvnP_5z-CX7w7BdNBm3F3Xpl4c3NFzVY",
    }),
    "สั้น-ยาว": acrylic({
      black: "1kDIlMmdNoPmZnYLlzMXirxntVlZDSYU-", blackNo: "1gFuPHekCbWgO_QByIgMgXp0Ely3FWL01", white: "1EiF--8BRR_41iaAYS9XuJXyFRVMDTXz2", whiteNo: "1CJ6dXRluUnO9NirTEFbcwAOAErO5AfQF",
      grey: "1BtRbn3P39BJrXeGwoxK2bICNODa-umJR", greyNo: "1ynSs_Ou_VIJG9B7IPCaGgst5tsHPvzQP", kevlar: "17jNY6cKQtBJBgaCV610H9-oxVBvsqPLx",
    }),
    "ยาว-ยาว": acrylic({
      black: "1zACDwk5KM6adU38sC-ox4aHiKDPxhfGQ", blackNo: "1tl6gvmJEqlV0Bai-bJSfpMJS8h4sqdBY", white: "1hy27d_Z0-yPcosQqNQ-3VMCXSXkPpN5r", whiteNo: "1Sd-YYoJxTtYzSU25-8V8p7Uxp7l-fECv",
      grey: "1xa-8_-G_VeOUoa35pkOgfXbWhz4-FFfU", greyNo: "1CfWNC6D4Ut5nYSIUakJXXgsPFjDm8jOI", kevlar: "10tdDU2byg_VYzM3Wc1C-A6u_UF24ReAt",
    }),
  },
  "อะคริลิค ขั้น 3 เลือกเส้นคาดกลาง": {
    "มีเส้นคาดกลาง": acrylic({
      black: "1tKfPrhPhwUBbo60kaIImSsCzMUoid1EP", blackNo: "1_4nnP3o97N6mVoZrklUZuu9Q24uL5AaA", white: "1WO5Js6IoyOqgasdzlgkrk86eienEobWg", whiteNo: "1ORK9I7P2cVTKm92lh_kjPFt0mh6Cv0sP",
      grey: "1_00_lctue9apYqp-r2b0XhFteL6Rcssq", greyNo: "19Uxy0BPvp1sP9xqDFKAWdjGx6py-nJlW", kevlar: "1gP84LSaYFk1j5MzDAHe2WteWU_FvtE0B",
    }),
    "ไม่มีเส้นคาดกลาง": acrylic({
      black: "14lsmzpjO2vJR21NLZly11zArLaqwcU6s", blackNo: "13Rg89Gks42-HJbUwm2yzaXugMmehis_c", white: "123bQxpKGcnG_lisZ_LRRWcGb2X-E36RC", whiteNo: "1CqCAdaXC5GpIqWyKqtrT49joR0_EjDVu",
      grey: "1CAUUx62YVu0mXKORhoFWZoXXPAXOm1ky", greyNo: "1eK8f5P7tlmHG-T7TRsaez8j_EjvJzkTe", kevlar: "1MUgrrN9Y2ZZToufBJmYEVgN-HjhB6Ols",
    }),
  },
  "สแตนเลส ขั้น 1 เลือกทรง": {
    "สี่เหลี่ยมขอบใหญ่": "1rQ41e0O9EniCzkn7p2AYAmZi1pcCz1Xg",
    "สี่เหลี่ยมขอบเล็ก": "1kJz6WBKwBsgpl9HWVEl8ensMB-0XizEv",
    "คางหมู": "1Dxut1P_EMEwJIIWtUjPbkjnxEm0tmgLm",
  },
  // แผ่นใส: รูปตามทรงที่เลือก (คางหมูข้ามขั้นนี้)
  "สแตนเลส ขั้น 2 เลือกแผ่นอะคริลิคใส": {
    "ไม่มีแผ่นใส": [["ขอบใหญ่", "1rQ41e0O9EniCzkn7p2AYAmZi1pcCz1Xg"], ["ขอบเล็ก", "1kJz6WBKwBsgpl9HWVEl8ensMB-0XizEv"]],
    "มีแผ่นใส": [["ขอบใหญ่", "1t4rCcYqTKZPBvlbm2pd6Y_282JFjfXmJ"], ["ขอบเล็ก", "14P4dzfORCZ7xLlurVe6YqSX9vpC23Nlq"]],
  },
  "เหล็กพ่นสี ขั้น 1 เลือกสี": {
    "สีขาว": "1Ss0Mac7UoHx4yqyI__0YMt7kbNWGSnfC",
    "สีดำ": "1AeAPm3off9mlLeyX7tEQavwIXz1UZz_3",
  },
  "เหล็กพ่นสี ขั้น 2 เลือกทรง": {
    "สี่เหลี่ยมขอบใหญ่": byColour("1AeAPm3off9mlLeyX7tEQavwIXz1UZz_3", "1Ss0Mac7UoHx4yqyI__0YMt7kbNWGSnfC"),
    "สี่เหลี่ยมขอบเล็ก": byColour("1Zo4IumCta4roBlPaYCk4krDL9JYP_wK6", "196cXacCJij58PqYjj3XoAnIDfrdTLnu-"),
    "คางหมู": byColour("1ijc9sG_NOLJ_ULR8o_RgSOCI4FlT61GY", "1Gr9ZSAK6JFVv48adlR6baQtc-6ndo3Re"),
  },
  // แผ่นใส: รูปตามสี + ทรงที่เลือก (คางหมูข้ามขั้นนี้)
  "เหล็กพ่นสี ขั้น 3 เลือกแผ่นอะคริลิคใส": {
    "ไม่มีแผ่นใส": [
      ["สีดำ ขอบใหญ่", "1AeAPm3off9mlLeyX7tEQavwIXz1UZz_3"], ["สีดำ ขอบเล็ก", "1Zo4IumCta4roBlPaYCk4krDL9JYP_wK6"],
      ["สีขาว ขอบใหญ่", "1Ss0Mac7UoHx4yqyI__0YMt7kbNWGSnfC"], ["สีขาว ขอบเล็ก", "196cXacCJij58PqYjj3XoAnIDfrdTLnu-"],
    ],
    "มีแผ่นใส": [
      ["สีดำ ขอบใหญ่", "12fQ9pF7SjQTFXmypl2D63XePq_lrugJB"], ["สีดำ ขอบเล็ก", "1ED9n3nd3Pi_0pf_5iKqeYWhAhZWFljhF"],
      ["สีขาว ขอบใหญ่", "1BalvjndYIKOmweM-5eX3Lhbpm4wSrImx"], ["สีขาว ขอบเล็ก", "1P3Pm2lOF1Zg1AR_qblbP8AtxdVP11GuA"],
    ],
  },
  "พลาสติก ABS ขั้น 1 เลือกสี": {
    "สีขาว": "1DoQsB0sDeeTXc2DCjeM_BL96UNaIiqXW",
    "สีดำ": "1IQTrmeUac5XSIFAetusDJah0hv9w13Mt",
  },
  "พลาสติก ABS ขั้น 2 เลือกเส้นคาดกลาง": {
    "มีเส้นคาดกลาง": byColour("1aE8y5H8FXb0RJA0ocKlYTxk_Lq9FnCVC", "1aVGAOaxN8IvVIraLfLTLN6JmaDiyrFqU"),
    "ไม่มีเส้นคาดกลาง": byColour("1IQTrmeUac5XSIFAetusDJah0hv9w13Mt", "1DoQsB0sDeeTXc2DCjeM_BL96UNaIiqXW"),
  },
  "รถตู้/บรรทุก ขั้น 1 เลือกวัสดุ": {
    "สแตนเลส": "1eto3c7NCL1vlSSs2gFOEWj71MiF-hqGV",
    "เหล็กพ่นสีขาว": "1xXsTxw3Bz4CVzuVnRqiBuEcvbEO90sdS",
    "เหล็กพ่นสีดำ": "1h3lstNm8Xub3SgdK2BNuOAE6dU3a6B0C",
  },
};

// การ์ดรีวิวใช้รูปเดียวกับการ์ดประเภทสินค้า
export const categoryPhoto = (name: string): string | undefined => {
  const id = REAL_PHOTOS[CATEGORY_SET][name];
  return typeof id === "string" ? driveLink(id) : undefined;
};

const driveLink = (id: string) => `https://drive.google.com/file/d/${id}/view`;

function withRealPhotos(set: ImageSet): ImageSet {
  const photos = REAL_PHOTOS[set.name];
  if (!photos) return set;
  return {
    ...set,
    items: set.items.map((item) => {
      const p = photos[item.name];
      if (!p) return item;
      if (typeof p === "string") return { ...item, image: driveLink(p) };
      return { ...item, image: driveLink(p[0][1]), variants: p.map(([when, id]) => ({ when: when.split(" "), image: driveLink(id) })) };
    }),
  };
}

// รูปที่จะใช้บนการ์ด: variant แรกที่ทุกคำใน when อยู่ในตัวเลือกก่อนหน้า · ไม่ตรงเลย = รูปตั้งต้น
export function imageFor(item: ImageItem, picked: string[] = []): string {
  const all = picked.join(" ");
  return item.variants?.find((v) => v.when.every((w) => all.includes(w)))?.image ?? item.image;
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
    .map((i) => i.skip ?? i.detail.match(/ข้ามขั้น\s*([^)·,|]+)/)?.[1].trim())
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
  const c = { set: col("ชุดรูป"), order: col("ลำดับ"), name: col("ชื่อแบบ"), price: col("ราคา"), image: col("ลิงก์รูป"), detail: col("รายละเอียด"), link: col("ลิงก์คลิป"), normal: col("ราคาปกติ") };
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
      ...(c.normal >= 0 && r[c.normal]?.trim() ? { normal: r[c.normal].trim() } : {}),
    });
    sets.set(set, items);
  }
  return [...sets].map(([name, items]) => ({ name, items: items.sort((a, b) => a.order - b.order).slice(0, MAX_CARDS) }));
}

let cache: { sets: ImageSet[]; at: number } | null = null;

export async function getImageSets(now = Date.now()): Promise<ImageSet[]> {
  if (cache && now - cache.at < CACHE_MS) return cache.sets;
  let sets: ImageSet[] = [];
  let productCsv = "";
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
    let imageCsv: string;
    [imageCsv, productCsv] = await Promise.all([read(imageUrl, "แท็บรูป"), read(productUrl, "ลิงก์คลิป/รีวิว")]);
    sets = parseImageSets(imageCsv);
  }
  // ชุดวิธีติดตั้ง / รีวิว: แท็บรูปไม่ได้ตั้งเอง → ใช้ชุดในโค้ด + ลิงก์จากแท็บสินค้าและราคา
  const custom = new Set(sets.map((s) => s.name));
  if (!sets.length) sets = sampleSets();
  const linkSets = [
    installSet(parseLinkColumn(productCsv, CLIP_COLUMN)),
    reviewSet(parseLinkColumn(productCsv, REVIEW_COLUMN)),
  ].filter((s) => !custom.has(s.name));
  sets = [...sets.filter((s) => !linkSets.some((l) => l.name === s.name)), ...linkSets];
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

// โทนการ์ดตาม Brand.md: ดำ #111111 · ขาว · ส้ม #FF6A00 (ปุ่ม/ไฮไลต์) — พื้นไล่เฉดดำ + แถบส้มบางแบบเส้นรถแข่ง
export const CARD_THEME = {
  bgTop: "#1C1C1C",
  bgBottom: "#0A0A0A",
  accent: "#FF6A00",
  title: "#FFFFFF",
  muted: "#9A9A9A",
  label: "#FF8A3D",
};

// แถว 1: "แบบที่ N" + ชื่อสินค้า บรรทัดเดียวกัน (ขนาดเดิมของแต่ละส่วน)
function titleLine(item: ImageItem) {
  const t = CARD_THEME;
  return {
    type: "text",
    wrap: true,
    margin: "md",
    contents: [
      { type: "span", text: `แบบที่ ${item.order}  `, size: "xs", color: t.label, weight: "bold" },
      { type: "span", text: item.name, size: "xl", color: t.title, weight: "bold" },
    ],
  };
}

// แถว 3: ราคาขาย ส้มตัวใหญ่ · หมายเหตุในวงเล็บท้ายราคา เช่น "(มีแผ่นใส)" ตัวเล็กลง จะได้ไม่ตัดบรรทัดกลางคำ
function priceLine(price: string) {
  const t = CARD_THEME;
  const [, main, note] = price.match(/^(.*?)\s*(\([^()]*\))$/) ?? [, price, ""];
  return {
    type: "text",
    wrap: true,
    contents: [
      { type: "span", text: main, size: "xxl", color: t.accent, weight: "bold" },
      ...(note ? [{ type: "span", text: ` ${note}`, size: "sm", color: t.accent }] : []),
    ],
  };
}

// แถว 2: "ราคาปกติ" + ตัวเลขขีดฆ่า
function normalLine(normal: string) {
  const t = CARD_THEME;
  return {
    type: "text",
    wrap: true,
    contents: [
      { type: "span", text: "ราคาปกติ ", size: "sm", color: t.muted },
      { type: "span", text: normal, size: "sm", color: t.muted, decoration: "line-through" },
    ],
  };
}

export function buildCarousel(set: ImageSet, picked: string[] = []): FlexOut {
  const t = CARD_THEME;
  const bubbles = set.items.map((item) => ({
    type: "bubble",
    size: "kilo",
    styles: { hero: { backgroundColor: t.bgBottom }, body: { backgroundColor: t.bgTop }, footer: { backgroundColor: t.bgBottom } },
    ...(item.image ? { hero: { type: "image", url: lineImageUrl(imageFor(item, picked)), size: "full", aspectRatio: "1:1", aspectMode: "cover" } } : {}), // รูปจริงส่วนใหญ่สี่เหลี่ยมจัตุรัส → ไม่ตัดหัวป้าย
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingTop: "lg",
      background: { type: "linearGradient", angle: "0deg", startColor: t.bgBottom, endColor: t.bgTop },
      contents: [
        { type: "box", layout: "vertical", contents: [], width: "36px", height: "3px", backgroundColor: t.accent, cornerRadius: "2px" },
        // แถว: แบบที่ N + ชื่อ → ราคาปกติ (ขีดฆ่า) → ราคาขาย (ส้ม ตัวใหญ่) → รายละเอียด
        titleLine(item),
        ...(item.normal ? [normalLine(item.normal)] : []),
        ...(item.price ? [priceLine(item.price)] : []),
        ...(item.detail ? [{ type: "text", text: item.detail, size: "sm", color: t.muted, wrap: true }] : []),
      ],
    },
    // ชุดลิงก์ (วิธีติดตั้ง / รีวิว): แบบที่ไม่มีลิงก์ อ่านรายละเอียดบนการ์ดได้เลย ไม่ต้องมีปุ่ม
    ...(item.link || !LINK_SETS.includes(set.name)
      ? {
          footer: {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "button",
                style: "primary",
                color: t.accent,
                height: "sm",
                action: item.link
                  ? { type: "uri", label: set.name === REVIEW_SET ? REVIEW_BUTTON : INSTALL_BUTTON, uri: item.link }
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
