// Runs the Supabase migration on PGlite (Postgres compiled to WASM) with a tiny
// stand-in for Supabase's auth schema, then plays both partners through every
// RPC and checks the permission rules. Run with `npm run test:db`.
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../migrations/', import.meta.url);
const migrations = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(new URL(f, dir), 'utf8'));
const db = new PGlite();

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (
    id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb,
    created_at timestamptz default now(), last_sign_in_at timestamptz, email_confirmed_at timestamptz
  );
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  create publication supabase_realtime;
`);

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444'; // a random sign-up that stays pending
const E = '55555555-5555-4555-8555-555555555555'; // signed up before sign-ups needed approval

// First migration, an early account, then the rest; then everything again.
await db.exec(migrations[0]);
await db.query(`insert into auth.users (id, email) values ($1, 'early@x.test')`, [E]);
for (const m of migrations.slice(1)) await db.exec(m);
for (const m of migrations) await db.exec(m); // must be safe to re-run
console.log(`✓ ${migrations.length} migrations applied twice`);

await db.query(`insert into auth.users (id, email, raw_user_meta_data) values
  ($1, 'a@x.test', '{"display_name":"Alex","avatar":"🧁"}'),
  ($2, 'b@x.test', '{"display_name":"Sam"}'),
  ($3, 'c@x.test', '{}'),
  ($4, 'd@x.test', '{"display_name":"Random"}')`, [A, B, C, D]);

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('✓', msg); else { failures++; console.log('✗', msg); } };

async function as(user, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role;');
  }
}
async function expectError(user, sql, params, re, msg) {
  try {
    await as(user, sql, params);
    ok(false, `${msg} (no error)`);
  } catch (e) {
    ok(re.test(e.message), `${msg} → "${e.message}"`);
  }
}
const state = async (u) => (await as(u, 'select public.get_state() as s')).rows[0].s;

// invite-only sign-ups
ok((await state(E)).me.status === 'approved', 'accounts from before invite-only stay approved');
let sA = await state(A);
ok(sA.me.status === 'pending' && !('pair_code' in sA.me), 'new accounts start pending, with no pair code shown');
await expectError(A, "select public.add_task('x', '', 1, true)", [], /waiting for approval/, 'pending account cannot use the app');
await expectError(A, 'select public.update_profile($1, $2)', ['Hacker', '🤖'], /waiting for approval/, 'pending account cannot edit its profile');
await expectError(A, 'select public.admin_list_users()', [], /waiting for approval/, 'pending account cannot open the admin portal');
await db.query("update public.profiles set is_admin = true, status = 'approved' where id = $1", [A]); // the one-off SQL step
await expectError(E, 'select public.admin_list_users()', [], /Only admins/, 'approved non-admin cannot open the admin portal');
sA = await state(A);
ok(sA.admin?.pending === 3, `admin sees how many are waiting (${sA.admin?.pending})`);
ok((await state(E)).admin === null, 'non-admins get no admin info');
const list = (await as(A, 'select public.admin_list_users() as l')).rows[0].l;
ok(list.length === 5 && list[0].status === 'pending' && list.some((u) => u.email === 'd@x.test'), 'admin lists accounts with emails, pending first');
await as(A, 'select public.admin_approve($1)', [B]);
await as(A, 'select public.admin_approve($1)', [C]);
ok((await state(B)).me.status === 'approved', 'admin approves a sign-up');
await expectError(B, 'select public.admin_approve($1)', [D], /Only admins/, 'non-admins cannot approve');
const codeD = (await db.query('select pair_code from public.profiles where id = $1', [D])).rows[0].pair_code;
const r0 = await as(A, 'select public.pair_with($1) as r', [codeD]);
ok(r0.rows[0].r.ok === false && /match anyone/.test(r0.rows[0].r.error), 'cannot pair with a pending account');

// profiles from the trigger
ok(sA.me.display_name === 'Alex' && sA.me.avatar === '🧁', 'profile created from sign-up metadata');
ok(/^[A-Z]+-[A-Z2-9]{5}$/.test(sA.me.pair_code), `pair code format ${sA.me.pair_code}`);
ok((await state(C)).me.display_name === 'c', 'name falls back to email prefix');

// pairing
const codeB = (await state(B)).me.pair_code;
let r = await as(A, 'select public.pair_with($1) as r', [sA.me.pair_code]);
ok(r.rows[0].r.ok === false && /own code/.test(r.rows[0].r.error), 'cannot pair with own code');
r = await as(A, 'select public.pair_with($1) as r', ['NOPE-ZZZZZ']);
ok(r.rows[0].r.ok === false, 'unknown code rejected (and counted)');
r = await as(A, 'select public.pair_with($1) as r', [codeB.toLowerCase().replace('-', ' ')]);
ok(r.rows[0].r.ok === true, 'pairs with partner code (case/spacing tolerant)');
r = await as(C, 'select public.pair_with($1) as r', [codeB]);
ok(r.rows[0].r.ok === false && /already paired/.test(r.rows[0].r.error), 'third person cannot pair with a paired user');

sA = await state(A);
ok(sA.partner?.display_name === 'Sam' && !('pair_code' in sA.partner), 'partner visible, partner code hidden');

// tasks
await as(A, `select public.add_task('Dishes', 'pots too', 10, true)`);
await as(A, `select public.add_task('Date night', '', 40, false)`);
let sB = await state(B);
ok(sB.tasks.length === 2 && sB.tasks.every((t) => t.assigned_to === B), 'Sam sees both tasks assigned to them');
const dishes = sB.tasks.find((t) => t.title === 'Dishes');
const date = sB.tasks.find((t) => t.title === 'Date night');
await expectError(B, 'select public.update_task($1, $2, $3, $4, $5)', [dishes.id, 'x', 999, 1, true].slice(0, 5), /Only the person who set/, 'assignee cannot edit task');
await expectError(A, 'select public.claim_task($1, $2)', [dishes.id, ''], /for your partner/, 'setter cannot claim own task');
await as(B, 'select public.claim_task($1, $2)', [dishes.id, 'done!']);
await expectError(B, 'select public.claim_task($1, $2)', [dishes.id, ''], /Already marked/, 'no double claim');
let claim = (await state(B)).claims.find((c) => c.status === 'pending');
await expectError(B, 'select public.review_claim($1, true, $2)', [claim.id, ''], /Nice try/, 'cannot approve own claim');
await as(A, 'select public.review_claim($1, true, $2)', [claim.id, 'yay']);
sB = await state(B);
ok(sB.balances[B] === 10 && sB.earned[B] === 10, 'approval credits 10 brownies');
ok(sB.tasks.find((t) => t.id === dishes.id).status === 'open', 'repeatable task stays open');

await as(B, 'select public.claim_task($1, $2)', [date.id, '']);
claim = (await state(B)).claims.find((c) => c.status === 'pending');
await as(A, 'select public.review_claim($1, false, $2)', [claim.id, 'not yet']);
ok((await state(B)).balances[B] === 10, 'declined claim pays nothing');
await as(B, 'select public.claim_task($1, $2)', [date.id, '']);
claim = (await state(B)).claims.find((c) => c.status === 'pending');
await as(B, 'select public.withdraw_claim($1)', [claim.id]);
await as(B, 'select public.claim_task($1, $2)', [date.id, '']);
claim = (await state(B)).claims.find((c) => c.status === 'pending');
await as(A, 'select public.review_claim($1, true, $2)', [claim.id, '']);
sB = await state(B);
ok(sB.balances[B] === 50, 'second approval → 50');
ok(sB.tasks.find((t) => t.id === date.id).status === 'done', 'one-off task marked done');

// rewards
const rid = (await as(B, `select public.add_reward('Massage', '20 min', '💆') as id`)).rows[0].id;
await expectError(B, 'select public.price_reward($1, 30)', [rid], /partner decides/, 'cannot price own wish');
await expectError(B, 'select public.redeem_reward($1)', [rid], /hasn.t set a price/, 'cannot redeem unpriced wish');
await as(A, 'select public.price_reward($1, 30)', [rid]);
await expectError(A, 'select public.redeem_reward($1)', [rid], /own wishlist/, 'cannot redeem partner wish');
const red1 = (await as(B, 'select public.redeem_reward($1) as id', [rid])).rows[0].id;
ok((await state(B)).balances[B] === 20, 'redeem spends 30 → 20 left');
await expectError(B, 'select public.redeem_reward($1)', [rid], /need 10 more/, 'cannot overspend');
await expectError(B, 'select public.deliver_redemption($1)', [red1], /Your partner marks/, 'redeemer cannot mark delivered');
await expectError(B, 'select public.remove_reward($1)', [rid], /Cancel that first/, 'cannot remove wish with pending redemption');
await as(A, 'select public.cancel_redemption($1)', [red1]);
ok((await state(B)).balances[B] === 50, 'cancel refunds');
const red2 = (await as(B, 'select public.redeem_reward($1) as id', [rid])).rows[0].id;
await as(A, 'select public.deliver_redemption($1)', [red2]);
sB = await state(B);
ok(sB.redemptions.find((d) => d.id === red2).status === 'delivered' && sB.redemptions[0].title === 'Massage', 'delivered + title joined');

// gifts
await as(A, `select public.gift_brownies(5, 'cute')`);
await expectError(A, 'select public.gift_brownies(0, $1)', [''], /between 1 and 500/, 'gift bounds');
sB = await state(B);
ok(sB.balances[B] === 25 && sB.earned[B] === 55, 'gift adds to balance and earned');

// RLS / direct access
const outsider = await as(C, 'select count(*)::int as n from public.tasks');
ok(outsider.rows[0].n === 0, 'outsider sees no tasks (RLS)');
const visibleProfiles = await as(C, 'select count(*)::int as n from public.profiles');
ok(visibleProfiles.rows[0].n === 1, 'outsider only sees own profile');
await expectError(B, `insert into public.activity (couple_id, kind, delta, beneficiary_id) values ($1, 'gift', 1000, $2)`, [sB.me.couple_id, B], /permission denied/, 'no direct writes to the ledger');
await expectError(B, `update public.profiles set display_name = 'x' where id = $1`, [B], /permission denied/, 'no direct profile updates');
await expectError(C, 'select public._log($1, $2, $3, $4, null, 1000, $2, $5)', [sB.me.couple_id, C, 'gift', '', ''], /permission denied/, 'internal helpers not callable');
await db.exec(`select set_config('request.jwt.claim.sub', '', false); set role anon;`);
try {
  await db.query('select public.get_state()');
  ok(false, 'signed-out visitors cannot call the API');
} catch (e) {
  ok(/permission denied/.test(e.message), `signed-out visitors cannot call the API → "${e.message}"`);
} finally {
  await db.exec('reset role;');
}

// realtime publication
const pub = await db.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`);
ok(pub.rows.map((x) => x.tablename).join(',') === 'activity,profiles', 'realtime publishes activity + profiles');

