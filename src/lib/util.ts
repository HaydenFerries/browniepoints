import type { AppState, Claim, Redemption, Reward, Task, UUID } from './types';

export const plural = (n: number, one = 'brownie', many = 'brownies') => `${n} ${Math.abs(n) === 1 ? one : many}`;

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return 'just now';
  if (s < 90) return 'a minute ago';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

export const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** Small deterministic PRNG so the jar's pile doesn't reshuffle on re-render. */
export function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/** Everything derived from the raw state that screens keep asking for. */
export function derive(state: AppState) {
  const me = state.me;
  const partner = state.partner;
  const myId: UUID = me.id;
  const partnerId: UUID | undefined = partner?.id;
  const pendingClaimByTask = new Map<UUID, Claim>();
  for (const c of state.claims) if (c.status === 'pending') pendingClaimByTask.set(c.task_id, c);
  const pendingRedemptionsByReward = new Map<UUID, Redemption[]>();
  for (const d of state.redemptions)
    if (d.status === 'pending') pendingRedemptionsByReward.set(d.reward_id, [...(pendingRedemptionsByReward.get(d.reward_id) ?? []), d]);

  const open = (t: Task) => t.status === 'open';
  const tasksForMe = state.tasks.filter((t) => t.assigned_to === myId && open(t));
  const tasksForPartner = state.tasks.filter((t) => t.created_by === myId && open(t));
  const doneForMe = state.tasks.filter((t) => t.assigned_to === myId && t.status === 'done');
  const doneForPartner = state.tasks.filter((t) => t.created_by === myId && t.status === 'done');
  const myWishes = state.rewards.filter((r: Reward) => r.wished_by === myId);
  const partnerWishes = state.rewards.filter((r: Reward) => r.wished_by !== myId);

  const taskById = new Map(state.tasks.map((t) => [t.id, t]));
  const claimsToReview = state.claims.filter((c) => c.status === 'pending' && c.claimed_by !== myId);
  const myClaimsWaiting = state.claims.filter((c) => c.status === 'pending' && c.claimed_by === myId);
  const toDeliver = state.redemptions.filter((d) => d.status === 'pending' && d.redeemed_by !== myId);
  const owedToMe = state.redemptions.filter((d) => d.status === 'pending' && d.redeemed_by === myId);
  const toPrice = partnerWishes.filter((r) => r.price == null);

  return {
    myId,
    partnerId,
    myBalance: state.balances[myId] ?? 0,
    partnerBalance: partnerId ? state.balances[partnerId] ?? 0 : 0,
    myEarned: state.earned[myId] ?? 0,
    partnerEarned: partnerId ? state.earned[partnerId] ?? 0 : 0,
    pendingClaimByTask,
    pendingRedemptionsByReward,
    tasksForMe,
    tasksForPartner,
    doneForMe,
    doneForPartner,
    myWishes,
    partnerWishes,
    taskById,
    claimsToReview,
    myClaimsWaiting,
    toDeliver,
    owedToMe,
    toPrice,
    actionCount: claimsToReview.length + toDeliver.length + toPrice.length,
  };
}

export type Derived = ReturnType<typeof derive>;
