// The app's rules, written once in TypeScript. They mirror the SQL functions in
// supabase/migrations and run in two places:
//   * the demo backend (the whole "database" lives in this browser), and
//   * offline mode, which applies queued changes to the last synced state so
//     the screen updates straight away (the server re-checks them on sync).
import type { Activity, ActivityKind, AppState, Claim, Profile, Redemption, Reward, RewardInput, Task, TaskInput, UUID } from '../types';
import { canManage, isActive, isAsleep, taskValue } from '../tasks';

export interface RuleUser extends Profile {
  email: string;
  password_hash: string;
  pair_code: string;
  last_sign_in_at?: string;
  status_changed_at?: string;
}
export interface Couple {
  id: UUID;
  member_a: UUID;
  member_b: UUID;
  created_at: string;
}
/** Redemptions are stored without the wish's title; offline copies keep it as a fallback. */
export type StoredRedemption = Omit<Redemption, 'title' | 'emoji'> & Partial<Pick<Redemption, 'title' | 'emoji'>>;
export interface DB {
  users: RuleUser[];
  couples: Couple[];
  tasks: Task[];
  claims: Claim[];
  rewards: Reward[];
  redemptions: StoredRedemption[];
  activity: Activity[];
  seq: number;
  /** Offline copies only hold the latest feed, so balances carry what's older. */
  carried?: { balances: Record<UUID, number>; earned: Record<UUID, number> };
  /** Demo only: ids of changes already applied, so a retry can't apply one twice. */
  applied?: string[];
  /** Offline copies pass the admin count through untouched. */
  admin?: AppState['admin'];
}

export const emptyDb = (): DB => ({ users: [], couples: [], tasks: [], claims: [], rewards: [], redemptions: [], activity: [], seq: 1 });

/** A rule said no. The message is shown to the person as is. */
export class Oops extends Error {}

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
const trim = (s: string | null | undefined) => (s ?? '').trim();

// Users saved before invite-only existed have no status: treat them as approved.
export const statusOf = (u: Profile) => u.status ?? 'approved';
export const isApproved = (u: Profile) => statusOf(u) === 'approved';

export function partnerOf(db: DB, me: RuleUser): RuleUser {
  if (!me.couple_id) throw new Oops('Pair up with your partner first.');
  const p = db.users.find((u) => u.couple_id === me.couple_id && u.id !== me.id);
  if (!p) throw new Oops('Your partner isn’t here any more.');
  return p;
}

export function log(
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

function totals(db: DB, couple: UUID | null) {
  const balances: Record<UUID, number> = { ...db.carried?.balances };
  const earned: Record<UUID, number> = { ...db.carried?.earned };
  for (const a of db.activity) {
    if (a.couple_id !== couple || a.delta == null || !a.beneficiary_id) continue;
    balances[a.beneficiary_id] = (balances[a.beneficiary_id] ?? 0) + a.delta;
    if (a.delta > 0 && (a.kind === 'task_approved' || a.kind === 'gift'))
      earned[a.beneficiary_id] = (earned[a.beneficiary_id] ?? 0) + a.delta;
  }
  return { balances, earned };
}

export const strip = ({ email: _e, password_hash: _p, last_sign_in_at: _l, ...profile }: RuleUser): Profile => profile;

/** What get_state() returns for this person. */
export function snapshot(db: DB, me: RuleUser): AppState {
  if (!isApproved(me)) {
    const { pair_code: _code, ...waiting } = strip(me);
    return { me: waiting, partner: null, tasks: [], claims: [], rewards: [], redemptions: [], activity: [], balances: {}, earned: {}, admin: null };
  }
  const c = me.couple_id;
  const partner = c ? db.users.find((u) => u.couple_id === c && u.id !== me.id) ?? null : null;
  const byNewest = <T extends { created_at: string }>(a: T, b: T) => b.created_at.localeCompare(a.created_at);
  let partnerProfile: Profile | null = null;
  if (partner) {
    const { pair_code: _code, status_note: _note, ...rest } = strip(partner);
    partnerProfile = rest;
  }
  return {
    me: strip(me),
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
        return { ...d, title: r?.title ?? d.title ?? '', emoji: r?.emoji ?? d.emoji ?? '🎁' };
      }),
    activity: db.activity.filter((a) => a.couple_id === c).sort((a, b) => b.id - a.id).slice(0, 200),
    ...totals(db, c),
    admin: db.admin !== undefined ? db.admin : me.is_admin ? { pending: db.users.filter((u) => statusOf(u) === 'pending').length } : null,
  };
}