// unpair / re-pair keeps history
await as(A, 'select public.unpair()');
ok((await state(B)).partner === null, 'unpair clears partner');
const newCodeB = (await state(B)).me.pair_code;
ok(newCodeB !== codeB, 'unpair rotates pair codes');
r = await as(A, 'select public.pair_with($1) as r', [newCodeB]);
ok(r.rows[0].r.ok && (await state(B)).balances[B] === 25, 're-pairing restores the same couple and balances');

// brute-force limiter
await as(A, 'select public.unpair()');
for (let i = 0; i < 10; i++) await as(C, 'select public.pair_with($1)', ['BAD-' + i]);
r = await as(C, 'select public.pair_with($1) as r', [newCodeB]);
ok(r.rows[0].r.ok === false && /Too many tries/.test(r.rows[0].r.error), 'pairing attempts rate-limited');

// suspend / reject / restore
await as(A, 'select public.pair_with($1)', [(await state(B)).me.pair_code]);
await as(A, `select public.add_task('Water the plants', '', 5, true)`);
await as(A, 'select public.admin_set_status($1, $2, $3)', [B, 'suspended', 'Taking a break']);
let sB2 = await state(B);
ok(sB2.me.status === 'suspended' && sB2.me.status_note === 'Taking a break', 'suspended member sees their status and the note');
ok(sB2.partner === null && sB2.tasks.length === 0, 'suspended member gets no couple data');
const direct = await as(B, 'select count(*)::int as n from public.tasks');
ok(direct.rows[0].n === 0, 'suspended member cannot read couple tables directly (RLS)');
await expectError(B, "select public.add_task('x', '', 1, true)", [], /suspended/, 'suspended member cannot act');
sA = await state(A);
ok(sA.partner?.status === 'suspended' && !('status_note' in sA.partner), 'partner sees the suspension but not the note');
await as(A, 'select public.admin_set_status($1, $2, $3)', [B, 'approved', '']);
sB2 = await state(B);
ok(sB2.me.status === 'approved' && sB2.me.status_note === '' && sB2.tasks.length > 0 && sB2.partner?.id === A, 'restoring brings everything back');
await expectError(B, 'select public.admin_set_status($1, $2, $3)', [C, 'suspended', ''], /Only admins/, 'non-admins cannot suspend');
await expectError(A, 'select public.admin_set_status($1, $2, $3)', [A, 'suspended', ''], /own account status/, 'admin cannot change own status');
await expectError(A, 'select public.admin_set_status($1, $2, $3)', [C, 'banana', ''], /Unknown status/, 'unknown status rejected');
await as(A, 'select public.admin_set_status($1, $2, $3)', [D, 'rejected', 'Sorry, friends only']);
const sD = await state(D);
ok(sD.me.status === 'rejected' && sD.me.status_note === 'Sorry, friends only', 'rejected sign-up sees why');
await expectError(D, "select public.add_task('x', '', 1, true)", [], /wasn.t approved/, 'rejected account cannot act');
ok((await state(A)).admin.pending === 0, 'rejected sign-ups no longer count as waiting');

