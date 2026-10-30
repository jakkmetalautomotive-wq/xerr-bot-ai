// เรียก Gemini ตอบลูกค้า
import { GoogleGenAI, FinishReason, ThinkingLevel, Type, type Content } from "@google/genai";
import { buildSystemPrompt, wrapQuestion } from "./prompt.ts";
import { DEFAULT_REPLY } from "./shop.ts";

export const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
// รุ่นสำรอง (ใส่หลายรุ่นคั่นด้วย comma ได้ ลองตามลำดับ): ใช้ตอนรุ่นหลักล่ม (503/504) หรือโควตาเต็ม (429)
// แผนฟรีจำกัดวันละ 20 ครั้ง "ต่อรุ่น" → ใส่หลายรุ่น = ได้หลายเท่า · ตั้งด้วย GEMINI_FALLBACK_MODEL ("off" = ไม่ใช้)
export const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL === "off" ? "" : process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash";
// รุ่นที่เพิ่งเจอโควตาเต็ม → ข้ามไปก่อน ไม่เปลืองเวลา/โควตาลองซ้ำ (จำในเครื่อง serverless ที่ยังอุ่นอยู่)
const QUOTA_COOLDOWN_MS = 10 * 60_000;
const exhaustedUntil = new Map<string, number>();
export const _resetQuotaMemory = () => exhaustedUntil.clear();
const isQuota = (message: string) => /\b429\b|RESOURCE_EXHAUSTED|exceeded your current quota/i.test(message);
const TIMEOUT_MS = 15_000; // ต่อครั้ง · webhook ตอบ LINE ทันทีแล้ว (waitUntil) ถ้า reply token หมดอายุจะส่งแบบ push แทน
const BUDGET_MS = 48_000; // รวมทุกครั้งที่ลอง ต้องจบก่อน maxDuration ของ webhook (60 วิ)
// ระดับการคิด: LOW เร็วพอสำหรับตอบแชท (เปลี่ยนได้ด้วย GEMINI_THINKING = MINIMAL / LOW / MEDIUM / HIGH)
export const THINKING = (Object.values(ThinkingLevel) as string[]).includes(process.env.GEMINI_THINKING ?? "") ? (process.env.GEMINI_THINKING as ThinkingLevel) : ThinkingLevel.LOW;

export type BotAnswer = { reply: string; needsAdmin: boolean; adminNote: string; showSet?: string };

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING },
    needs_admin: { type: Type.BOOLEAN },
    admin_note: { type: Type.STRING },
    show_set: { type: Type.STRING },
  },
  required: ["reply", "needs_admin", "admin_note", "show_set"],
};

type GenerateFn = (params: Parameters<GoogleGenAI["models"]["generateContent"]>[0]) => ReturnType<GoogleGenAI["models"]["generateContent"]>;

let client: GoogleGenAI | null = null;
function defaultGenerate(): GenerateFn {
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return (params) => client!.models.generateContent(params);
}

