import type { Activity, AppState, Profile, RewardInput, TaskInput, UUID } from '../types';

export type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'PASSWORD_RECOVERY' | 'OTHER';

/** Everything the UI needs from a backend. Implemented by Supabase and by a
 *  local demo that keeps data in this browser. */
export interface Backend {
  readonly mode: 'supabase' | 'demo';

  currentUserId(): Promise<UUID | null>;
  currentEmail(): Promise<string | null>;
  onAuthChange(cb: (userId: UUID | null, event: AuthEvent) => void): () => void;
  signUp(input: { email: string; password: string; displayName: string; avatar: string }): Promise<{ needsConfirmation: boolean }>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;

  getState(): Promise<AppState>;
  /** Calls `onChange` whenever something changes for this person or couple.
   *  `activity` is set when the change came with a feed entry. */
  subscribe(me: UUID, coupleId: UUID | null, onChange: (activity?: Activity) => void): () => void;

  updateProfile(displayName: string, avatar: string): Promise<void>;
  pairWith(code: string): Promise<{ ok: boolean; error?: string }>;
  unpair(): Promise<void>;
  newPairCode(): Promise<string>;

  addTask(input: TaskInput): Promise<void>;
  updateTask(id: UUID, input: TaskInput): Promise<void>;
  removeTask(id: UUID): Promise<void>;
  claimTask(id: UUID, note: string): Promise<void>;
  withdrawClaim(id: UUID): Promise<void>;
  reviewClaim(id: UUID, approve: boolean, note: string): Promise<void>;

  addReward(input: RewardInput): Promise<void>;
  updateReward(id: UUID, input: RewardInput): Promise<void>;
  removeReward(id: UUID): Promise<void>;
  priceReward(id: UUID, price: number): Promise<void>;
  redeemReward(id: UUID): Promise<void>;
  cancelRedemption(id: UUID): Promise<void>;
  deliverRedemption(id: UUID): Promise<void>;
  giftBrownies(amount: number, note: string): Promise<void>;

  /** Demo-only helpers (undefined on the real backend). */
  demo?: {
    seed(): Promise<void>;
    users(): Profile[];
    switchUser(id: UUID): Promise<void>;
    reset(): void;
  };
}
