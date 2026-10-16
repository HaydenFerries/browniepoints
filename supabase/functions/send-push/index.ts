// Brownie Points: send-push (Supabase Edge Function, Deno)
//
// Sends Web Push notifications to phones that switched them on. Called by:
//   * a Database Webhook on INSERT into public.activity → pings the *other*
//     partner (never the person who did it)
//   * a Database Webhook on INSERT into public.profiles → tells admins that
//     someone new is waiting for approval
//   * the app's "Send a test" button (with the signed-in person's token)
//
// Secrets (Supabase → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. mailto:you@example.com),
//   PUSH_WEBHOOK_SECRET (any long random string; the webhooks send it in an
//   x-webhook-secret header). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
//   provided automatically.
//
// Turn OFF "Enforce JWT verification" for this function: webhooks are checked
// with the shared secret and test requests with the person's own token.

import { createClient } from 'npm:@supabase/supabase-js@2';
// WebCrypto-based Web Push (the Node "web-push" package doesn't run on Supabase's Deno runtime)
import * as webpush from 'jsr:@negrel/webpush@0.5.0';
import { messageFor, NEW_SIGNUP, recipientsFor, TEST, vapidJwks, type ActivityRow, type PushMessage } from './messages.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function handle(req: Request): Promise<Response> {
  const env = (k: string) => Deno.env.get(k) ?? '';
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const server = await webpush.ApplicationServer.new({
    contactInformation: env('VAPID_SUBJECT') || 'mailto:admin@example.com',
    vapidKeys: await webpush.importVapidKeys(vapidJwks(env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'))),
  });

  const body = await req.json().catch(() => ({}));
  let to: string[] = [];
  let msg: PushMessage | null = null;

  if (body?.test) {
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data } = await db.auth.getUser(token);
    if (!data?.user) return json({ error: 'Please sign in again.' }, 401);
    to = [data.user.id];
    msg = TEST;
  } else {
    const secret = env('PUSH_WEBHOOK_SECRET');
    if (!secret || req.headers.get('x-webhook-secret') !== secret) return json({ error: 'Not allowed.' }, 401);
    if (body?.type !== 'INSERT' || !body.record) return json({ skipped: 'not an insert' });

    if (body.table === 'activity') {
      const a = body.record as ActivityRow;
      const { data: members } = await db.from('profiles').select('id, display_name').eq('couple_id', a.couple_id);
      const people = (members ?? []) as { id: string; display_name: string }[];
      const actor = people.find((p) => p.id === a.actor_id)?.display_name ?? 'Your partner';
      msg = messageFor(a, actor);
      to = recipientsFor(a, people.map((p) => p.id));
    } else if (body.table === 'profiles' && body.record.status === 'pending') {
      const { data: admins } = await db.from('profiles').select('id').eq('is_admin', true);
      to = ((admins ?? []) as { id: string }[]).map((p) => p.id);
      msg = NEW_SIGNUP;
    }
  }
  if (!msg || !to.length) return json({ skipped: 'nothing to send' });

  const { data: subs } = await db.from('push_subscriptions').select('endpoint, p256dh, auth').in('user_id', to);
  let sent = 0;
  await Promise.all(
    ((subs ?? []) as { endpoint: string; p256dh: string; auth: string }[]).map(async (s) => {
      try {
        await server
          .subscribe({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } })
          .pushTextMessage(JSON.stringify(msg), { ttl: 60 * 60 * 24 });
        sent++;
      } catch (e) {
        const code = (e as { response?: Response }).response?.status;
        if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint); // phone unsubscribed
        else console.error('push failed', code ?? '', String(e));
      }
    }),
  );
  return json({ sent });
}

Deno.serve(handle);
