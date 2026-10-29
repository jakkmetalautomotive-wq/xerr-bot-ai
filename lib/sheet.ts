// ดึง FAQ จาก Google Sheet (ลิงก์ CSV แบบ "เผยแพร่ทางเว็บ") แล้วเก็บไว้ในหน่วยความจำ 60 วินาที
// SHEET_CSV_URL ใส่ได้หลายลิงก์ คั่นด้วย comma (เช่น แท็บ Q&A + แท็บสินค้าและราคา)

const CACHE_MS = 60_000;
const FETCH_TIMEOUT_MS = 4_000;

let cache: { text: string; at: number } | null = null;

export function sheetUrls(raw = process.env.SHEET_CSV_URL ?? ""): string[] {
  return raw
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
}

// แปลง CSV เป็นแถว (รองรับช่องที่มี comma / ขึ้นบรรทัดใหม่ / เครื่องหมายคำพูด)
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// ทำให้ AI อ่านง่าย: แถวละบรรทัด "หัวคอลัมน์: ค่า | ..." ตัดช่องว่างทิ้ง
export function csvToFaqText(csv: string): string {
  const [header, ...rows] = parseCsv(csv);
  if (!header) return "";
  return rows
    .map((r) =>
      header
        .map((h, i) => (r[i]?.trim() ? `${h.trim()}: ${r[i].trim()}` : ""))
        .filter(Boolean)
        .join(" | "),
    )
    .join("\n");
}

async function fetchCsv(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`ดึง Sheet ไม่ได้ (${res.status}) ${url}`);
  const text = await res.text();
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error(`ลิงก์ไม่ใช่ CSV (ได้หน้าเว็บกลับมา — ต้องเผยแพร่เป็น CSV) ${url}`);
  return text;
}

// คืนข้อความ FAQ ทั้งหมด · ถ้าดึงไม่ได้แต่เคยมีของเก่า ใช้ของเก่าไปก่อน
export async function getFaq(now = Date.now()): Promise<string> {
  if (cache && now - cache.at < CACHE_MS) return cache.text;
  const urls = sheetUrls();
  if (!urls.length) throw new Error("ยังไม่ได้ตั้ง SHEET_CSV_URL");
  try {
    const parts = await Promise.all(urls.map(fetchCsv));
    const text = parts.map(csvToFaqText).filter(Boolean).join("\n\n");
    if (!text) throw new Error("Sheet ว่าง");
    cache = { text, at: now };
    return text;
  } catch (err) {
    if (cache) {
      console.warn("[sheet] ใช้ FAQ ชุดเก่าแทน:", (err as Error).message);
      return cache.text;
    }
    throw err;
  }
}

export function _resetSheetCache() {
  cache = null;
}
