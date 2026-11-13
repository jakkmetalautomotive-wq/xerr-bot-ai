import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { prepareNotice, MAX_BODY_BYTES } from './wp-order-notify.ts';

// Separate opt-in route. Existing dry-run endpoint and chatbot remain unchanged.
export async function sendTrialNotice(raw: string, timestamp: string, signature: string,
 config: { secret: string; recipient: string; token: string; enabled: boolean },
 fetcher: typeof fetch = fetch, now = Date.now()) {
 const fail = (status: number, error: string) => ({ status, body: { error, sent: false } });
 if (!config.enabled) return fail(503, 'sending_disabled');
 if (config.secret.length < 32 || !/^U[a-f0-9]{32}$/.test(config.recipient) || !config.token) return fail(503, 'not_configured');
 if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return fail(413, 'too_large');
 if (!/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || !/^[a-f0-9]{64}$/.test(signature)) return fail(401, 'invalid_signature');
 const mac = createHmac('sha256', config.secret).update(`${timestamp}.${raw}`).digest();
 if (!timingSafeEqual(mac, Buffer.from(signature, 'hex'))) return fail(401, 'invalid_signature');
 let p;
 try { p = JSON.parse(raw); } catch { return fail(400, 'invalid_payload'); }
 if (!p || Object.keys(p).length !== 2 || !p.notice || !Number.isSafeInteger(p.firstAttemptAt)) return fail(400, 'invalid_payload');
 // Persisted by WordPress BEFORE first attempt; never refreshed for retries.
 // Stop after 20h, safely within LINE's 24h retry-key lifetime, even after an ambiguous timeout.
 if (p.firstAttemptAt > now / 1000 + 60 || now / 1000 - p.firstAttemptAt > 20 * 3600) return fail(410, 'retry_window_expired');
 const noticeRaw = JSON.stringify(p.notice);
 const noticeSig = createHmac('sha256', config.secret).update(`${timestamp}.${noticeRaw}`).digest('hex');
 const validated = prepareNotice(noticeRaw, timestamp, noticeSig, config.secret, now);
 if (validated.status !== 200) return validated;
 const { eventId, text, adminUrl } = validated.body;
 // Stable per event AND recipient, including the first request. Never include the signing timestamp.
 const hex = createHash('sha256').update(`${config.recipient}:${eventId}`).digest('hex');
 const retryKey = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
 try {
  const r = await fetcher('https://api.line.me/v2/bot/message/push', {
   method: 'POST', redirect: 'error', signal: AbortSignal.timeout(7000),
   headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}`, 'X-Line-Retry-Key': retryKey },
   body: JSON.stringify({ to: config.recipient, messages: [{ type: 'text', text: `${text}\nตรวจออเดอร์และสลิปในหลังบ้าน:\n${adminUrl}` }] }),
  });
  const accepted = r.status === 200 || (r.status === 409 && !!r.headers.get('x-line-accepted-request-id'));
  if (!accepted) return fail(r.status >= 500 ? 502 : 422, `line_rejected_${r.status}`);
  return { status: 200, body: { mode: 'trial_send', accepted: true, eventId, recipientSuffix: config.recipient.slice(-6), duplicate: r.status === 409 } };
 } catch { return fail(502, 'delivery_unknown_retry_same_event'); }
}
