// A complete, in-browser stand-in for the Supabase backend. Data lives in
// localStorage, the signed-in person is per browser tab (sessionStorage), and
// tabs notify each other through a BroadcastChannel, so two tabs can play the
// two partners. The rules here mirror the SQL functions in supabase/migrations.
import type {
  Activity,
  ActivityKind,
  AdminUser,
  AppState,
  Claim,
  Profile,
  Redemption,
  Reward,
  RewardInput,
  Task,
  TaskInput,
  UUID,
} from '../types';
import type { AuthEvent, Backend } from './types';
import { canManage, isActive, taskValue } from '../tasks';

const DB_KEY = 'bp-demo-db-v1';
const SESSION_KEY = 'bp-demo-session';
const LAST_KEY = 'bp-demo-last-user';

interface DemoUser extends Profile {
  email: string;
  password_hash: string;
  pair_code: string;
  last_sign_in_at?: string;
  status_changed_at?: string;
}
// Users saved before invite-only existed have no status: treat them as approved.
const statusOf = (u: Profile) => u.status ?? 'approved';
const isApproved = (u: Profile) => statusOf(u) === 'approved';
const BLOCKED_MESSAGE = {
  pending: 'Your account is still waiting for approval.',
  suspended: 'Your account is suspended.',
  rejected: 'Your sign-up wasn’t approved.',
} as const;
interface Couple {
  id: UUID;
  member_a: UUID;
  member_b: UUID;
  created_at: string;
}
type StoredRedemption = Omit<Redemption, 'title' | 'emoji'>;
interface DB {
  users: DemoUser[];
  couples: Couple[];
  tasks: Task[];
  claims: Claim[];
  rewards: Reward[];
  redemptions: StoredRedemption[];
  activity: Activity[];
  seq: number;
}

const emptyDb = (): DB => ({ users: [], couples: [], tasks: [], claims: [], rewards: [], redemptions: [], activity: [], seq: 1 });

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

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

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