/** Turn a synced get_state() result back into a small database the rules can run on. */
export function fromSnapshot(s: AppState): { db: DB; me: RuleUser } {
  const toUser = (p: Profile): RuleUser => ({ email: '', password_hash: '', pair_code: '', ...p }) as RuleUser;
  const me = toUser(s.me);
  const users = [me, ...(s.partner ? [toUser(s.partner)] : [])];
  const seen = { balances: {} as Record<UUID, number>, earned: {} as Record<UUID, number> };
  const db: DB = {
    users,
    couples: [],
    tasks: structuredClone(s.tasks),
    claims: structuredClone(s.claims),
    rewards: structuredClone(s.rewards),
    redemptions: structuredClone(s.redemptions),
    activity: structuredClone(s.activity),
    // local entries sort above the synced ones and never clash with their ids
    seq: Math.max(1e12, ...s.activity.map((a) => a.id + 1)),
    admin: s.admin ?? null,
  };
  const t = totals(db, me.couple_id);
  Object.assign(seen, t);
  const carried = { balances: {} as Record<UUID, number>, earned: {} as Record<UUID, number> };
  for (const [k, v] of Object.entries(s.balances)) carried.balances[k] = v - (seen.balances[k] ?? 0);
  for (const [k, v] of Object.entries(s.earned)) carried.earned[k] = v - (seen.earned[k] ?? 0);
  db.carried = carried;
  return { db, me };
}

function validateTask(t: TaskInput) {
  const title = t.title.trim();
  if (!title || title.length > 80) throw new Oops('Give the task a name (up to 80 characters).');
  const prices = t.shared ? [t.partnerPoints, t.myPoints ?? 0] : [t.partnerPoints];
  if (prices.some((p) => !Number.isInteger(p) || p < 1 || p > 1000)) throw new Oops('Tasks can be worth 1 to 1,000 brownies.');
  if (t.decayHours != null && (t.decayHours < 1 || t.decayHours > 2160)) throw new Oops('Tasks can take up to 90 days to go stale.');
  if (t.decayHours != null && (t.decayGrace < 0 || t.decayGrace >= t.decayHours)) throw new Oops('It has to start cooling before it goes stale.');
  const staleOk = (s: number | null, p: number) => s == null || (s >= 1 && s < p);
  if (t.decayHours != null && (!staleOk(t.stalePartner, t.partnerPoints) || (t.shared && !staleOk(t.staleMine, t.myPoints ?? 0))))
    throw new Oops('The stale price has to be at least 1 and lower than the full price.');
}
function validateReward(r: RewardInput) {
  const title = r.title.trim();
  if (!title || title.length > 80) throw new Oops('Give your wish a name (up to 80 characters).');
}
const nextVersion = (x: { version?: number }) => (x.version ?? 1) + 1;

/** Every change that can be made offline. Each takes the database and the
 *  person making the change, then the same arguments as the Backend method. */
