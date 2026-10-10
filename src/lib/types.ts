// Shapes returned by the `get_state()` database function (snake_case to match
// Postgres). The demo backend produces exactly the same shapes.

export type UUID = string;

export type AccountStatus = 'pending' | 'approved' | 'suspended' | 'rejected';

export interface Profile {
  id: UUID;
  display_name: string;
  avatar: string;
  pair_code?: string; // only present on your own profile
  couple_id: UUID | null;
  created_at: string;
  /** Invite-only: new accounts wait for an admin. Missing on older databases → approved. */
  status?: AccountStatus;
  /** The admin's note to this person when rejected or suspended (own profile only). */
  status_note?: string;
  is_admin?: boolean;
  /** Your own drag-and-drop order of tasks. */
  task_order?: UUID[];
}

export interface Task {
  id: UUID;
  couple_id: UUID;
  created_by: UUID; // the person who set (or proposed) it
  assigned_to: UUID | null; // who does it; null for shared tasks (either of you)
  title: string;
  details: string;
  /** Regular task: what the doer earns. Shared task: what the creator earns. */
  points: number;
  repeatable: boolean;
  status: 'open' | 'done' | 'archived';
  created_at: string;
  updated_at: string;
  // Added later; optional so older databases still load.
  shared?: boolean;
  /** Shared task: what the non-creator earns. */
  points_other?: number | null;
  /** Shared task waiting for this person to agree. */
  awaiting?: UUID | null;
  /** Paused tasks rest until they're needed again. */
  active?: boolean;
  /** Timed: hours to go fully stale (null = always worth the same). */
  decay_hours?: number | null;
  /** Timed: the lowest it drops to, as a % of the price. */
  decay_floor_pct?: number;
  /** Timed: when it was last fresh. */
  bumped_at?: string;
  /** Timed: hours it stays at full price before it starts cooling. */
  decay_grace_hours?: number;
  /** Timed: stale price (brownies) for the creator / the other person. */
  stale_points?: number | null;
  stale_points_other?: number | null;
}

export interface Claim {
  id: UUID;
  couple_id: UUID;
  task_id: UUID;
  claimed_by: UUID;
  points: number;
  note: string;
  status: 'pending' | 'approved' | 'declined' | 'withdrawn';
  created_at: string;
  resolved_at: string | null;
}

export interface Reward {
  id: UUID;
  couple_id: UUID;
  wished_by: UUID; // the person who wants it
  title: string;
  details: string;
  emoji: string;
  price: number | null; // set by the partner
  archived: boolean;
  created_at: string;
  priced_at: string | null;
}

export interface Redemption {
  id: UUID;
  couple_id: UUID;
  reward_id: UUID;
  redeemed_by: UUID;
  price: number;
  status: 'pending' | 'delivered' | 'cancelled';
  created_at: string;
  resolved_at: string | null;
  title: string;
  emoji: string;
}

export type ActivityKind =
  | 'paired'
  | 'unpaired'
  | 'task_added'
  | 'task_updated'
  | 'task_removed'
  | 'task_claimed'
  | 'claim_withdrawn'
  | 'task_approved'
  | 'task_declined'
  | 'reward_added'
  | 'reward_updated'
  | 'reward_removed'
  | 'reward_priced'
  | 'reward_redeemed'
  | 'redemption_cancelled'
  | 'redemption_delivered'
  | 'gift'
  | 'shared_proposed'
  | 'shared_changed'
  | 'shared_agreed'
  | 'shared_declined'
  | 'task_paused'
  | 'task_resumed'
  | 'task_bumped';

export interface Activity {
  id: number;
  couple_id: UUID;
  actor_id: UUID | null;
  kind: ActivityKind;
  title: string;
  value: number | null; // informational amount (task worth, price…)
  delta: number | null; // balance change for beneficiary_id
  beneficiary_id: UUID | null;
  note: string;
  created_at: string;
}

export interface AppState {
  me: Profile;
  partner: Profile | null;
  tasks: Task[];
  claims: Claim[];
  rewards: Reward[];
  redemptions: Redemption[];
  activity: Activity[];
  balances: Record<UUID, number>;
  earned: Record<UUID, number>;
  /** Only for admins. */
  admin?: { pending: number } | null;
}

/** A row in the admin portal. */
export interface AdminUser {
  id: UUID;
  display_name: string;
  avatar: string;
  status: AccountStatus;
  status_note: string;
  status_changed_at: string | null;
  is_admin: boolean;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  partner_name: string | null;
}

export interface TaskInput {
  title: string;
  details: string;
  /** Shared (either of you) vs. set for your partner. Fixed once created. */
  shared: boolean;
  /** What your partner earns for doing it. */
  partnerPoints: number;
  /** What you earn for doing it (shared tasks only). */
  myPoints: number | null;
  repeatable: boolean;
  /** Hours until fully stale, or null for a fixed price. */
  decayHours: number | null;
  /** Lowest value, as a % of the price. */
  decayFloor: number;
  /** Hours it stays at full price before cooling starts. */
  decayGrace: number;
  /** Stale price (brownies) for your partner, and for you on shared tasks. */
  stalePartner: number | null;
  staleMine: number | null;
  /** New tasks only: false = start resting, switch it on later. */
  startActive?: boolean;
}

export interface RewardInput {
  title: string;
  details: string;
  emoji: string;
}
