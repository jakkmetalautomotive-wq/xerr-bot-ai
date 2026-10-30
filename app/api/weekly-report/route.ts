// สรุปยอดขาย LINE 7 วันล่าสุด → ส่งเข้าแชทแอดมิน (และลงแท็บ "สรุปรายสัปดาห์" ในชีทออเดอร์)
// Vercel Cron เรียกทุกวันอาทิตย์ 20:00 (vercel.json) พร้อม Authorization: Bearer CRON_SECRET
// ลองเอง: /api/weekly-report?key=HEALTH_KEY · ไม่แสดงคีย์ใด ๆ
import { fetchWeeklySummary, weeklyReportText } from "@/lib/orderlog.ts";
import { line } from "@/lib/line.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const cron = process.env.CRON_SECRET ?? "";
  const health = process.env.HEALTH_KEY ?? "";
  const byCron = cron.length >= 8 && req.headers.get("authorization") === `Bearer ${cron}`;
  const byKey = health.length >= 8 && new URL(req.url).searchParams.get("key") === health;
  if (!byCron && !byKey) return Response.json({ ok: false, note: "ต้องมี CRON_SECRET (Vercel Cron) หรือ ?key=HEALTH_KEY" }, { status: 401 });

  const adminId = process.env.ADMIN_LINE_USER_ID;
  if (!adminId) return Response.json({ ok: false, error: "ยังไม่ได้ตั้ง ADMIN_LINE_USER_ID" }, { status: 500 });

  const summary = await fetchWeeklySummary();
  if (!summary) {
    await line.push(adminId, ["📊 สรุปยอดขายสัปดาห์นี้ดึงจากชีทออเดอร์ไม่ได้ครับ — เช็ค ORDER_LOG_URL / ORDER_LOG_SECRET และเวอร์ชันของ Apps Script (ต้องมีคำสั่ง summary)"]).catch(() => {});
    return Response.json({ ok: false, error: "ดึงสรุปจากชีทไม่ได้" }, { status: 502 });
  }
  const text = weeklyReportText(summary);
  await line.push(adminId, [text]);
  return Response.json({ ok: true, sent: true, paidCount: summary.paidCount, paidTotal: summary.paidTotal });
}
