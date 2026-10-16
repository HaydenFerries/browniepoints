// Tests for the app's offline mode (queue, replay, retries, clashes) against a
// fake server built from the same rules, and for the push notification wording.
// Run with `npm run test:app`.
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('✓', msg); else { failures++; console.log('✗', msg); } };
async function throws(fn, re, msg) {
  try {
    await fn();
    ok(false, `${msg} (no error)`);
  } catch (e) {
    ok(re.test(e.message), `${msg} → "${e.message}"`);
  }
}

// Bundle the TypeScript under test into memory and load it.
const bundle = await rolldown({ input: fileURLToPath(new URL('./offline-entry.ts', import.meta.url)), logLevel: 'silent' });
const { output } = await bundle.generate({ format: 'esm' });
const lib = await import('data:text/javascript;base64,' + Buffer.from(output[0].code).toString('base64'));
const { createOfflineLayer, rules, snapshot, emptyDb, Oops } = lib;

// A pretend phone network.
let online = true;
Object.defineProperty(globalThis, 'navigator', { value: { get onLine() { return online; } }, configurable: true });

// A fake server: the same rules, plus what apply_op adds (op ids, version checks).
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const C = 'cccccccc-0000-4000-8000-000000000003';
const db = emptyDb();
const person = (id, name) => ({ id, display_name: name, avatar: '🍫', couple_id: C, created_at: new Date().toISOString(), status: 'approved', email: '', password_hash: '', pair_code: name.toUpperCase() });
db.users.push(person(A, 'Alex'), person(B, 'Sam'));
const applied = new Set();
let loseNextReply = false;
const server = (who) => ({
  userId: async () => who,
  async fetchState() {
    if (!online) throw new Error('TypeError: Failed to fetch');
    return structuredClone(snapshot(db, db.users.find((u) => u.id === who)));
  },
  async send(op) {
    if (!online) throw new Error('TypeError: Failed to fetch');
    if (applied.has(op.id)) return null;
    const me = db.users.find((u) => u.id === who);
    if (op.base) {
      const row = (op.base.table === 'tasks' ? db.tasks : db.rewards).find((x) => x.id === op.base.id);
      if (row && (row.version ?? 1) !== op.base.version && row.last_editor !== who) {
        const name = db.users.find((u) => u.id === row.last_editor)?.display_name ?? 'Your partner';
        throw new Error(`CONFLICT: ${name} changed this since`);
      }
    }
    const before = JSON.stringify(db);
    try {
      rules[op.method](db, me, ...structuredClone(op.args));
    } catch (e) {
      Object.assign(db, JSON.parse(before)); // a refused change rolls back
      throw e;
    }
    applied.add(op.id);
    if (loseNextReply) {
      loseNextReply = false;
      throw new Error('TypeError: Failed to fetch'); // it worked, but the phone never heard back
    }
    return null;
  },
});

const alex = createOfflineLayer(server(A));
const sam = createOfflineLayer(server(B));
// What the real backend's methods do: the rule, the server function and its params.
const call = (layer, method, ...args) => layer.run(method, args, method, {});
const bal = (s, who) => s.balances[who] ?? 0;
const task = (s, title) => s.tasks.find((t) => t.title === title);
const input = (title, points = 10, extra = {}) => ({
  title, details: '', shared: false, partnerPoints: points, myPoints: null, repeatable: true,
  decayHours: null, decayFloor: 25, decayGrace: 0, stalePartner: null, staleMine: null, sleepHours: null, ...extra,
});

// Online: straight through
await call(alex, 'createTask', input('Dishes'), crypto.randomUUID());
let sA = await alex.getState();
ok(task(sA, 'Dishes') && db.tasks.length === 1, 'online changes go straight to the server');
ok(alex.sync.status().pending.length === 0 && !alex.sync.status().fromCache, 'nothing queued while online');
await throws(() => call(alex, 'claimTask', task(sA, 'Dishes').id, ''), /for your partner/, 'online, the server’s refusal shows as before');
const dishes = task(sA, 'Dishes').id;
await sam.getState();

// Offline
online = false;
sA = await alex.getState();
ok(alex.sync.status().fromCache && task(sA, 'Dishes'), 'offline, the last synced state still loads');
await call(alex, 'giftBrownies', 5, 'offline love');
const newId = crypto.randomUUID();
await call(alex, 'createTask', input('Water plants', 8), newId);
await call(alex, 'editTask', newId, input('Water the plants', 12));
sA = await alex.getState();
ok(bal(sA, B) === 5 && sA.activity[0].kind === 'task_updated', 'offline changes show straight away');
ok(task(sA, 'Water the plants')?.points === 12, 'a task made offline can be edited offline');
ok(alex.sync.status().pending.length === 3 && db.tasks.length === 1 && !db.activity.some((a) => a.kind === 'gift'), 'they wait in the queue, the server has none of them yet');
await throws(() => call(alex, 'claimTask', dishes, ''), /for your partner/, 'offline, rules are still checked straight away');
ok(alex.sync.status().pending.length === 3, 'a refused change is not queued');
await throws(() => call(alex, 'redeemReward', crypto.randomUUID()), /isn.t available/, 'and nothing is spent offline that the rules wouldn’t allow');
ok(alex.sync.status().pending[0].label === 'Gift 5 brownies to Sam', `queued changes have plain labels ("${alex.sync.status().pending[0].label}")`);

// Sam also does things while Alex is offline (Sam's phone has signal)
online = true;
await call(sam, 'claimTask', dishes, 'sparkly');
online = false;

