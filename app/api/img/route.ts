// ดึงรูปจาก Google Drive แล้วส่งต่อเป็นไฟล์รูปตรง ๆ (LINE โหลดลิงก์แชร์ของ Drive ไม่ได้)
// รับเฉพาะ id ไฟล์ Drive — ไม่รับลิงก์อื่น กันคนเอาไปใช้เป็นตัวดึงเว็บอื่น
export const runtime = "nodejs";
export const maxDuration = 20;

const MAX_BYTES = 10 * 1024 * 1024; // LINE รับรูปไม่เกิน 10 MB

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return new Response("bad id", { status: 400 });

  const res = await fetch(`https://drive.google.com/uc?export=download&id=${id}`, {
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  const type = res?.headers.get("content-type") ?? "";
  if (!res?.ok || !/^image\/(jpeg|png)/.test(type)) {
    console.warn(`[img] ดึงรูป Drive ไม่ได้ id=${id} status=${res?.status} type=${type} — เช็คว่าแชร์ "ทุกคนที่มีลิงก์" และเป็น JPG/PNG`);
    return new Response("image not available", { status: 404 });
  }
  const body = await res.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return new Response("image too large", { status: 413 });
  return new Response(body, {
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=3600, s-maxage=86400" },
  });
}