// history: ข้อความก่อนหน้าของลูกค้าคนนี้ (user/model สลับกัน) · question: ข้อความล่าสุด
export async function askGemini(
  faq: string,
  history: Content[],
  question: string,
  clockLabel: string,
  {
    generate = defaultGenerate(),
    model = MODEL,
    fallbackModel = FALLBACK_MODEL,
    imageSets = [],
    wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  }: { generate?: GenerateFn; model?: string; fallbackModel?: string; imageSets?: string[]; wait?: (ms: number) => Promise<void> } = {},
): Promise<BotAnswer> {
  const t0 = Date.now();
  const call = (m: string) => generate({
    model: m,
    contents: [...history, { role: "user", parts: [{ text: wrapQuestion(question) }] }],
    config: {
      systemInstruction: buildSystemPrompt(faq, clockLabel, imageSets),
      temperature: 1.0, // ค่าเริ่มต้นของ Gemini 3.x — อย่าลด
      maxOutputTokens: 1024, // รวม thinking + คำตอบ
      // thinkingLevel ใช้ได้กับ Gemini 3 ขึ้นไป · รุ่นเก่า (สำรอง) ใช้ค่าเริ่มต้นของรุ่นนั้น
      ...(/^gemini-[3-9]/.test(m) ? { thinkingConfig: { thinkingLevel: THINKING } } : {}),
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      httpOptions: { timeout: Math.max(5_000, Math.min(TIMEOUT_MS, BUDGET_MS - (Date.now() - t0))) },
    },
  });

  // ลำดับ: รุ่นหลัก → รุ่นสำรองทีละรุ่น → (ถ้ารุ่นหลักแค่ล่มชั่วคราว 503/504) กลับมาลองรุ่นหลักอีกครั้ง ภายในเวลาที่เหลือ
  // ข้ามรุ่นที่เพิ่งโควตาเต็ม · error อื่นของรุ่นหลัก (คีย์ผิด ชื่อรุ่นผิด) → หยุดเลย · รุ่นสำรองพังด้วยเหตุอะไรก็ข้ามไปลองต่อ
  const now = Date.now();
  const fallbacks = fallbackModel.split(",").map((s) => s.trim()).filter((s) => s && s !== model);
  const all = [model, ...new Set(fallbacks)];
  const ready = all.filter((m) => (exhaustedUntil.get(m) ?? 0) <= now);
  const plan = ready.length ? ready : [model]; // เต็มหมดทุกรุ่น → ลองรุ่นหลักครั้งเดียว (เผื่อโควตารีเซ็ตแล้ว)
  let primaryHiccup = false; // รุ่นหลักล่มชั่วคราว (ไม่ใช่โควตา) → ค่อยกลับมาลองซ้ำท้ายสุด
  let res;
  let lastErr: unknown;
  for (let i = 0; i < plan.length; i++) {
    const m = plan[i];
    if (i > 0) {
      if (BUDGET_MS - (Date.now() - t0) < 8_000) break; // เหลือเวลาไม่พอลองอีกครั้ง
      await wait(1_000);
    }
    try {
      res = await call(m);
      if (i > 0) console.log(`[gemini] สำเร็จรอบที่ ${i + 1} ด้วย ${m}`);
      break;
    } catch (err) {
      lastErr = err;
      const msg = String((err as Error)?.message ?? err);
      console.warn(`[gemini] error (${m}): ${msg.slice(0, 500)}`);
      if (m === model && !isRetryable(msg)) throw err;
      if (isQuota(msg)) exhaustedUntil.set(m, Date.now() + QUOTA_COOLDOWN_MS);
      else if (m === model && i === 0) primaryHiccup = true;
      if (i === plan.length - 1 && primaryHiccup && plan.filter((x) => x === model).length === 1) plan.push(model);
      // รุ่นถูกปิด แล้ว Google บอกรุ่นใหม่ให้ ("Please update your code to use models/xxx") → ลองรุ่นนั้นต่อทันที
      const suggested = m !== model ? suggestedModel(msg) : null;
      if (suggested && !plan.includes(suggested)) {
        console.warn(`[gemini] รุ่นสำรอง ${m} ใช้ไม่ได้ → ลอง ${suggested} ที่ Google แนะนำ (ตั้ง GEMINI_FALLBACK_MODEL=${suggested} ใน Vercel ได้)`);
        plan.splice(i + 1, 0, suggested);
      }
    }
  }
  if (!res) throw lastErr;

  const finishReason = res.candidates?.[0]?.finishReason;
  const usage = res.usageMetadata;
  console.log(
    `[gemini] finishReason=${finishReason} thoughtsTokenCount=${usage?.thoughtsTokenCount ?? 0} candidatesTokenCount=${usage?.candidatesTokenCount ?? 0}`,
  );

  // ตัดกลางประโยค → ไม่ส่งครึ่งประโยคให้ลูกค้า
  if (finishReason === FinishReason.MAX_TOKENS) {
    return { reply: DEFAULT_REPLY, needsAdmin: true, adminNote: "บอทตอบยาวเกิน (MAX_TOKENS) ลูกค้าถาม: " + question.slice(0, 200) };
  }
  return parseAnswer(res.text, question);
}

// ข้อความ 404 ของ Google: "...is no longer available to new users. Please update your code to use models/gemini-x.y-..." → ชื่อรุ่นนั้น
export function suggestedModel(message: string): string | null {
  return message.match(/use models\/(gemini-[a-z0-9.-]+[a-z0-9])/i)?.[1] ?? null;
}

export function isRetryable(message: string): boolean {
  return /\b(429|500|502|503|504)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED|high demand|overloaded|INTERNAL|fetch failed|ECONNRESET|timed? ?out|aborted/i.test(message);
}

export function parseAnswer(text: string | undefined, question: string): BotAnswer {
  try {
    const data = JSON.parse(text ?? "");
    const reply = String(data.reply ?? "").replace(/\*\*|^#+\s*/gm, "").trim();
    if (!reply) throw new Error("reply ว่าง");
    return { reply, needsAdmin: Boolean(data.needs_admin), adminNote: String(data.admin_note ?? "").trim(), showSet: String(data.show_set ?? "").trim() };
  } catch {
    return { reply: DEFAULT_REPLY, needsAdmin: true, adminNote: "บอทอ่านคำตอบ AI ไม่ได้ ลูกค้าถาม: " + question.slice(0, 200) };
  }
}