// shared tasks: both agree on a price for each person
const tid = (await as(A, "select public.create_task('Clean the toilet', '', true, 30, 10, true, null, null) as id")).rows[0].id;
let st = (await state(B)).tasks.find((t) => t.id === tid);
ok(st.shared && st.awaiting === B && st.points === 10 && st.points_other === 30, 'shared task proposed, waiting on the partner');
await expectError(A, 'select public.claim_task($1, $2)', [tid, ''], /both need to agree/, 'cannot do a shared task before agreement');
await expectError(A, 'select public.respond_shared_task($1, true)', [tid], /waiting on you/, 'proposer cannot agree to their own proposal');
await as(B, "select public.edit_task($1, 'Clean the toilet', '', 10, 40, true, null, null)", [tid]); // counter: I earn 40, you 10
st = (await state(A)).tasks.find((t) => t.id === tid);
ok(st.awaiting === A && st.points === 10 && st.points_other === 40, 'counter-offer goes back to the proposer');
await as(A, 'select public.respond_shared_task($1, true)', [tid]);
ok((await state(A)).tasks.find((t) => t.id === tid).awaiting === null, 'agreed shared task goes live');
const balB0 = (await state(B)).balances[B] ?? 0;
await as(B, 'select public.claim_task($1, $2)', [tid, '']);
let cl = (await state(A)).claims.find((c) => c.task_id === tid && c.status === 'pending');
ok(cl.points === 40, 'partner earns their own price');
await as(A, 'select public.review_claim($1, true, $2)', [cl.id, '']);
ok((await state(B)).balances[B] === balB0 + 40, 'approved shared task pays the doer');
await as(A, 'select public.claim_task($1, $2)', [tid, '']);
cl = (await state(B)).claims.find((c) => c.task_id === tid && c.status === 'pending');
ok(cl.points === 10, 'the proposer earns their own (different) price');
await as(B, 'select public.review_claim($1, false, $2)', [cl.id, '']);
const declined = (await as(B, "select public.create_task('Unclog drain', '', true, 5, 5, false, null, null) as id")).rows[0].id;
await as(A, 'select public.respond_shared_task($1, false)', [declined]);
ok(!(await state(A)).tasks.some((t) => t.id === declined), 'declined proposal disappears');

