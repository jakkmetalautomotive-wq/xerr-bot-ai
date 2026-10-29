// เช็คสุขภาพบอท: /api/health (เช็ค Sheet — เปิดสาธารณะ ไม่กินโควตา)
// /api/health?gemini=1&key=HEALTH_KEY (เช็ค Gemini — ต้องมี key · จำผลไว้ 60 วิ กันกดรัว · &full=1 ถามจริงด้วย FAQ เต็ม)
// ไม่แสดงคีย์ใด ๆ — แสดงแค่ผ่าน/ไม่ผ่าน + ข้อความ error
import { GoogleGenAI } from "@google/genai";
import { getFaq, sheetUrls } from "@/lib/sheet.ts";
import { MODEL, THINKING, askGemini } from "@/lib/gemini.ts";
import { bangkokClock } from "@/lib/shop.ts";
import { getImageSets } from "@/lib/images.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let geminiCache: { at: number; model: string; result: unknown } | null = null;
export const maxDuration = 30;

const errMsg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 500);

export async function GET(req: Request) {
  const out: Record<string, unknown> = { model: MODEL, sheetUrlCount: sheetUrls().length };

  try {
    const faq = await getFaq();
    out.sheet = { ok: true, lines: faq.split("\n").filter(Boolean).length };
  } catch (e) {
    out.sheet = { ok: false, error: errMsg(e) };
  }

  // ชุดการ์ดรูป (จากแท็บ "รูปสินค้า" หรือชุดตัวอย่าง)
  out.imageSets = (await getImageSets()).map((s) => ({ name: s.name, cards: s.items.length, sample: s.items[0]?.image.includes("/samples/") }));

  const params = new URL(req.url).searchParams;
  // เช็ค Gemini กินโควตาคีย์ → ต้องตั้ง HEALTH_KEY ใน Vercel แล้วแนบ ?key=... ให้ตรง (ไม่ตั้ง = ปิดไว้)
  const healthKey = process.env.HEALTH_KEY ?? "";
  const keyOk = healthKey.length >= 8 && params.get("key") === healthKey;
  if (params.get("gemini") === "1" && !keyOk) {
    out.gemini = { ok: null, note: healthKey ? "ต้องแนบ key ให้ถูกต้อง" : "ปิดอยู่ (ตั้ง HEALTH_KEY ใน Vercel เพื่อเปิด)" };
  } else if (params.get("gemini") === "1") {
    // ?model=gemini-xxx ไว้ลองรุ่นอื่น (รับเฉพาะชื่อที่ขึ้นต้นด้วย gemini-)
    const model = /^gemini-[a-z0-9.-]+$/.test(params.get("model") ?? "") ? params.get("model")! : MODEL;
    out.model = model;
    const key = `${model}|${params.get("full") ?? ""}|${params.get("q") ?? ""}`;
    if (geminiCache && geminiCache.model === key && Date.now() - geminiCache.at < 60_000) out.gemini = geminiCache.result;
    else {
      let result: unknown;
      const t0 = Date.now();
      try {
        if (params.get("full") === "1") {
          // ถามจริงด้วย FAQ + prompt เต็ม เหมือนลูกค้าทัก
          const sets = (await getImageSets()).map((s) => s.name);
          const q = params.get("q")?.slice(0, 200) || "กรอบป้าย ABS ราคาเท่าไหร่ครับ";
          const answer = await askGemini(await getFaq(), [], q, bangkokClock().label, { model, imageSets: sets });
          result = { ok: true, ms: Date.now() - t0, thinking: THINKING, answer };
        } else {
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          const res = await ai.models.generateContent({
            model,
            contents: "ตอบคำว่า OK คำเดียว",
            config: { temperature: 1.0, maxOutputTokens: 1024, thinkingConfig: { thinkingLevel: THINKING }, httpOptions: { timeout: 25_000 } },
          });
          result = { ok: true, ms: Date.now() - t0, finishReason: res.candidates?.[0]?.finishReason, text: res.text?.slice(0, 50) };
        }
      } catch (e) {
        result = { ok: false, ms: Date.now() - t0, error: errMsg(e) };
      }
      geminiCache = { at: Date.now(), model: key, result };
      out.gemini = result;
    }
  }

  return Response.json(out);
}
