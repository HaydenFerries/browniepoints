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
// Single file on purpose: paste it as index.ts in the dashboard editor.
//
// Turn OFF "Enforce JWT verification" for this function: webhooks are checked
// with the shared secret and test requests with the person's own token.

import { createClient } from 'npm:@supabase/supabase-js@2';
// WebCrypto-based Web Push (the Node "web-push" package doesn't run on Supabase's Deno runtime)
import * as webpush from 'jsr:@negrel/webpush@0.5.0';
// ---------------------------------------------------------------------------
// What to say, and to whom (the tests check these)
// ---------------------------------------------------------------------------
export interface ActivityRow {
  id: number;
  couple_id: string;
  actor_id: string | null;
  kind: string;
  title: string;
  value: number | null;
  delta: number | null;
  beneficiary_id: string | null;
  note: string;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Where tapping it opens the app. */
  url: string;
  /** Newer notifications with the same tag replace older ones. */
  tag: string;
}

const q = (t: string) => `‘${t}’`;
const brownies = (n: number | null) => `${n ?? 0} brownie${n === 1 ? '' : 's'}`;

/** What to tell the other partner about this activity, or null to stay quiet. */
export function messageFor(a: ActivityRow, actor: string): PushMessage | null {
  const tag = `${a.kind}:${a.title}`;
  const note = a.note?.trim() ? `“${a.note.trim()}”` : '';
  switch (a.kind) {
    case 'task_claimed':
      return { title: `${actor} did ${q(a.title)}`, body: note || `Worth ${brownies(a.value)}. Tap to approve.`, url: '#home', tag };
    case 'task_approved':
      return { title: `+${brownies(a.delta)} 🍫`, body: `${actor} approved ${q(a.title)}.${note ? ' ' + note : ''}`, url: '#home', tag };
    case 'task_declined':
      return { title: `${q(a.title)} went back in the oven`, body: note || `${actor} sent it back.`, url: '#tasks', tag };
    case 'task_added':
      return { title: `New task from ${actor}`, body: `${q(a.title)} · ${brownies(a.value)}`, url: '#tasks', tag };
    case 'shared_proposed':
      return { title: `${actor} wants to share a job`, body: `${q(a.title)}. Have a look at the deal.`, url: '#tasks', tag };
    case 'shared_changed':
      return { title: `${actor} changed the deal`, body: `${q(a.title)} needs your OK again.`, url: '#tasks', tag };
    case 'shared_agreed':
      return { title: 'Deal! 🤝', body: `${actor} agreed to ${q(a.title)}.`, url: '#tasks', tag };
    case 'shared_declined':
      return { title: `${actor} passed on ${q(a.title)}`, body: 'Maybe another time.', url: '#tasks', tag };
    case 'reward_added':
      return { title: `${actor} made a wish`, body: `${q(a.title)}. Set a price for it.`, url: '#treats', tag };
    case 'reward_priced':
      return { title: 'Your wish has a price', body: `${q(a.title)} costs ${brownies(a.value)}.`, url: '#treats', tag };
    case 'reward_redeemed':
      return { title: `${actor} cashed in ${q(a.title)} 🎉`, body: 'Time to make it happen.', url: '#treats', tag };
    case 'redemption_delivered':
      return { title: `${actor} delivered ${q(a.title)}`, body: 'Enjoy! 💝', url: '#treats', tag };
    case 'redemption_cancelled':
      return { title: `${actor} cancelled ${q(a.title)}`, body: `The ${brownies(a.value)} went back in their jar.`, url: '#treats', tag };
    case 'gift':
      return { title: `${actor} gifted you ${brownies(a.value)}! 🎁`, body: note || 'Just because.', url: '#home', tag: `gift:${a.id}` };
    case 'paired':
      return { title: `You’re paired with ${actor}! 🍫`, body: 'Start setting each other sweet little tasks.', url: '#home', tag };
    default:
      return null; // edits, pauses, warm-ups… not worth a ping
  }
}

/** Who hears about it: everyone in the couple except whoever did it. */
export function recipientsFor(a: ActivityRow, members: string[]): string[] {
  if (!a.actor_id) return [];
  return members.filter((id) => id !== a.actor_id);
}

export const NEW_SIGNUP: PushMessage = {
  title: 'Someone wants in',
  body: 'A new sign-up is waiting for approval.',
  url: '#admin',
  tag: 'signup',
};

export const TEST: PushMessage = {
  title: 'Brownie Points',
  body: 'Notifications are working! 🍫',
  url: '#home',
  tag: 'test',
};

/** The keys from `npm run vapid-keys` (raw public key + private "d"), as the JWKs WebCrypto wants. */
export function vapidJwks(publicKey: string, privateKey: string) {
  const raw = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const pub = { kty: 'EC', crv: 'P-256', x: b64url(raw.slice(1, 33)), y: b64url(raw.slice(33, 65)), ext: true };
  return { publicKey: pub, privateKey: { ...pub, d: privateKey } };
}

// ---------------------------------------------------------------------------
// The function itself
// ---------------------------------------------------------------------------
// The app calls "Send a test" from the browser, which first asks (OPTIONS) whether it may.
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
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

// (guarded so the tests can load this file in Node)
if (typeof Deno !== 'undefined') Deno.serve(handle);