// timed tasks: 40 brownies, stale after 10h, never below 25%
const timed = (await as(A, "select public.create_task('Fold laundry', '', false, 40, null, true, 10, 25) as id")).rows[0].id;
const claimNow = async () => {
  await as(B, 'select public.claim_task($1, $2)', [timed, '']);
  const c = (await state(B)).claims.find((x) => x.task_id === timed && x.status === 'pending');
  await as(B, 'select public.withdraw_claim($1)', [c.id]);
  return c.points;
};
ok((await claimNow()) === 40, 'fresh timed task is worth full price');
async function claimOf(id) {
  await as(B, 'select public.claim_task($1, $2)', [id, '']);
  const c = (await state(B)).claims.find((x) => x.task_id === id && x.status === 'pending');
  await as(B, 'select public.withdraw_claim($1)', [c.id]);
  return c.points;
}
await db.query("update public.tasks set bumped_at = now() - interval '5 hours' where id = $1", [timed]);
ok((await claimNow()) === 25, 'half-way stale: 25% + 75% × 0.5 of 40 = 25');
await db.query("update public.tasks set bumped_at = now() - interval '30 hours' where id = $1", [timed]);
ok((await claimNow()) === 10, 'fully stale bottoms out at 25% (10)');
await expectError(B, 'select public.bump_task($1)', [timed], /Only the person who set/, 'the doer cannot warm up their own task');
await as(A, 'select public.bump_task($1)', [timed]);
ok((await claimNow()) === 40, 'warming it up makes it fresh again');
await db.query("update public.tasks set bumped_at = now() - interval '30 hours' where id = $1", [timed]);
await as(B, 'select public.claim_task($1, $2)', [timed, '']);
cl = (await state(A)).claims.find((c) => c.task_id === timed && c.status === 'pending');
await as(A, 'select public.review_claim($1, true, $2)', [cl.id, '']);
ok((await claimNow()) === 40, 'completing a repeatable timed task makes it fresh again');

