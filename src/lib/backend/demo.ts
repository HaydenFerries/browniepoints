// A complete, in-browser stand-in for the Supabase backend. Data lives in
// localStorage, the signed-in person is per browser tab (sessionStorage), and
// tabs notify each other through a BroadcastChannel, so two tabs can play the
// two partners. The rules themselves live in rules.ts (shared with offline mode).
import type { Activity, AdminUser, Reward, Task, UUID } from '../types';
import type { AuthEvent, Backend } from './types';
import { createOfflineLayer } from './offline';
import {
  emptyDb, isApproved, log, now, Oops, rules, snapshot, statusOf, strip, uid,
  type Couple, type DB, type RuleArgs, type RuleName, type RuleUser as DemoUser,
} from './rules';

const DB_KEY = 'bp-demo-db-v1';
const SESSION_KEY = 'bp-demo-session';
const LAST_KEY = 'bp-demo-last-user';
const OFFLINE_KEY = 'bp-demo-offline'; // "pretend I'm offline", per tab

const BLOCKED_MESSAGE = {
  pending: 'Your account is still waiting for approval.',
  suspended: 'Your account is suspended.',
  rejected: 'Your sign-up wasn’t approved.',
} as const;

function load(): DB {
  try {
    const raw = localStorage.getItem(DB_KEY);
    return raw ? { ...emptyDb(), ...JSON.parse(raw) } : emptyDb();
  } catch {
    return emptyDb();
  }
}
function save(db: DB) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

