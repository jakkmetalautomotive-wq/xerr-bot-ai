// เช็คสุขภาพบอท: /api/health (เช็ค Sheet) · /api/health?gemini=1 (เช็ค Gemini ด้วย — จำผลไว้ 60 วิ กันกดรัว)
// ไม่แสดงคีย์ใด ๆ — แสดงแค่ผ่าน/ไม่ผ่าน + ข้อความ error
import { GoogleGenAI } from "@google/genai";
import { getFaq, sheetUrls } from "@/lib/sheet.ts";
import { MODEL } from "@/lib/gemini.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let geminiCache: { at: number; result: unknown } | null = null;

const errMsg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 500);

export async function GET(req: Request) {
  const out: Record<string, unknown> = { model: MODEL, sheetUrlCount: sheetUrls().length };

  try {
    const faq = await getFaq();
    out.sheet = { ok: true, lines: faq.split("\n").filter(Boolean).length };
  } catch (e) {
    out.sheet = { ok: false, error: errMsg(e) };
  }

  if (new URL(req.url).searchParams.get("gemini") === "1") {
    if (geminiCache && Date.now() - geminiCache.at < 60_000) out.gemini = geminiCache.result;
    else {
      let result: unknown;
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const res = await ai.models.generateContent({
          model: MODEL,
          contents: "ตอบคำว่า OK คำเดียว",
          config: { temperature: 1.0, maxOutputTokens: 1024, httpOptions: { timeout: 15_000 } },
        });
        result = { ok: true, finishReason: res.candidates?.[0]?.finishReason, text: res.text?.slice(0, 50) };
      } catch (e) {
        result = { ok: false, error: errMsg(e) };
      }
      geminiCache = { at: Date.now(), result };
      out.gemini = result;
    }
  }

  return Response.json(out);
}