// grace period: full price for 4h, then slides to 25% by 12h (40 brownies)
const graced = (await as(A, "select public.create_task('Hang the washing', '', false, 40, null, true, 12, 25, true, 4) as id")).rows[0].id;
const at = async (hours) => {
  await db.query(`update public.tasks set bumped_at = now() - interval '${hours} hours' where id = $1`, [graced]);
  return claimOf(graced);
};
ok((await at(3)) === 40, 'still full price inside the grace period');
ok((await at(8)) === 25, 'half-way through cooling: 25% + 75% × 0.5 of 40 = 25');
ok((await at(20)) === 10, 'past stale: the floor (10)');
await expectError(A, "select public.create_task('Bad', '', false, 10, null, true, 12, 25, true, 12)", [], /start cooling before/, 'grace must end before it goes stale');
await as(A, "select public.edit_task($1, 'Hang the washing', '', 40, null, true, 24, 25, 6)", [graced]);
st = (await state(A)).tasks.find((t) => t.id === graced);
ok(st.decay_grace_hours === 6 && st.decay_hours === 24, 'editing updates the grace period');
await as(A, "select public.edit_task($1, 'Hang the washing', '', 40, null, true, null, 25, 6)", [graced]);
ok((await state(A)).tasks.find((t) => t.id === graced).decay_grace_hours === 0, 'untimed tasks drop the grace period');
// stale price as a brownie amount: 40 full, 13 stale, cooling over 10h
const staled = (await as(A, "select public.create_task('Iron shirts', '', false, 40, null, true, 10, 25, true, 0, 13, null) as id")).rows[0].id;
const staleAt = async (hours) => {
  await db.query(`update public.tasks set bumped_at = now() - interval '${hours} hours' where id = $1`, [staled]);
  return claimOf(staled);
};
ok((await staleAt(0)) === 40 && (await staleAt(30)) === 13, 'stale price is an exact brownie amount (40 → 13)');
ok((await staleAt(6)) === 24, '60% of the way: 13 + (40 − 13) × 0.4 ≈ 24');
await expectError(A, "select public.create_task('Bad', '', false, 10, null, true, 10, 25, true, 0, 10, null)", [], /lower than the full price/, 'stale price must be below the full price');
await expectError(A, "select public.create_task('Bad', '', false, 10, null, true, 10, 25, true, 0, 0, null)", [], /at least 1/, 'stale price must be at least 1');
const staledShared = (await as(A, "select public.create_task('Scrub the oven', '', true, 30, 50, true, 10, 25, true, 0, 6, 20) as id")).rows[0].id;
st = (await state(B)).tasks.find((t) => t.id === staledShared);
ok(st.stale_points === 20 && st.stale_points_other === 6, 'shared task keeps a stale price for each person');
await as(B, "select public.edit_task($1, 'Scrub the oven', '', 50, 30, true, 10, 25, 0, 20, 8)", [staledShared]); // B: mine 30/8, A 50/20
st = (await state(A)).tasks.find((t) => t.id === staledShared);
ok(st.stale_points === 20 && st.stale_points_other === 8 && st.points_other === 30, 'counter-offer maps stale prices to the right person');
await as(A, "select public.update_task($1, 'Iron shirts', '', 40, true)", [staled]);
ok((await state(A)).tasks.find((t) => t.id === staled).stale_points === 13, 'the old editor keeps the stale price');
await as(A, "select public.update_task($1, 'Old editor', '', 30, true)", [timed]);
ok((await state(A)).tasks.find((t) => t.id === timed).decay_hours === 10, 'the old editor keeps timing intact');

