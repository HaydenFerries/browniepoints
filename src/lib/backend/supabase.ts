import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Activity, AdminUser, AppState, RewardInput, TaskInput, UUID } from '../types';
import type { AuthEvent, Backend } from './types';

export function createSupabaseBackend(url: string, key: string): Backend {
  const sb: SupabaseClient = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(friendly(error.message));
    return data as T;
  }

  return {
    mode: 'supabase',

    async currentUserId() {
      const { data } = await sb.auth.getSession();
      return data.session?.user.id ?? null;
    },

    async currentEmail() {
      const { data } = await sb.auth.getSession();
      return data.session?.user.email ?? null;
    },

    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((event, session) => {
        const e: AuthEvent =
          event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'PASSWORD_RECOVERY' ? event : 'OTHER';
        // Defer so we never call Supabase from inside its own auth callback.
        setTimeout(() => cb(session?.user.id ?? null, e), 0);
      });
      return () => data.subscription.unsubscribe();
    },

    async signUp({ email, password, displayName, avatar, captchaToken }) {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName, avatar },
          emailRedirectTo: window.location.origin + window.location.pathname,
          captchaToken,
        },
      });
      if (error) throw new Error(friendly(error.message));
      return { needsConfirmation: !data.session };
    },

    async signIn(email, password, captchaToken) {
      const { error } = await sb.auth.signInWithPassword({ email, password, options: { captchaToken } });
      if (error) throw new Error(friendly(error.message));
    },

    async signOut() {
      await sb.auth.signOut();
    },

    async requestPasswordReset(email, captchaToken) {
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname,
        captchaToken,
      });
      if (error) throw new Error(friendly(error.message));
    },

    async updatePassword(password) {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw new Error(friendly(error.message));
    },

    getState: () => rpc<AppState>('get_state'),

    subscribe(me, coupleId, onChange) {
      const channel = sb.channel(`bp-${me}-${Math.random().toString(36).slice(2)}`);
      channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${me}` }, () =>
        onChange(),
      );
      if (coupleId) {
        channel.on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'activity', filter: `couple_id=eq.${coupleId}` },
          (payload) => onChange(payload.new as Activity),
        );
        channel.on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `couple_id=eq.${coupleId}` },
          () => onChange(),
        );
      }
      channel.subscribe();
      return () => {
        sb.removeChannel(channel);
      };
    },

    updateProfile: (displayName, avatar) => rpc('update_profile', { p_display_name: displayName, p_avatar: avatar }),
    pairWith: (code) => rpc<{ ok: boolean; error?: string }>('pair_with', { p_code: code }),
    unpair: () => rpc('unpair'),
    newPairCode: () => rpc<string>('new_pair_code'),

    addTask: (t: TaskInput) =>
      rpc('add_task', { p_title: t.title, p_details: t.details, p_points: t.points, p_repeatable: t.repeatable }),
    updateTask: (id: UUID, t: TaskInput) =>
      rpc('update_task', { p_task_id: id, p_title: t.title, p_details: t.details, p_points: t.points, p_repeatable: t.repeatable }),
    removeTask: (id) => rpc('remove_task', { p_task_id: id }),
    claimTask: (id, note) => rpc('claim_task', { p_task_id: id, p_note: note }),
    withdrawClaim: (id) => rpc('withdraw_claim', { p_claim_id: id }),
    reviewClaim: (id, approve, note) => rpc('review_claim', { p_claim_id: id, p_approve: approve, p_note: note }),

    addReward: (r: RewardInput) => rpc('add_reward', { p_title: r.title, p_details: r.details, p_emoji: r.emoji }),
    updateReward: (id, r) => rpc('update_reward', { p_reward_id: id, p_title: r.title, p_details: r.details, p_emoji: r.emoji }),
    removeReward: (id) => rpc('remove_reward', { p_reward_id: id }),
    priceReward: (id, price) => rpc('price_reward', { p_reward_id: id, p_price: price }),
    redeemReward: (id) => rpc('redeem_reward', { p_reward_id: id }),
    cancelRedemption: (id) => rpc('cancel_redemption', { p_redemption_id: id }),
    deliverRedemption: (id) => rpc('deliver_redemption', { p_redemption_id: id }),
    giftBrownies: (amount, note) => rpc('gift_brownies', { p_amount: amount, p_note: note }),

    adminListUsers: () => rpc<AdminUser[]>('admin_list_users'),
    adminSetStatus: (id, status, note) => rpc('admin_set_status', { p_user: id, p_status: status, p_note: note }),
    adminRemove: (id) => rpc('admin_remove_user', { p_user: id }),
  };
}

function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'That email and password don’t match.';
  if (/email not confirmed/i.test(message)) return 'Check your inbox and confirm your email first.';
  if (/user already registered/i.test(message)) return 'There’s already an account with that email. Try signing in.';
  if (/password should be at least/i.test(message)) return 'Passwords need at least 6 characters.';
  if (/captcha/i.test(message)) return 'The human check didn’t go through. Give it a moment and try again.';
  if (/rate limit/i.test(message)) return 'Too many emails sent recently. Try again in a little while.';
  if (/failed to fetch|networkerror/i.test(message)) return 'Can’t reach the bakery. Check your connection?';
  return message;
}
