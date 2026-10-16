// What send-push says for each kind of activity, and who hears about it.
// Kept apart from index.ts so the tests can load it without Deno.

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