class Oops extends Error {}

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
  function partnerOf(db: DB, me: DemoUser): DemoUser {
    if (!me.couple_id) throw new Oops('Pair up with your partner first.');
    const p = db.users.find((u) => u.couple_id === me.couple_id && u.id !== me.id);
    if (!p) throw new Oops('Your partner isn’t here any more.');
    return p;
  }
  function log(
    db: DB,
    couple: UUID,
    actor: UUID | null,
    kind: ActivityKind,
    title: string,
    value: number | null,
    delta: number | null,
    beneficiary: UUID | null,
    note = '',
    at = now(),
  ): Activity {
    const a: Activity = { id: db.seq++, couple_id: couple, actor_id: actor, kind, title, value, delta, beneficiary_id: beneficiary, note, created_at: at };
    db.activity.push(a);
    return a;
  }
  const balance = (db: DB, couple: UUID, user: UUID) =>
    db.activity.filter((a) => a.couple_id === couple && a.beneficiary_id === user && a.delta != null).reduce((s, a) => s + (a.delta ?? 0), 0);

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

  const strip = ({ email: _e, password_hash: _p, last_sign_in_at: _l, ...profile }: DemoUser): Profile => profile;
  const trim = (s: string | null | undefined) => (s ?? '').trim();

  const backend: Backend = {
    mode: 'demo',

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

    async getState(): Promise<AppState> {
      const db = load();
      const me = meOf(db, true);
      if (!isApproved(me)) {
        const { pair_code: _code, ...waiting } = strip(me);
        return { me: waiting, partner: null, tasks: [], claims: [], rewards: [], redemptions: [], activity: [], balances: {}, earned: {}, admin: null };
      }
      const c = me.couple_id;
      const partner = c ? db.users.find((u) => u.couple_id === c && u.id !== me.id) ?? null : null;
      const byNewest = <T extends { created_at: string }>(a: T, b: T) => b.created_at.localeCompare(a.created_at);
      const balances: Record<UUID, number> = {};
      const earned: Record<UUID, number> = {};
      for (const a of db.activity) {
        if (a.couple_id !== c || a.delta == null || !a.beneficiary_id) continue;
        balances[a.beneficiary_id] = (balances[a.beneficiary_id] ?? 0) + a.delta;
        if (a.delta > 0 && (a.kind === 'task_approved' || a.kind === 'gift'))
          earned[a.beneficiary_id] = (earned[a.beneficiary_id] ?? 0) + a.delta;
      }
      const meProfile = strip(me);
      let partnerProfile: Profile | null = null;
      if (partner) {
        const { pair_code: _code, status_note: _note, ...rest } = strip(partner);
        partnerProfile = rest;
      }
      return {
        me: meProfile,
        partner: partnerProfile,
        tasks: db.tasks.filter((t) => t.couple_id === c && t.status !== 'archived').sort(byNewest),
        claims: db.claims.filter((x) => x.couple_id === c).sort(byNewest).slice(0, 200),
        rewards: db.rewards.filter((r) => r.couple_id === c && !r.archived).sort(byNewest),
        redemptions: db.redemptions
          .filter((d) => d.couple_id === c)
          .sort(byNewest)
          .slice(0, 200)
          .map((d) => {
            const r = db.rewards.find((x) => x.id === d.reward_id);
            return { ...d, title: r?.title ?? '', emoji: r?.emoji ?? '🎁' };
          }),
        activity: db.activity.filter((a) => a.couple_id === c).sort((a, b) => b.id - a.id).slice(0, 200),
        balances,
        earned,
        admin: me.is_admin ? { pending: db.users.filter((u) => statusOf(u) === 'pending').length } : null,
      };
    },

    subscribe(me, coupleId, onChange) {
      if (!channel) return () => {};
      const handler = (ev: MessageEvent) => {
        const msg = ev.data as { couple: UUID | null; users: UUID[]; activity?: Activity };
        if ((coupleId && msg.couple === coupleId) || msg.users?.includes(me)) onChange(msg.activity);
      };
      channel.addEventListener('message', handler);
      return () => channel.removeEventListener('message', handler);
    },

    updateProfile: (displayName, avatar) =>
      mutate((db, me) => {
        const n = trim(displayName);
        if (!n || n.length > 40) throw new Oops('Names need to be between 1 and 40 characters.');
        const u = db.users.find((x) => x.id === me.id)!;
        u.display_name = n;
        u.avatar = trim(avatar) || u.avatar;
      }),

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

    createTask: (t: TaskInput) =>
      mutate((db, me) => {
        const partner = partnerOf(db, me);
        validateTask(t);
        const base = {
          id: uid(), couple_id: me.couple_id!, created_by: me.id, title: trim(t.title), details: trim(t.details),
          repeatable: t.repeatable, status: 'open' as const, created_at: now(), updated_at: now(),
          active: true, decay_hours: t.decayHours, decay_floor_pct: t.decayFloor, bumped_at: now(),
        };
        if (t.shared) {
          db.tasks.push({ ...base, shared: true, assigned_to: null, points: t.myPoints!, points_other: t.partnerPoints, awaiting: partner.id });
          log(db, me.couple_id!, me.id, 'shared_proposed', trim(t.title), t.partnerPoints, null, partner.id);
        } else {
          db.tasks.push({ ...base, shared: false, assigned_to: partner.id, points: t.partnerPoints, points_other: null, awaiting: null });
          log(db, me.couple_id!, me.id, 'task_added', trim(t.title), t.partnerPoints, null, partner.id);
        }
      }),

    editTask: (id, t) =>
      mutate((db, me) => {
        const partner = partnerOf(db, me);
        const task = db.tasks.find((x) => x.id === id && x.couple_id === me.couple_id && x.status === 'open');
        if (!task) throw new Oops('That task isn’t around any more.');
        validateTask({ ...t, shared: !!task.shared });
        const common = {
          title: trim(t.title), details: trim(t.details), repeatable: t.repeatable,
          decay_hours: t.decayHours, decay_floor_pct: t.decayFloor, updated_at: now(),
        };
        if (task.shared) {
          const mine = me.id === task.created_by;
          Object.assign(task, common, {
            points: mine ? t.myPoints! : t.partnerPoints,
            points_other: mine ? t.partnerPoints : t.myPoints!,
            awaiting: partner.id,
          });
          log(db, me.couple_id!, me.id, 'shared_changed', task.title, t.partnerPoints, null, partner.id);
        } else {
          if (task.created_by !== me.id) throw new Oops('Only the person who set a task can change it.');
          Object.assign(task, common, { points: t.partnerPoints });
          log(db, me.couple_id!, me.id, 'task_updated', task.title, t.partnerPoints, null, task.assigned_to);
        }
      }),

    respondShared: (id, accept) =>
      mutate((db, me) => {
        const task = db.tasks.find((x) => x.id === id && x.couple_id === me.couple_id && x.status === 'open');
        if (!task || !task.shared) throw new Oops('That proposal isn’t around any more.');
        if (task.awaiting !== me.id) throw new Oops('This one isn’t waiting on you.');
        if (accept) Object.assign(task, { awaiting: null, bumped_at: now(), updated_at: now() });
        else Object.assign(task, { status: 'archived', updated_at: now() });
        log(db, me.couple_id!, me.id, accept ? 'shared_agreed' : 'shared_declined', task.title, null, null, null);
      }),

    setTaskActive: (id, active) =>
      mutate((db, me) => {
        const task = db.tasks.find((x) => x.id === id && x.couple_id === me.couple_id && x.status === 'open');
        if (!task) throw new Oops('That task isn’t around any more.');
        if (!canManage(task, me.id)) throw new Oops('Only the person who set a task can pause it.');
        if (isActive(task) === active) return;
        Object.assign(task, { active, updated_at: now() }, active ? { bumped_at: now() } : {});
        log(db, me.couple_id!, me.id, active ? 'task_resumed' : 'task_paused', task.title, null, null, null);
      }),

    bumpTask: (id) =>
      mutate((db, me) => {
        const task = db.tasks.find((x) => x.id === id && x.couple_id === me.couple_id && x.status === 'open');
        if (!task) throw new Oops('That task isn’t around any more.');
        if (!task.decay_hours) throw new Oops('That task doesn’t go stale.');
        if (!canManage(task, me.id)) throw new Oops('Only the person who set a task can warm it up.');
        Object.assign(task, { bumped_at: now(), updated_at: now() });
        log(db, me.couple_id!, me.id, 'task_bumped', task.title, null, null, null);
      }),

    setTaskOrder: (ids) =>
      mutate((db, me) => {
        db.users.find((u) => u.id === me.id)!.task_order = ids.slice(0, 500);
      }),

    removeTask: (id) =>
      mutate((db, me) => {
        const task = db.tasks.find((x) => x.id === id && x.couple_id === me.couple_id && x.status !== 'archived');
        if (!task) return;
        if (!canManage(task, me.id)) throw new Oops('Only the person who set a task can remove it.');
        for (const c of db.claims) if (c.task_id === id && c.status === 'pending') Object.assign(c, { status: 'withdrawn', resolved_at: now() });
        task.status = 'archived';
        log(db, me.couple_id!, me.id, 'task_removed', task.title, task.points, null, task.assigned_to);
      }),

    claimTask: (id, note) =>
      mutate((db, me) => {
        partnerOf(db, me);
        const task = db.tasks.find((x) => x.id === id && x.couple_id === me.couple_id);
        if (!task || task.status !== 'open') throw new Oops('That task isn’t available any more.');
        if (task.shared) {
          if (task.awaiting) throw new Oops('You both need to agree on this one first.');
        } else if (task.assigned_to !== me.id) throw new Oops('This task is for your partner, not you.');
        if (!isActive(task)) throw new Oops('That task is resting right now.');
        if (db.claims.some((c) => c.task_id === id && c.status === 'pending')) throw new Oops('Already marked as done. Waiting on approval.');
        const value = taskValue(task, me.id);
        db.claims.push({ id: uid(), couple_id: me.couple_id!, task_id: id, claimed_by: me.id, points: value, note: trim(note), status: 'pending', created_at: now(), resolved_at: null });
        log(db, me.couple_id!, me.id, 'task_claimed', task.title, value, null, me.id, trim(note));
      }),

    withdrawClaim: (id) =>
      mutate((db, me) => {
        const claim = db.claims.find((c) => c.id === id && c.couple_id === me.couple_id);
        if (!claim || claim.status !== 'pending') return;
        if (claim.claimed_by !== me.id) throw new Oops('Only the person who claimed this can undo it.');
        Object.assign(claim, { status: 'withdrawn', resolved_at: now() });
        const task = db.tasks.find((t) => t.id === claim.task_id);
        log(db, me.couple_id!, me.id, 'claim_withdrawn', task?.title ?? '', claim.points, null, me.id);
      }),

    reviewClaim: (id, approve, note) =>
      mutate((db, me) => {
        const claim = db.claims.find((c) => c.id === id && c.couple_id === me.couple_id);
        if (!claim || claim.status !== 'pending') throw new Oops('That one’s already been reviewed.');
        if (claim.claimed_by === me.id) throw new Oops('Nice try! Your partner has to approve your own tasks.');
        const task = db.tasks.find((t) => t.id === claim.task_id)!;
        if (approve) {
          Object.assign(claim, { status: 'approved', resolved_at: now() });
          if (!task.repeatable) Object.assign(task, { status: 'done', updated_at: now() });
          else if (task.decay_hours) task.bumped_at = now(); // done, so it starts fresh again
          log(db, me.couple_id!, me.id, 'task_approved', task.title, claim.points, claim.points, claim.claimed_by, trim(note));
        } else {
          Object.assign(claim, { status: 'declined', resolved_at: now() });
          log(db, me.couple_id!, me.id, 'task_declined', task.title, claim.points, null, claim.claimed_by, trim(note));
        }
      }),

    addReward: (r: RewardInput) =>
      mutate((db, me) => {
        const partner = partnerOf(db, me);
        validateReward(r);
        db.rewards.push({
          id: uid(), couple_id: me.couple_id!, wished_by: me.id, title: trim(r.title), details: trim(r.details),
          emoji: trim(r.emoji) || '🎁', price: null, archived: false, created_at: now(), priced_at: null,
        });
        log(db, me.couple_id!, me.id, 'reward_added', trim(r.title), null, null, partner.id);
      }),

    updateReward: (id, r) =>
      mutate((db, me) => {
        const reward = db.rewards.find((x) => x.id === id && x.couple_id === me.couple_id && !x.archived);
        if (!reward) throw new Oops('That reward isn’t around any more.');
        if (reward.wished_by !== me.id) throw new Oops('Only the person who wished for this can change it.');
        validateReward(r);
        if (reward.price != null) throw new Oops('This wish has been priced, so it’s locked. Remove it and add a new one to change it.');
        Object.assign(reward, { title: trim(r.title), details: trim(r.details), emoji: trim(r.emoji) || reward.emoji });
        log(db, me.couple_id!, me.id, 'reward_updated', reward.title, reward.price, null, null);
      }),

    removeReward: (id) =>
      mutate((db, me) => {
        const reward = db.rewards.find((x) => x.id === id && x.couple_id === me.couple_id && !x.archived);
        if (!reward) return;
        if (reward.wished_by !== me.id) throw new Oops('Only the person who wished for this can remove it.');
        if (db.redemptions.some((d) => d.reward_id === id && d.status === 'pending'))
          throw new Oops('This one’s been redeemed and is waiting to be delivered. Cancel that first.');
        reward.archived = true;
        log(db, me.couple_id!, me.id, 'reward_removed', reward.title, reward.price, null, null);
      }),

    priceReward: (id, price) =>
      mutate((db, me) => {
        if (!Number.isInteger(price) || price < 1 || price > 10000) throw new Oops('Prices need to be between 1 and 10,000 brownies.');
        const reward = db.rewards.find((x) => x.id === id && x.couple_id === me.couple_id && !x.archived);
        if (!reward) throw new Oops('That reward isn’t around any more.');
        if (reward.wished_by === me.id) throw new Oops('Your partner decides what your wishes cost.');
        Object.assign(reward, { price, priced_at: now() });
        log(db, me.couple_id!, me.id, 'reward_priced', reward.title, price, null, reward.wished_by);
      }),

    redeemReward: (id) =>
      mutate((db, me) => {
        partnerOf(db, me);
        const reward = db.rewards.find((x) => x.id === id && x.couple_id === me.couple_id && !x.archived);
        if (!reward) throw new Oops('That reward isn’t available any more.');
        if (reward.wished_by !== me.id) throw new Oops('You can only redeem rewards from your own wishlist.');
        if (reward.price == null) throw new Oops('Your partner hasn’t set a price for this yet.');
        const bal = balance(db, me.couple_id!, me.id);
        if (bal < reward.price) throw new Oops(`You need ${reward.price - bal} more brownies for this one.`);
        db.redemptions.push({ id: uid(), couple_id: me.couple_id!, reward_id: id, redeemed_by: me.id, price: reward.price, status: 'pending', created_at: now(), resolved_at: null });
        log(db, me.couple_id!, me.id, 'reward_redeemed', reward.title, reward.price, -reward.price, me.id);
      }),

    cancelRedemption: (id) =>
      mutate((db, me) => {
        const d = db.redemptions.find((x) => x.id === id && x.couple_id === me.couple_id);
        if (!d || d.status !== 'pending') return;
        Object.assign(d, { status: 'cancelled', resolved_at: now() });
        const reward = db.rewards.find((r) => r.id === d.reward_id);
        log(db, me.couple_id!, me.id, 'redemption_cancelled', reward?.title ?? '', d.price, d.price, d.redeemed_by);
      }),

    deliverRedemption: (id) =>
      mutate((db, me) => {
        const d = db.redemptions.find((x) => x.id === id && x.couple_id === me.couple_id);
        if (!d || d.status !== 'pending') throw new Oops('That one’s already been sorted.');
        if (d.redeemed_by === me.id) throw new Oops('Your partner marks this as delivered, not you.');
        Object.assign(d, { status: 'delivered', resolved_at: now() });
        const reward = db.rewards.find((r) => r.id === d.reward_id);
        log(db, me.couple_id!, me.id, 'redemption_delivered', reward?.title ?? '', d.price, null, d.redeemed_by);
      }),

    giftBrownies: (amount, note) =>
      mutate((db, me) => {
        const partner = partnerOf(db, me);
        if (!Number.isInteger(amount) || amount < 1 || amount > 500) throw new Oops('Gifts can be between 1 and 500 brownies.');
        log(db, me.couple_id!, me.id, 'gift', '', amount, amount, partner.id, trim(note));
      }),

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
        localStorage.removeItem(DB_KEY);
        session.set(null);
      },
    },
  };
  return backend;
}

function validateTask(t: TaskInput) {
  const title = t.title.trim();
  if (!title || title.length > 80) throw new Oops('Give the task a name (up to 80 characters).');
  const prices = t.shared ? [t.partnerPoints, t.myPoints ?? 0] : [t.partnerPoints];
  if (prices.some((p) => !Number.isInteger(p) || p < 1 || p > 1000)) throw new Oops('Tasks can be worth 1 to 1,000 brownies.');
  if (t.decayHours != null && (t.decayHours < 1 || t.decayHours > 2160)) throw new Oops('Tasks can take up to 90 days to go stale.');
}
function validateReward(r: RewardInput) {
  const title = r.title.trim();
  if (!title || title.length > 80) throw new Oops('Give your wish a name (up to 80 characters).');
}