// Back online
online = true;
await alex.sync.flush();
sA = await alex.getState();
ok(alex.sync.status().pending.length === 0 && alex.sync.status().failed.length === 0, 'the queue empties once back online');
ok(bal(sA, B) === 5 && db.activity.filter((a) => a.kind === 'gift').length === 1, 'the gift arrives exactly once');
ok(db.tasks.some((t) => t.id === newId && t.title === 'Water the plants' && t.points === 12), 'the offline task keeps its id and its edit');
ok(sA.claims.some((c) => c.task_id === dishes && c.status === 'pending'), 'and Alex now sees what Sam did meanwhile');

// A flaky reply: the server applied it but the phone never heard back
loseNextReply = true;
await call(alex, 'giftBrownies', 2, '');
await alex.sync.flush();
ok(db.activity.filter((a) => a.kind === 'gift').length === 2 && (await alex.getState()).balances[B] === 7, 'resending it does not gift twice');

// Both edit the same task: Sam online, Alex offline
const shared = crypto.randomUUID();
await call(alex, 'createTask', input('Mow the lawn', 10, { shared: true, myPoints: 10 }), shared);
await sam.getState();
await call(sam, 'respondShared', shared, true);
await alex.getState();
online = false;
await call(alex, 'editTask', shared, input('Mow the lawn (front)', 10, { shared: true, myPoints: 10 }));
online = true;
await call(sam, 'editTask', shared, input('Mow the lawn (back)', 15, { shared: true, myPoints: 10 }));
await alex.sync.flush();
let st = alex.sync.status();
ok(st.failed.length === 1 && st.failed[0].conflict && /Sam changed this since/.test(st.failed[0].reason), `a clash lands in "Couldn't sync" ("${st.failed[0]?.reason}")`);
ok(db.tasks.find((t) => t.id === shared).title === 'Mow the lawn (back)', 'nothing was overwritten silently');
await alex.sync.useMine(st.failed[0].id);
ok(alex.sync.status().failed.length === 0 && db.tasks.find((t) => t.id === shared).title === 'Mow the lawn (front)', '"Use mine" sends it again over theirs');

// Both claim the same shared job offline
await call(sam, 'respondShared', shared, true);
await sam.getState();
await alex.getState();
online = false;
await call(alex, 'claimTask', shared, '', new Date().toISOString());
await call(sam, 'claimTask', shared, '', new Date().toISOString());
online = true;
await sam.sync.flush();
await alex.sync.flush();
st = alex.sync.status();
ok(st.failed.length === 1 && /Already marked/.test(st.failed[0].reason) && !st.failed[0].conflict, 'two people doing the same job offline: the second is reported, not lost');
await alex.sync.discard(st.failed[0].id);
ok(alex.sync.status().failed.length === 0, '"Discard" clears it');

// A timed task done offline earns what it was worth then
const timed = crypto.randomUUID();
await call(alex, 'createTask', input('Bake bread', 40, { decayHours: 10, stalePartner: 10 }), timed);
db.tasks.find((t) => t.id === timed).bumped_at = new Date(Date.now() - 12 * 3600e3).toISOString();
await sam.getState();
online = false;
const doneAt = new Date(Date.now() - 10 * 3600e3).toISOString(); // done 2 hours after it was fresh, synced 10 hours later
await call(sam, 'claimTask', timed, '', doneAt);
online = true;
await sam.sync.flush();
const worth = db.claims.find((c) => c.task_id === timed).points;
ok(worth === 34, `claimed when it was nearly fresh, it earns that (${worth}), not the stale price`);

// Signing out forgets it all
await sam.forget(B);
online = false;
await throws(() => sam.getState(), /hasn.t synced yet/, 'after signing out nothing is left on the phone');
online = true;

// Push notification wording
const push = await import('../supabase/functions/send-push/messages.ts');
const row = (kind, extra = {}) => ({ id: 1, couple_id: C, actor_id: A, kind, title: 'Dishes', value: 10, delta: null, beneficiary_id: null, note: '', ...extra });
ok(push.messageFor(row('task_claimed'), 'Alex').title === 'Alex did ‘Dishes’', 'claims ask the partner to approve');
ok(push.messageFor(row('task_approved', { delta: 10 }), 'Sam').title === '+10 brownies 🍫', 'approvals show the brownies earned');
ok(push.messageFor(row('gift', { value: 1, note: 'ty' }), 'Sam').title === 'Sam gifted you 1 brownie! 🎁', 'gifts use singular for 1');
ok(push.messageFor(row('reward_added'), 'Alex').url === '#treats', 'wishes open the treats screen');
ok(['task_updated', 'task_paused', 'task_bumped', 'claim_withdrawn', 'unpaired'].every((k) => push.messageFor(row(k), 'Alex') === null), 'noisy kinds stay quiet');
ok(JSON.stringify(push.recipientsFor(row('gift'), [A, B])) === JSON.stringify([B]), 'the person who did it is never notified');
ok(push.recipientsFor(row('paired', { actor_id: null }), [A, B]).length === 0, 'admin actions (no actor) notify nobody');

// VAPID keys in the format `npm run vapid-keys` prints work with WebCrypto
{
  const { generateKeyPairSync } = await import('node:crypto');
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pj = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pj.x, 'base64url'), Buffer.from(pj.y, 'base64url')]).toString('base64url');
  const jwks = push.vapidJwks(raw, privateKey.export({ format: 'jwk' }).d);
  const algo = { name: 'ECDSA', namedCurve: 'P-256' };
  const signer = await crypto.subtle.importKey('jwk', jwks.privateKey, algo, false, ['sign']);
  const verifier = await crypto.subtle.importKey('jwk', jwks.publicKey, algo, true, ['verify']);
  const data = new TextEncoder().encode('brownies');
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signer, data);
  ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifier, sig, data), 'VAPID keys from the key maker load into WebCrypto');
}

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
