// เรียก Gemini ตอบลูกค้า
import { GoogleGenAI, FinishReason, Type, type Content } from "@google/genai";
import { buildSystemPrompt, wrapQuestion } from "./prompt.ts";
import { DEFAULT_REPLY } from "./shop.ts";

export const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const TIMEOUT_MS = 8_000; // LINE ต้องตอบภายใน ~10 วินาที

export type BotAnswer = { reply: string; needsAdmin: boolean; adminNote: string };

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING },
    needs_admin: { type: Type.BOOLEAN },
    admin_note: { type: Type.STRING },
  },
  required: ["reply", "needs_admin", "admin_note"],
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
  generate: GenerateFn = defaultGenerate(),
): Promise<BotAnswer> {
  const res = await generate({
    model: MODEL,
    contents: [...history, { role: "user", parts: [{ text: wrapQuestion(question) }] }],
    config: {
      systemInstruction: buildSystemPrompt(faq, clockLabel),
      temperature: 1.0, // ค่าเริ่มต้นของ Gemini 3.x — อย่าลด
      maxOutputTokens: 1024, // รวม thinking + คำตอบ
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      httpOptions: { timeout: TIMEOUT_MS },
    },
  });

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

export function parseAnswer(text: string | undefined, question: string): BotAnswer {
  try {
    const data = JSON.parse(text ?? "");
    const reply = String(data.reply ?? "").replace(/\*\*|^#+\s*/gm, "").trim();
    if (!reply) throw new Error("reply ว่าง");
    return { reply, needsAdmin: Boolean(data.needs_admin), adminNote: String(data.admin_note ?? "").trim() };
  } catch {
    return { reply: DEFAULT_REPLY, needsAdmin: true, adminNote: "บอทอ่านคำตอบ AI ไม่ได้ ลูกค้าถาม: " + question.slice(0, 200) };
  }
}
