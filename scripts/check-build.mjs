// ตรวจโค้ดที่ build แล้ว: อีโมจิต้องไม่ถูกเก็บเป็น "\\uD83C\\uDF89" (ตัวย่อโค้ดของ Next/SWC ทำพังได้ตอนรวมข้อความเป็น template)
// ถ้าเจอ ลูกค้าจะเห็นเป็นตัวหนังสือแทนอีโมจิ → ให้ build ล้ม ไม่ deploy เวอร์ชันพัง (เจอจริง 30 ต.ค. 2026 ที่ปุ่มโปรโมชั่น)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const BROKEN = /\\\\u[dD][89abAB][0-9a-fA-F]{2}/; // ทับขวาสองตัวตามด้วย surrogate ของอีโมจิ
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".js")) files.push(p);
  }
};
walk(".next/server");

const bad = [];
for (const f of files) {
  const text = readFileSync(f, "utf8");
  const m = text.match(BROKEN);
  if (m) bad.push(`${f}: …${text.slice(Math.max(0, m.index - 40), m.index + 20).replace(/\s+/g, " ")}…`);
}
if (bad.length) {
  console.error("❌ เจออีโมจิที่ถูกเก็บเป็นรหัส (ลูกค้าจะเห็นเป็น \\uD83D...):\n" + bad.join("\n"));
  process.exit(1);
}
console.log(`✓ check-build: อีโมจิปกติ (${files.length} ไฟล์)`);