// pausing
await as(A, 'select public.set_task_active($1, false)', [timed]);
await expectError(B, 'select public.claim_task($1, $2)', [timed, ''], /resting/, 'paused task cannot be claimed');
await expectError(B, 'select public.set_task_active($1, true)', [timed], /Only the person who set/, 'the doer cannot unpause it');
await as(A, 'select public.set_task_active($1, true)', [timed]);
ok((await state(B)).tasks.find((t) => t.id === timed).active === true, 'resumed task is live again');
await as(B, 'select public.set_task_active($1, false)', [tid]);
ok((await state(A)).tasks.find((t) => t.id === tid).active === false, 'either partner can pause a shared task');

// pre-made tasks that start resting
const premade = (await as(A, "select public.create_task('Rake the leaves', '', false, 15, null, false, 72, 25, false) as id")).rows[0].id;
ok((await state(B)).tasks.find((t) => t.id === premade).active === false, 'a task can be created already resting');
await expectError(B, 'select public.claim_task($1, $2)', [premade, ''], /resting/, 'a pre-made resting task cannot be claimed');
await as(A, 'select public.set_task_active($1, true)', [premade]);
ok((await claimOf(premade)) === 15, 'switching it on makes it live (and fresh)');
const premadeShared = (await as(B, "select public.create_task('Defrost the freezer', '', true, 20, 20, false, null, null, false) as id")).rows[0].id;
await as(A, 'select public.respond_shared_task($1, true)', [premadeShared]);
st = (await state(A)).tasks.find((t) => t.id === premadeShared);
ok(st.awaiting === null && st.active === false, 'an agreed shared task created resting stays resting');
ok((await as(A, "select public.create_task('Old-style call', '', false, 5, null, true, null, null) as id")).rows[0].id, 'calls without the new argument still work');

// editing can switch a task between live and resting
const proposal = (await as(A, "select public.create_task('Clean the gutters', '', true, 30, 30, false, null, null) as id")).rows[0].id;
await as(A, "select public.edit_task($1, 'Clean the gutters', '', 30, 30, false, null, null, 0, null, null, false)", [proposal]);
st = (await state(B)).tasks.find((t) => t.id === proposal);
ok(st.active === false && st.awaiting === B, 'a proposal can be switched to resting before it is agreed');
await as(B, 'select public.respond_shared_task($1, true)', [proposal]);
ok((await state(A)).tasks.find((t) => t.id === proposal).active === false, 'it stays resting once agreed');
await as(A, "select public.edit_task($1, 'Rake the leaves', '', 15, null, false, 72, 25, 0, null, null, true)", [premade]);
await as(A, 'select public.set_task_active($1, false)', [premade]);
await as(A, "select public.edit_task($1, 'Rake the leaves', '', 15, null, false, 72, 25)", [premade]);
ok((await state(A)).tasks.find((t) => t.id === premade).active === false, 'edits without the status leave it as it was');
await as(A, "select public.edit_task($1, 'Rake the leaves', '', 15, null, false, 72, 25, 0, null, null, true)", [premade]);
ok((await state(A)).tasks.find((t) => t.id === premade).active === true, 'editing can switch it back on');

// personal ordering
await as(B, 'select public.set_task_order($1::uuid[])', [[timed, tid]]);
const orderB = (await state(B)).me.task_order;
ok(orderB[0] === timed && orderB[1] === tid, 'personal task order is saved');

// wishes lock once priced
const wid = (await as(B, "select public.add_reward('Foot rub', '', '🦶') as id")).rows[0].id;
await as(B, "select public.update_reward($1, 'Long foot rub', '', '🦶')", [wid]);
await as(A, 'select public.price_reward($1, 20)', [wid]);
await expectError(B, "select public.update_reward($1, 'Foot rub forever', '', '🦶')", [wid], /locked/, 'a priced wish can no longer be edited');

// admin removes accounts
await expectError(A, 'select public.admin_remove_user($1)', [A], /own account/, 'admin cannot remove themselves');
await as(A, 'select public.admin_remove_user($1)', [B]);
sA = await state(A);
ok(sA.partner === null && sA.me.couple_id === null, 'removing someone unpairs their partner');
const leftovers = await db.query(
  `select (select count(*) from auth.users where id = $1)::int
        + (select count(*) from public.tasks where created_by = $1 or assigned_to = $1)::int
        + (select count(*) from public.rewards where wished_by = $1)::int as n`,
  [B],
);
ok(leftovers.rows[0].n === 0, 'removed account and everything it created are gone');
await as(A, 'select public.admin_remove_user($1)', [D]);
ok(!(await as(A, 'select public.admin_list_users() as l')).rows[0].l.some((u) => u.id === D), 'admin deletes a rejected sign-up');

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