async function hash(password: string) {
  const bytes = new TextEncoder().encode('brownie-demo:' + password);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const WORDS = ['FUDGE', 'COCOA', 'GOOEY', 'CRUMB', 'TRUFFLE', 'CARAMEL', 'PECAN', 'MOCHA',
  'SWIRL', 'GANACHE', 'TOFFEE', 'HAZEL', 'BUTTER', 'SUGAR', 'VELVET', 'SPRINKLE'];
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function pairCode(db: DB) {
  for (;;) {
    const b = crypto.getRandomValues(new Uint8Array(6));
    let code = WORDS[b[5] % 16] + '-';
    for (let i = 0; i < 5; i++) code += ALPHABET[b[i] % 32];
    if (!db.users.some((u) => u.pair_code === code)) return code;
  }
}

export function createDemoBackend(): Backend {
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('bp-demo') : null;
  const authListeners = new Set<(id: UUID | null, e: AuthEvent) => void>();

  const session = {
    get(): UUID | null {
      const id = sessionStorage.getItem(SESSION_KEY) ?? localStorage.getItem(LAST_KEY);
      if (id && !load().users.some((u) => u.id === id)) return null;
      return id;
    },
    set(id: UUID | null) {
      if (id) {
        sessionStorage.setItem(SESSION_KEY, id);
        localStorage.setItem(LAST_KEY, id);
      } else {
        sessionStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(LAST_KEY);
      }
      authListeners.forEach((cb) => cb(id, id ? 'SIGNED_IN' : 'SIGNED_OUT'));
    },
  };

  function meOf(db: DB, allowPending = false): DemoUser {
    const id = session.get();
    const me = db.users.find((u) => u.id === id);
    if (!me) throw new Oops('Please sign in again.');
    const st = statusOf(me);
    if (!allowPending && st !== 'approved') throw new Oops(BLOCKED_MESSAGE[st]);
    return me;
  }
  function adminOf(db: DB): DemoUser {
    const me = meOf(db);
    if (!me.is_admin) throw new Oops('Only admins can do that.');
    return me;
  }
  /** Run a change against a fresh copy of the DB, save it, and tell other tabs. */
  async function mutate<T>(fn: (db: DB, me: DemoUser) => T | { result: T; activity?: Activity }): Promise<T> {
    const db = load();
    const me = meOf(db);
    const lenBefore = db.activity.length;
    const out = fn(db, me);
    save(db);
    const activity = db.activity.length > lenBefore ? db.activity[db.activity.length - 1] : undefined;
    channel?.postMessage({ couple: activity?.couple_id ?? me.couple_id, users: db.users.filter((u) => u.couple_id === me.couple_id || u.id === me.id).map((u) => u.id), activity });
    await new Promise((r) => setTimeout(r, 120)); // feel like a network round-trip
    return out as T;
  }

  const trim = (s: string | null | undefined) => (s ?? '').trim();

  // The same offline mode as the real app, with this browser as "the server"
  // and a switch to pretend the connection is gone.
  let pretendOffline = sessionStorage.getItem(OFFLINE_KEY) === '1';
  const unreachable = () => new Error('Failed to fetch (pretend offline)');
  const offline = createOfflineLayer({
    userId: async () => session.get(),
    isOnline: () => !pretendOffline && navigator.onLine !== false,
    async fetchState() {
      if (pretendOffline) throw unreachable();
      const db = load();
      return snapshot(db, meOf(db, true));
    },
    async send(op) {
      if (pretendOffline) throw unreachable();
      await mutate((db, me) => {
        db.applied ??= [];
        if (db.applied.includes(op.id)) return; // already done (a retry)
        if (op.base) {
          const row = (op.base.table === 'tasks' ? db.tasks : db.rewards).find((x) => x.id === op.base!.id);
          if (row && (row.version ?? 1) !== op.base.version && row.last_editor && row.last_editor !== me.id) {
            const who = db.users.find((u) => u.id === row.last_editor)?.display_name ?? 'Your partner';
            throw new Oops(`CONFLICT: ${who} changed this since`);
          }
        }
        (rules[op.method] as (db: DB, me: DemoUser, ...a: unknown[]) => unknown)(db, me, ...op.args);
        db.applied = [...db.applied.slice(-499), op.id];
      });
    },
  });
  /** The same change, run through the shared rules (queued while "offline"). */
  const run = <K extends RuleName>(name: K) => ((...args: RuleArgs<K>) => offline.run(name, args, name, {})) as never;

  const backend: Backend = {
    mode: 'demo',
    sync: offline.sync,

    async currentUserId() {
      return session.get();
    },
    async currentEmail() {
      const id = session.get();
      return load().users.find((u) => u.id === id)?.email ?? null;
    },
    onAuthChange(cb) {
      authListeners.add(cb);
      return () => authListeners.delete(cb);
    },

    async signUp({ email, password, displayName, avatar }) {
      const db = load();
      const e = trim(email).toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(e)) throw new Oops('That email doesn’t look quite right.');
      if (password.length < 6) throw new Oops('Passwords need at least 6 characters.');
      if (db.users.some((u) => u.email === e)) throw new Oops('There’s already an account with that email. Try signing in.');
      const user: DemoUser = {
        id: uid(),
        email: e,
        password_hash: await hash(password),
        display_name: trim(displayName).slice(0, 40) || e.split('@')[0],
        avatar: avatar || '🍫',
        pair_code: pairCode(db),
        couple_id: null,
        created_at: now(),
        // The very first account in a fresh demo runs the place; everyone after waits.
        status: db.users.length === 0 ? 'approved' : 'pending',
        is_admin: db.users.length === 0,
        last_sign_in_at: now(),
      };
      db.users.push(user);
      save(db);
      session.set(user.id);
      return { needsConfirmation: false };
    },

    async signIn(email, password) {
      const db = load();
      const user = db.users.find((u) => u.email === trim(email).toLowerCase());
      if (!user || user.password_hash !== (await hash(password))) throw new Oops('That email and password don’t match.');
      user.last_sign_in_at = now();
      save(db);
      session.set(user.id);
    },

    async signOut() {
      session.set(null);
    },
    async requestPasswordReset() {
      throw new Oops('Password resets need the real app. In the demo, just make a new account.');
    },
    async updatePassword() {},


    getState: () => offline.getState(),


    subscribe(me, coupleId, onChange) {
      if (!channel) return () => {};
      const handler = (ev: MessageEvent) => {
        const msg = ev.data as { couple: UUID | null; users: UUID[]; activity?: Activity };
        if ((coupleId && msg.couple === coupleId) || msg.users?.includes(me)) onChange(msg.activity);
      };
      channel.addEventListener('message', handler);
      return () => channel.removeEventListener('message', handler);
    },



    pairWith: (code) =>
      mutate((db, me) => {
        const norm = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (me.couple_id) return { ok: false, error: 'You’re already paired up.' };
        const other = db.users.find((u) => u.pair_code.replace('-', '') === norm && isApproved(u));
        if (!other) return { ok: false, error: 'That code doesn’t match anyone. Double-check it?' };
        if (other.id === me.id) return { ok: false, error: 'That’s your own code! Send it to your partner instead.' };
        if (other.couple_id) return { ok: false, error: 'That person is already paired with someone.' };
        const [a, b] = [me.id, other.id].sort();
        let couple = db.couples.find((c) => c.member_a === a && c.member_b === b);
        if (!couple) {
          couple = { id: uid(), member_a: a, member_b: b, created_at: now() };
          db.couples.push(couple);
        }
        for (const u of db.users) if (u.id === me.id || u.id === other.id) u.couple_id = couple.id;
        log(db, couple.id, me.id, 'paired', '', null, null, other.id);
        return { ok: true };
      }),

    unpair: () =>
      mutate((db, me) => {
        if (!me.couple_id) return;
        log(db, me.couple_id, me.id, 'unpaired', '', null, null, null);
        for (const u of db.users)
          if (u.couple_id === me.couple_id) {
            u.couple_id = null;
            u.pair_code = pairCode(db);
          }
      }),

    newPairCode: () =>
      mutate((db, me) => {
        const code = pairCode(db);
        db.users.find((u) => u.id === me.id)!.pair_code = code;
        return code;
      }),


    updateProfile: run('updateProfile'),
    createTask: (t) => offline.run('createTask', [t, uid()], 'createTask', {}),
    editTask: run('editTask'),
    respondShared: run('respondShared'),
    setTaskActive: run('setTaskActive'),
    bumpTask: run('bumpTask'),
    setTaskOrder: run('setTaskOrder'),
    removeTask: run('removeTask'),
    claimTask: (id, note) => offline.run('claimTask', [id, note, now()], 'claimTask', {}),
    withdrawClaim: run('withdrawClaim'),
    reviewClaim: run('reviewClaim'),
    addReward: (r) => offline.run('addReward', [r, uid()], 'addReward', {}),
    updateReward: run('updateReward'),
    removeReward: run('removeReward'),
    priceReward: run('priceReward'),
    redeemReward: run('redeemReward'),
    cancelRedemption: run('cancelRedemption'),
    deliverRedemption: run('deliverRedemption'),
    giftBrownies: run('giftBrownies'),


    async adminListUsers(): Promise<AdminUser[]> {
      const db = load();
      adminOf(db);
      const rows = db.users.map((u) => ({
        id: u.id,
        display_name: u.display_name,
        avatar: u.avatar,
        status: statusOf(u),
        status_note: u.status_note ?? '',
        status_changed_at: u.status_changed_at ?? null,
        is_admin: !!u.is_admin,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
        email_confirmed_at: u.created_at,
        partner_name: u.couple_id ? db.users.find((p) => p.couple_id === u.couple_id && p.id !== u.id)?.display_name ?? null : null,
      }));
      const rank = { pending: 0, approved: 1, suspended: 2, rejected: 2 };
      return rows.sort((x, y) => rank[x.status] - rank[y.status] || y.created_at.localeCompare(x.created_at));
    },

    adminSetStatus: async (id, status, note) => {
      await mutate((db, me) => {
        adminOf(db);
        if (id === me.id) throw new Oops('You can’t change your own account status.');
        const u = db.users.find((x) => x.id === id);
        if (!u) throw new Oops('That account doesn’t exist any more.');
        u.status = status;
        u.status_note = status === 'approved' ? '' : trim(note).slice(0, 300);
        u.status_changed_at = now();
      });
      channel?.postMessage({ couple: null, users: [id] });
    },

    adminRemove: async (id) => {
      await mutate((db, me) => {
        adminOf(db);
        if (id === me.id) throw new Oops('You can’t remove your own account from here.');
        const victim = db.users.find((u) => u.id === id);
        if (!victim) return;
        if (victim.couple_id) {
          log(db, victim.couple_id, null, 'unpaired', '', null, null, null);
          for (const u of db.users)
            if (u.couple_id === victim.couple_id) {
              u.couple_id = null;
              u.pair_code = pairCode(db);
            }
        }
        // the same cascade the database does
        const theirTasks = new Set(db.tasks.filter((t) => t.created_by === id || t.assigned_to === id).map((t) => t.id));
        const theirRewards = new Set(db.rewards.filter((r) => r.wished_by === id).map((r) => r.id));
        db.tasks = db.tasks.filter((t) => !theirTasks.has(t.id));
        db.claims = db.claims.filter((c) => !theirTasks.has(c.task_id) && c.claimed_by !== id);
        db.rewards = db.rewards.filter((r) => !theirRewards.has(r.id));
        db.redemptions = db.redemptions.filter((d) => !theirRewards.has(d.reward_id) && d.redeemed_by !== id);
        for (const a of db.activity) {
          if (a.actor_id === id) a.actor_id = null;
          if (a.beneficiary_id === id) a.beneficiary_id = null;
        }
        db.users = db.users.filter((u) => u.id !== id);
      });
      channel?.postMessage({ couple: null, users: [id] });
    },

    demo: {
      async seed() {
        const db = load();
        // Always in the past: later "hours" are closer to now.
        const at = (daysAgo: number, hour = 12) =>
          new Date(Date.now() - daysAgo * 86_400_000 - (24 - hour) * 17 * 60_000 - Math.random() * 600_000).toISOString();
        const mk = async (name: string, avatar: string, email: string): Promise<DemoUser> => ({
          id: uid(), email, password_hash: await hash('brownies'), display_name: name, avatar,
          pair_code: pairCode(db), couple_id: null, created_at: at(14),
        });
        const alex = { ...(await mk('Alex', '🧁', 'alex@example.com')), status: 'approved' as const, is_admin: true };
        const sam = { ...(await mk('Sam', '🍓', 'sam@example.com')), status: 'approved' as const };
        // two sign-ups waiting in the admin portal
        for (const [name, avatar, hoursAgo] of [['Morgan', '🦊', 3], ['Jordan', '🐻', 26]] as const) {
          db.users.push({
            ...(await mk(name, avatar, `${name.toLowerCase()}@example.com`)),
            status: 'pending',
            created_at: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
          });
        }
        const [a, b] = [alex.id, sam.id].sort();
        const couple: Couple = { id: uid(), member_a: a, member_b: b, created_at: at(14) };
        alex.couple_id = sam.couple_id = couple.id;
        db.users.push(alex, sam);
        db.couples.push(couple);
        const C = couple.id;
        log(db, C, alex.id, 'paired', '', null, null, sam.id, '', at(14, 9));

        const task = (by: DemoUser, to: DemoUser, title: string, details: string, points: number, repeatable: boolean, daysAgo: number): Task => {
          const t: Task = { id: uid(), couple_id: C, created_by: by.id, assigned_to: to.id, title, details, points, repeatable, status: 'open', created_at: at(daysAgo, 10), updated_at: at(daysAgo, 10) };
          db.tasks.push(t);
          log(db, C, by.id, 'task_added', title, points, null, to.id, '', t.created_at);
          return t;
        };
        const approve = (t: Task, daysAgo: number, note = '') => {
          db.claims.push({ id: uid(), couple_id: C, task_id: t.id, claimed_by: t.assigned_to!, points: t.points, note: '', status: 'approved', created_at: at(daysAgo, 18), resolved_at: at(daysAgo, 20) });
          log(db, C, t.assigned_to!, 'task_claimed', t.title, t.points, null, t.assigned_to, '', at(daysAgo, 18));
          log(db, C, t.created_by, 'task_approved', t.title, t.points, t.points, t.assigned_to, note, at(daysAgo, 20));
          if (!t.repeatable) t.status = 'done';
        };
        const wish = (by: DemoUser, emoji: string, title: string, details: string, price: number | null, daysAgo: number): Reward => {
          const r: Reward = { id: uid(), couple_id: C, wished_by: by.id, title, details, emoji, price, archived: false, created_at: at(daysAgo, 11), priced_at: price ? at(daysAgo, 13) : null };
          db.rewards.push(r);
          const other = by.id === alex.id ? sam : alex;
          log(db, C, by.id, 'reward_added', title, null, null, other.id, '', r.created_at);
          if (price) log(db, C, other.id, 'reward_priced', title, price, null, by.id, '', r.priced_at!);
          return r;
        };

        // Tasks Alex set for Sam
        const dishes = task(alex, sam, 'Do the dishes after dinner', 'Including the pots. Yes, the pots.', 10, true, 12);
        const date = task(alex, sam, 'Plan a surprise date night', 'Somewhere we haven’t been before.', 40, false, 11);
        task(alex, sam, 'Fold the laundry mountain', '', 15, true, 9);
        // Tasks Sam set for Alex
        const pancakes = task(sam, alex, 'Sunday pancakes', 'Fluffy ones, with berries.', 20, true, 12);
        const bins = task(sam, alex, 'Take the bins out', '', 5, true, 10);
        task(sam, alex, 'Clean out the car', 'Every crumb. You know which crumbs.', 30, false, 6);

        dishes.sleep_hours = 12; // not dirty again straight away
        approve(dishes, 10);
        approve(date, 7, 'Best night ever 🥰');
        approve(dishes, 5);
        approve(pancakes, 8, 'Perfect stack!');
        approve(bins, 6);
        approve(bins, 3);
        approve(bins, 2);
        approve(pancakes, 1);

        // A timed task that's been cooling for a while, and one that's resting
        const plants = task(alex, sam, 'Water the plants', 'Before they give up on us.', 20, true, 3);
        Object.assign(plants, { decay_hours: 72, decay_floor_pct: 25, bumped_at: at(1, 6) });
        const lawn = task(sam, alex, 'Mow the lawn', 'Only when it’s jungle-length.', 25, true, 9);
        lawn.active = false;
        log(db, C, sam.id, 'task_paused', lawn.title, null, null, null, '', at(2, 9));

        // Shared jobs: one agreed (Alex hates the toilet, so earns more), one waiting on Alex
        const toilet: Task = {
          id: uid(), couple_id: C, created_by: sam.id, assigned_to: null, shared: true, title: 'Clean the toilet',
          details: 'The full scrub, including behind it.', points: 15, points_other: 40, awaiting: null, active: true,
          repeatable: true, status: 'open', created_at: at(5, 10), updated_at: at(4, 12), decay_hours: null, decay_floor_pct: 25, bumped_at: at(4, 12),
        };
        db.tasks.push(toilet);
        log(db, C, sam.id, 'shared_proposed', toilet.title, 40, null, alex.id, '', at(5, 10));
        log(db, C, alex.id, 'shared_agreed', toilet.title, null, null, null, '', at(4, 12));
        const proposedAt = at(0, 8);
        const groceries: Task = {
          id: uid(), couple_id: C, created_by: sam.id, assigned_to: null, shared: true, title: 'Big grocery run',
          details: 'The whole list, not just snacks.', points: 15, points_other: 20, awaiting: alex.id, active: true,
          repeatable: true, status: 'open', created_at: proposedAt, updated_at: proposedAt, decay_hours: 168, decay_floor_pct: 25, bumped_at: proposedAt,
        };
        db.tasks.push(groceries);
        log(db, C, sam.id, 'shared_proposed', groceries.title, 20, null, alex.id, '', proposedAt);

        // Wishes
        const massage = wish(alex, '💆', 'Back massage', '20 minutes, no rushing.', 30, 9);
        wish(alex, '🥞', 'Breakfast in bed', '', 50, 7);
        wish(alex, '🎬', 'I pick the movie', 'No vetoes allowed.', null, 1);
        const sleepIn = wish(sam, '😴', 'Sleep in on Saturday', 'You handle the morning.', 25, 8);
        wish(sam, '🍫', 'Homemade brownies', 'The gooey kind.', null, 0);
        wish(sam, '🍝', 'Dinner at our spot', '', 80, 6);

        // A delivered massage for Alex in the past
        db.redemptions.push({ id: uid(), couple_id: C, reward_id: massage.id, redeemed_by: alex.id, price: 30, status: 'delivered', created_at: at(4, 19), resolved_at: at(4, 21) });
        log(db, C, alex.id, 'reward_redeemed', massage.title, 30, -30, alex.id, '', at(4, 19));
        log(db, C, sam.id, 'redemption_delivered', massage.title, 30, null, alex.id, '', at(4, 21));

        log(db, C, sam.id, 'gift', '', 5, 5, alex.id, 'For being extra cute today', at(2, 15));

        // Things waiting on Alex right now
        db.redemptions.push({ id: uid(), couple_id: C, reward_id: sleepIn.id, redeemed_by: sam.id, price: 25, status: 'pending', created_at: at(0, 9), resolved_at: null });
        log(db, C, sam.id, 'reward_redeemed', sleepIn.title, 25, -25, sam.id, '', at(0, 9));
        db.claims.push({ id: uid(), couple_id: C, task_id: dishes.id, claimed_by: sam.id, points: 10, note: 'Sparkling ✨', status: 'pending', created_at: at(0, 10), resolved_at: null });
        log(db, C, sam.id, 'task_claimed', dishes.title, 10, null, sam.id, 'Sparkling ✨', at(0, 10));

        db.activity.sort((x, y) => x.created_at.localeCompare(y.created_at));
        db.activity.forEach((x, i) => (x.id = i + 1));
        db.seq = db.activity.length + 1;
        save(db);
        session.set(alex.id);
      },
      users() {
        const db = load();
        const id = session.get();
        const me = db.users.find((u) => u.id === id);
        return db.users.filter((u) => u.id === id || (me?.couple_id && u.couple_id === me.couple_id)).map(strip);
      },
      async switchUser(id) {
        session.set(id);
      },
      reset() {
        const id = session.get();
        localStorage.removeItem(DB_KEY);
        if (id) offline.forget(id);
        session.set(null);
      },
      offline: () => pretendOffline,
      async setOffline(on) {
        pretendOffline = on;
        sessionStorage.setItem(OFFLINE_KEY, on ? '1' : '0');
        await offline.sync.flush();
      },
    },
  };
  return backend;
}
