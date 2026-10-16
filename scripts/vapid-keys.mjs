// Makes everything push notifications need, in one go (no downloads needed):
//   npm run vapid-keys -- you@example.com
// Every run makes a NEW random set. Run it once, save the output somewhere safe
// (e.g. a password manager), and use that same set everywhere.
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const email = process.argv[2] || 'you@example.com';
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });
const b64 = (s) => Buffer.from(s, 'base64url');
const raw = Buffer.concat([Buffer.from([4]), b64(pub.x), b64(pub.y)]).toString('base64url');

console.log(`
A NEW set of push notification keys. Save all of this once; use the same values everywhere.
Running this again makes a different set (that's normal; just don't mix sets).

1) GitHub repo variable (public, safe to share)
   VITE_VAPID_PUBLIC_KEY = ${raw}

2) Supabase Edge Function secrets (keep private)
   VAPID_PUBLIC_KEY      = ${raw}
   VAPID_PRIVATE_KEY     = ${priv.d}
   VAPID_SUBJECT         = mailto:${email}
   PUSH_WEBHOOK_SECRET   = ${randomBytes(24).toString('base64url')}

3) Both database webhooks: HTTP header
   x-webhook-secret      = (the same value as PUSH_WEBHOOK_SECRET above)
`);