export const rules = {
  updateProfile(db: DB, me: RuleUser, displayName: string, avatar: string) {
    const n = trim(displayName);
    if (!n || n.length > 40) throw new Oops('Names need to be between 1 and 40 characters.');
    const u = db.users.find((x) => x.id === me.id)!;
    u.display_name = n;
    u.avatar = trim(avatar) || u.avatar;
  },

  createTask(db: DB, me: RuleUser, t: TaskInput, id: UUID = uid()) {
    const partner = partnerOf(db, me);
    validateTask(t);
    const base = {
      id, couple_id: me.couple_id!, created_by: me.id, title: trim(t.title), details: trim(t.details),
      repeatable: t.repeatable, status: 'open' as const, created_at: now(), updated_at: now(),
      active: t.startActive ?? true, decay_hours: t.decayHours, decay_floor_pct: t.decayFloor, bumped_at: now(),
      decay_grace_hours: t.decayHours ? t.decayGrace : 0,
      sleep_hours: t.repeatable ? t.sleepHours : null,
      sleeping_until: null, version: 1,
    };
    const stalePart = t.decayHours ? t.stalePartner : null;
    const staleMine = t.decayHours && t.shared ? t.staleMine : null;
    if (t.shared) {
      db.tasks.push({ ...base, shared: true, assigned_to: null, points: t.myPoints!, points_other: t.partnerPoints, awaiting: partner.id, stale_points: staleMine, stale_points_other: stalePart });
      log(db, me.couple_id!, me.id, 'shared_proposed', trim(t.title), t.partnerPoints, null, partner.id);
    } else {
      db.tasks.push({ ...base, shared: false, assigned_to: partner.id, points: t.partnerPoints, points_other: null, awaiting: null, stale_points: stalePart, stale_points_other: null });
      log(db, me.couple_id!, me.id, 'task_added', trim(t.title), t.partnerPoints, null, partner.id);
    }
    return id;
  },

  editTask(db: DB, me: RuleUser, id: UUID, t: TaskInput) {
    const partner = partnerOf(db, me);
    const task = db.tasks.find((x) => x.id === id && x.couple_id === me.couple_id && x.status === 'open');
    if (!task) throw new Oops('That task isn’t around any more.');
    const toShared = t.shared;
    if (toShared !== !!task.shared) {
      if (task.created_by !== me.id) throw new Oops('Only the person who set a task can change who does it.');
      if (db.claims.some((c) => c.task_id === id && c.status === 'pending'))
        throw new Oops('Someone’s marked this as done. Approve or send it back first.');
    }
    validateTask(t);
    const waking = t.startActive === true && !isActive(task);
    const common = {
      title: trim(t.title), details: trim(t.details), repeatable: t.repeatable,
      decay_hours: t.decayHours, decay_floor_pct: t.decayFloor, updated_at: now(),
      active: t.startActive ?? isActive(task),
      bumped_at: waking ? now() : task.bumped_at,
      sleep_hours: t.repeatable ? t.sleepHours : null,
      decay_grace_hours: t.decayHours ? t.decayGrace : 0,
      version: nextVersion(task), last_editor: me.id,
    };
    if (toShared) {
      const mine = me.id === task.created_by;
      Object.assign(task, common, {
        shared: true,
        assigned_to: null,
        points: mine ? t.myPoints! : t.partnerPoints,
        points_other: mine ? t.partnerPoints : t.myPoints!,
        stale_points: t.decayHours ? (mine ? t.staleMine : t.stalePartner) : null,
        stale_points_other: t.decayHours ? (mine ? t.stalePartner : t.staleMine) : null,
        awaiting: partner.id,
      });
      log(db, me.couple_id!, me.id, 'shared_changed', task.title, t.partnerPoints, null, partner.id);
    } else {
      if (task.created_by !== me.id) throw new Oops('Only the person who set a task can change it.');
      Object.assign(task, common, {
        shared: false, assigned_to: partner.id, awaiting: null, points_other: null, stale_points_other: null,
        points: t.partnerPoints, stale_points: t.decayHours ? t.stalePartner : null,
      });
      log(db, me.couple_id!, me.id, 'task_updated', task.title, t.partnerPoints, null, task.assigned_to);
    }
  },

  respondShared(db: DB, me: RuleUser, id: UUID, accept: boolean) {
    const task = db.tasks.find((x) => x.id === id && x.couple_id === me.couple_id && x.status === 'open');
    if (!task || !task.shared) throw new Oops('That proposal isn’t around any more.');
    if (task.awaiting !== me.id) throw new Oops('This one isn’t waiting on you.');
    if (accept) Object.assign(task, { awaiting: null, bumped_at: now(), updated_at: now() });
    else Object.assign(task, { status: 'archived', updated_at: now() });
    log(db, me.couple_id!, me.id, accept ? 'shared_agreed' : 'shared_declined', task.title, null, null, null);
  },

  setTaskActive(db: DB, me: RuleUser, id: UUID, active: boolean) {
    const task = db.tasks.find((x) => x.id === id && x.couple_id === me.couple_id && x.status === 'open');
    if (!task) throw new Oops('That task isn’t around any more.');
    if (!canManage(task, me.id)) throw new Oops('Only the person who set a task can pause it.');
    if (isActive(task) === active && !(active && isAsleep(task))) return;
    Object.assign(task, { active, updated_at: now() }, active ? { bumped_at: now(), sleeping_until: null } : {});
    log(db, me.couple_id!, me.id, active ? 'task_resumed' : 'task_paused', task.title, null, null, null);
  },

  bumpTask(db: DB, me: RuleUser, id: UUID) {
    const task = db.tasks.find((x) => x.id === id && x.couple_id === me.couple_id && x.status === 'open');
    if (!task) throw new Oops('That task isn’t around any more.');
    if (!task.decay_hours) throw new Oops('That task doesn’t go stale.');
    if (!canManage(task, me.id)) throw new Oops('Only the person who set a task can warm it up.');
    Object.assign(task, { bumped_at: now(), updated_at: now() });
    log(db, me.couple_id!, me.id, 'task_bumped', task.title, null, null, null);
  },

  setTaskOrder(db: DB, me: RuleUser, ids: UUID[]) {
    db.users.find((u) => u.id === me.id)!.task_order = ids.slice(0, 500);
  },

  removeTask(db: DB, me: RuleUser, id: UUID) {
    const task = db.tasks.find((x) => x.id === id && x.couple_id === me.couple_id && x.status !== 'archived');
    if (!task) return;
    if (!canManage(task, me.id)) throw new Oops('Only the person who set a task can remove it.');
    for (const c of db.claims) if (c.task_id === id && c.status === 'pending') Object.assign(c, { status: 'withdrawn', resolved_at: now() });
    task.status = 'archived';
    log(db, me.couple_id!, me.id, 'task_removed', task.title, task.points, null, task.assigned_to);
  },

  /** doneAt: when it was really done (offline), so a timed task earns what it was worth then. */
  claimTask(db: DB, me: RuleUser, id: UUID, note: string, doneAt?: string) {
    partnerOf(db, me);
    const task = db.tasks.find((x) => x.id === id && x.couple_id === me.couple_id);
    if (!task || task.status !== 'open') throw new Oops('That task isn’t available any more.');
    if (task.shared) {
      if (task.awaiting) throw new Oops('You both need to agree on this one first.');
    } else if (task.assigned_to !== me.id) throw new Oops('This task is for your partner, not you.');
    if (!isActive(task)) throw new Oops('That task is resting right now.');
    if (isAsleep(task)) throw new Oops('That task is sleeping. It’ll be back soon.');
    if (db.claims.some((c) => c.task_id === id && c.status === 'pending')) throw new Oops('Already marked as done. Waiting on approval.');
    const at = Math.max(Math.min(doneAt ? Date.parse(doneAt) : Date.now(), Date.now()), Date.now() - 48 * 3_600_000);
    const value = taskValue(task, me.id, at);
    db.claims.push({ id: uid(), couple_id: me.couple_id!, task_id: id, claimed_by: me.id, points: value, note: trim(note), status: 'pending', created_at: now(), resolved_at: null });
    log(db, me.couple_id!, me.id, 'task_claimed', task.title, value, null, me.id, trim(note));
  },

  withdrawClaim(db: DB, me: RuleUser, id: UUID) {
    const claim = db.claims.find((c) => c.id === id && c.couple_id === me.couple_id);
    if (!claim || claim.status !== 'pending') return;
    if (claim.claimed_by !== me.id) throw new Oops('Only the person who claimed this can undo it.');
    Object.assign(claim, { status: 'withdrawn', resolved_at: now() });
    const task = db.tasks.find((t) => t.id === claim.task_id);
    log(db, me.couple_id!, me.id, 'claim_withdrawn', task?.title ?? '', claim.points, null, me.id);
  },

  reviewClaim(db: DB, me: RuleUser, id: UUID, approve: boolean, note: string) {
    const claim = db.claims.find((c) => c.id === id && c.couple_id === me.couple_id);
    if (!claim || claim.status !== 'pending') throw new Oops('That one’s already been reviewed.');
    if (claim.claimed_by === me.id) throw new Oops('Nice try! Your partner has to approve your own tasks.');
    const task = db.tasks.find((t) => t.id === claim.task_id)!;
    if (approve) {
      Object.assign(claim, { status: 'approved', resolved_at: now() });
      if (!task.repeatable) Object.assign(task, { status: 'done', updated_at: now() });
      else if (task.sleep_hours === 0) task.active = false; // rests until switched on
      else if (task.sleep_hours) {
        const wake = new Date(Date.now() + task.sleep_hours * 3_600_000).toISOString();
        Object.assign(task, { sleeping_until: wake, bumped_at: wake }); // sleeps, wakes up fresh
      } else if (task.decay_hours) task.bumped_at = now(); // done, so it starts fresh again
      log(db, me.couple_id!, me.id, 'task_approved', task.title, claim.points, claim.points, claim.claimed_by, trim(note));
    } else {
      Object.assign(claim, { status: 'declined', resolved_at: now() });
      log(db, me.couple_id!, me.id, 'task_declined', task.title, claim.points, null, claim.claimed_by, trim(note));
    }
  },

  addReward(db: DB, me: RuleUser, r: RewardInput, id: UUID = uid()) {
    const partner = partnerOf(db, me);
    validateReward(r);
    db.rewards.push({
      id, couple_id: me.couple_id!, wished_by: me.id, title: trim(r.title), details: trim(r.details),
      emoji: trim(r.emoji) || '🎁', price: null, archived: false, created_at: now(), priced_at: null, version: 1,
    });
    log(db, me.couple_id!, me.id, 'reward_added', trim(r.title), null, null, partner.id);
    return id;
  },

  updateReward(db: DB, me: RuleUser, id: UUID, r: RewardInput) {
    const reward = db.rewards.find((x) => x.id === id && x.couple_id === me.couple_id && !x.archived);
    if (!reward) throw new Oops('That reward isn’t around any more.');
    if (reward.wished_by !== me.id) throw new Oops('Only the person who wished for this can change it.');
    validateReward(r);
    if (reward.price != null) throw new Oops('This wish has been priced, so it’s locked. Remove it and add a new one to change it.');
    Object.assign(reward, { title: trim(r.title), details: trim(r.details), emoji: trim(r.emoji) || reward.emoji, version: nextVersion(reward), last_editor: me.id });
    log(db, me.couple_id!, me.id, 'reward_updated', reward.title, reward.price, null, null);
  },

  removeReward(db: DB, me: RuleUser, id: UUID) {
    const reward = db.rewards.find((x) => x.id === id && x.couple_id === me.couple_id && !x.archived);
    if (!reward) return;
    if (reward.wished_by !== me.id) throw new Oops('Only the person who wished for this can remove it.');
    if (db.redemptions.some((d) => d.reward_id === id && d.status === 'pending'))
      throw new Oops('This one’s been redeemed and is waiting to be delivered. Cancel that first.');
    reward.archived = true;
    log(db, me.couple_id!, me.id, 'reward_removed', reward.title, reward.price, null, null);
  },

  priceReward(db: DB, me: RuleUser, id: UUID, price: number) {
    if (!Number.isInteger(price) || price < 1 || price > 10000) throw new Oops('Prices need to be between 1 and 10,000 brownies.');
    const reward = db.rewards.find((x) => x.id === id && x.couple_id === me.couple_id && !x.archived);
    if (!reward) throw new Oops('That reward isn’t around any more.');
    if (reward.wished_by === me.id) throw new Oops('Your partner decides what your wishes cost.');
    Object.assign(reward, { price, priced_at: now(), version: nextVersion(reward), last_editor: me.id });
    log(db, me.couple_id!, me.id, 'reward_priced', reward.title, price, null, reward.wished_by);
  },

  redeemReward(db: DB, me: RuleUser, id: UUID) {
    partnerOf(db, me);
    const reward = db.rewards.find((x) => x.id === id && x.couple_id === me.couple_id && !x.archived);
    if (!reward) throw new Oops('That reward isn’t available any more.');
    if (reward.wished_by !== me.id) throw new Oops('You can only redeem rewards from your own wishlist.');
    if (reward.price == null) throw new Oops('Your partner hasn’t set a price for this yet.');
    const bal = totals(db, me.couple_id).balances[me.id] ?? 0;
    if (bal < reward.price) throw new Oops(`You need ${reward.price - bal} more brownies for this one.`);
    db.redemptions.push({ id: uid(), couple_id: me.couple_id!, reward_id: id, redeemed_by: me.id, price: reward.price, status: 'pending', created_at: now(), resolved_at: null });
    log(db, me.couple_id!, me.id, 'reward_redeemed', reward.title, reward.price, -reward.price, me.id);
  },

  cancelRedemption(db: DB, me: RuleUser, id: UUID) {
    const d = db.redemptions.find((x) => x.id === id && x.couple_id === me.couple_id);
    if (!d || d.status !== 'pending') return;
    Object.assign(d, { status: 'cancelled', resolved_at: now() });
    const reward = db.rewards.find((r) => r.id === d.reward_id);
    log(db, me.couple_id!, me.id, 'redemption_cancelled', reward?.title ?? d.title ?? '', d.price, d.price, d.redeemed_by);
  },

  deliverRedemption(db: DB, me: RuleUser, id: UUID) {
    const d = db.redemptions.find((x) => x.id === id && x.couple_id === me.couple_id);
    if (!d || d.status !== 'pending') throw new Oops('That one’s already been sorted.');
    if (d.redeemed_by === me.id) throw new Oops('Your partner marks this as delivered, not you.');
    Object.assign(d, { status: 'delivered', resolved_at: now() });
    const reward = db.rewards.find((r) => r.id === d.reward_id);
    log(db, me.couple_id!, me.id, 'redemption_delivered', reward?.title ?? d.title ?? '', d.price, null, d.redeemed_by);
  },

  giftBrownies(db: DB, me: RuleUser, amount: number, note: string) {
    const partner = partnerOf(db, me);
    if (!Number.isInteger(amount) || amount < 1 || amount > 500) throw new Oops('Gifts can be between 1 and 500 brownies.');
    log(db, me.couple_id!, me.id, 'gift', '', amount, amount, partner.id, trim(note));
  },
};

export type RuleName = keyof typeof rules;
type Rest<F> = F extends (db: DB, me: RuleUser, ...args: infer A) => unknown ? A : never;
export type RuleArgs<K extends RuleName> = Rest<(typeof rules)[K]>;
