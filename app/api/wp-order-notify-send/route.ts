import { sendTrialNotice } from '../../../lib/wp-notify-send.ts';
import { MAX_BODY_BYTES } from '../../../lib/wp-order-notify.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;
export async function POST(req: Request) {
 const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
 if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return Response.json({error:'json_required'}, {status:415,headers});
 const reader = req.body?.getReader();
 if (!reader) return Response.json({error:'body_required'}, {status:400,headers});
 const chunks: Uint8Array[] = []; let length = 0;
 try {
  while (true) {
   const {done,value} = await reader.read(); if(done) break;
   length += value.byteLength;
   if(length > MAX_BODY_BYTES) { await reader.cancel(); return Response.json({error:'too_large'},{status:413,headers}); }
   chunks.push(value);
  }
  const result = await sendTrialNotice(Buffer.concat(chunks).toString('utf8'), req.headers.get('x-xerr-timestamp')??'', req.headers.get('x-xerr-signature')??'', {
   secret: process.env.WP_NOTIFY_SHARED_SECRET??'', recipient: process.env.WP_NOTIFY_RECIPIENT_ID??'',
   token: process.env.LINE_CHANNEL_ACCESS_TOKEN??'', enabled: process.env.WP_NOTIFY_SEND_MODE === 'trial_only',
  });
  return Response.json(result.body,{status:result.status,headers});
 } catch { return Response.json({error:'invalid_request'},{status:400,headers}); }
}
