// Makes a VAPID key pair for push notifications (no downloads needed).
//   npm run vapid-keys
// Public key  → the VITE_VAPID_PUBLIC_KEY repo variable (and .env.local) — safe to share.
// Private key → Supabase → Edge Functions → Secrets as VAPID_PRIVATE_KEY — keep it secret.
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });
const b64 = (s) => Buffer.from(s, 'base64url');
const raw = Buffer.concat([Buffer.from([4]), b64(pub.x), b64(pub.y)]).toString('base64url');

console.log(`
Public key (VITE_VAPID_PUBLIC_KEY and VAPID_PUBLIC_KEY):
${raw}

Private key (VAPID_PRIVATE_KEY, Supabase secret only, never in the app or repo):
${priv.d}
`);
