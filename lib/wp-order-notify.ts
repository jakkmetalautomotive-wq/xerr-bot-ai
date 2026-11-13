import { createHmac, timingSafeEqual } from 'node:crypto';

// Preparation-only receiver: no LINE SDK, fetch, tokens, or payment operations.
// Do not replace the existing /api/order or /api/line-webhook routes.
export const MAX_BODY_BYTES = 4096;
const allowed = ['version', 'eventId', 'event', 'orderId', 'amountSatang', 'trial'];
export function prepareNotice(raw: string, timestamp: string, signature: string, secret: string, now = Date.now()) {
  if (secret.length < 32) return { status: 503, body: { error: 'not_configured' } };
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return { status: 413, body: { error: 'too_large' } };
  if (!/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || !/^[a-f0-9]{64}$/.test(signature)) {
    return { status: 401, body: { error: 'invalid_signature' } };
  }
  const expected = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return { status: 401, body: { error: 'invalid_signature' } };
  let p;
  try { p = JSON.parse(raw); } catch { return { status: 400, body: { error: 'invalid_payload' } }; }
  if (!p || Array.isArray(p) || Object.keys(p).some(k => !allowed.includes(k)) ||
      p.version !== 1 || p.trial !== true || typeof p.eventId !== 'string' || !/^[a-f0-9]{64}$/.test(p.eventId) ||
      !['order_created', 'slip_uploaded'].includes(p.event) || !Number.isSafeInteger(p.orderId) || p.orderId < 1 ||
      !Number.isSafeInteger(p.amountSatang) || p.amountSatang < 0 || p.amountSatang > 100000000) {
    return { status: 400, body: { error: 'invalid_payload' } };
  }
  const event = p.event === 'order_created' ? 'มีออเดอร์ทดลองใหม่' : 'ลูกค้าแนบสลิปทดสอบแล้ว';
  const amount = (p.amountSatang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2 });
  return { status: 200, body: {
    mode: 'dry_run', sent: false, eventId: p.eventId,
    text: `[ทดสอบ — ไม่รับเงินจริง] ${event}\nTEST-${p.orderId}\nยอดที่ต้องตรวจ ${amount} บาท\nยังไม่ได้ยืนยันเงินเข้า`,
    // Fixed admin-only destination. Never accept URLs, recipients, slips or guest access keys from a request.
    adminUrl: 'https://xerrautoteam.com/wp-admin/tools.php?page=xerr-trial-orders',
  } };
}
