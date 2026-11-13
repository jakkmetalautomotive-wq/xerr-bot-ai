import { MAX_BODY_BYTES, prepareNotice } from '../../../lib/wp-order-notify.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function POST(req: Request) {
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
  const secret = process.env.WP_NOTIFY_SHARED_SECRET ?? '';
  if (secret.length < 32) return Response.json({ error: 'not_configured' }, { status: 503, headers });
  const recipient = process.env.WP_NOTIFY_RECIPIENT_ID ?? '';
  if (!/^U[a-f0-9]{32}$/.test(recipient)) return Response.json({ error: 'recipient_not_configured' }, { status: 503, headers });
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return Response.json({ error: 'json_required' }, { status: 415, headers });
  }
  const reader = req.body?.getReader();
  if (!reader) return Response.json({ error: 'body_required' }, { status: 400, headers });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        return Response.json({ error: 'too_large' }, { status: 413, headers });
      }
      chunks.push(value);
    }
    const result = prepareNotice(Buffer.concat(chunks).toString('utf8'), req.headers.get('x-xerr-timestamp') ?? '',
      req.headers.get('x-xerr-signature') ?? '', secret);
    return Response.json(result.status === 200 ? { ...result.body, recipientSuffix: recipient.slice(-6) } : result.body,
      { status: result.status, headers });
  } catch {
    return Response.json({ error: 'invalid_request' }, { status: 400, headers });
  }
}
