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
}

export interface Task {
  id: UUID;
  couple_id: UUID;
  created_by: UUID; // the person who set it (and decided the points)
  assigned_to: UUID; // the person who does it
  title: string;
  details: string;
  points: number;
  repeatable: boolean;
  status: 'open' | 'done' | 'archived';
  created_at: string;
  updated_at: string;
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
  | 'gift';

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
  points: number;
  repeatable: boolean;
}

export interface RewardInput {
  title: string;
  details: string;
  emoji: string;
}
