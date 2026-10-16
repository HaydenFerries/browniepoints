import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Activity, AdminUser, AppState, RewardInput, TaskInput, UUID } from '../types';
import type { AuthEvent, Backend } from './types';
import { createOfflineLayer } from './offline';
import type { RuleArgs, RuleName } from './rules';

const LAST_USER_KEY = 'bp-last-user';
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export function createSupabaseBackend(url: string, key: string): Backend {
  const sb: SupabaseClient = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    let call = sb.rpc(fn, args);
    if (timeoutMs) call = call.abortSignal(AbortSignal.timeout(timeoutMs)); // patchy signal: give up and queue
    const { data, error } = await call;
    if (error) throw new Error(friendly(error.message));
    return data as T;
  }

  async function currentUserId() {
    const { data, error } = await sb.auth.getSession();
    const id = data.session?.user.id ?? null;
    if (id) localStorage.setItem(LAST_USER_KEY, id);
    // Offline with an expired token: still you, the token refreshes once back online.
    else if (!navigator.onLine || (error && /fetch|network/i.test(error.message))) return localStorage.getItem(LAST_USER_KEY);
    return id;
  }

  const offline = createOfflineLayer({
    userId: currentUserId,
    fetchState: () => rpc<AppState>('get_state', undefined, 15000),
    send: (op) => rpc('apply_op', { p_op_id: op.id, p_name: op.name, p_args: op.params, p_base: op.base }, 15000),
  });
  /** A change that can be made offline: the local rule, then the server function. */
  const change = <K extends RuleName>(method: K, args: RuleArgs<K>, name: string, params: Record<string, unknown>) =>
    offline.run(method, args, name, params);

  return {
    mode: 'supabase',
    sync: offline.sync,

    currentUserId,

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
      const id = await currentUserId();
      await sb.auth.signOut();
      localStorage.removeItem(LAST_USER_KEY);
      if (id) await offline.forget(id); // nothing personal left on a shared phone
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

    getState: () => offline.getState(),

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

    updateProfile: (displayName, avatar) =>
      change('updateProfile', [displayName, avatar], 'update_profile', { p_display_name: displayName, p_avatar: avatar }),
    pairWith: (code) => rpc<{ ok: boolean; error?: string }>('pair_with', { p_code: code }),
    unpair: () => rpc('unpair'),
    newPairCode: () => rpc<string>('new_pair_code'),

    createTask: (t: TaskInput) => {
      const id = crypto.randomUUID(); // chosen here so changes queued offline can refer to it
      return change('createTask', [t, id], 'create_task', {
        p_id: id,
        p_shared: t.shared,
        p_active: t.startActive ?? true,
        p_sleep_hours: t.repeatable ? t.sleepHours : null,
        ...taskArgs(t),
      });
    },
    editTask: (id: UUID, t: TaskInput) =>
      change('editTask', [id, t], 'edit_task', {
        p_task_id: id,
        p_active: t.startActive ?? null,
        p_shared: t.shared,
        p_sleep_hours: t.repeatable ? t.sleepHours : null,
        ...taskArgs(t),
      }),
    respondShared: (id, accept) => change('respondShared', [id, accept], 'respond_shared_task', { p_task_id: id, p_accept: accept }),
    setTaskActive: (id, active) => change('setTaskActive', [id, active], 'set_task_active', { p_task_id: id, p_active: active }),
    bumpTask: (id) => change('bumpTask', [id], 'bump_task', { p_task_id: id }),
    setTaskOrder: (ids) => change('setTaskOrder', [ids], 'set_task_order', { p_ids: ids }),
    removeTask: (id) => change('removeTask', [id], 'remove_task', { p_task_id: id }),
    claimTask: (id, note) => {
      const doneAt = new Date().toISOString(); // a timed task earns what it was worth now, even if it syncs later
      return change('claimTask', [id, note, doneAt], 'claim_task', { p_task_id: id, p_note: note, p_done_at: doneAt });
    },
    withdrawClaim: (id) => change('withdrawClaim', [id], 'withdraw_claim', { p_claim_id: id }),
    reviewClaim: (id, approve, note) =>
      change('reviewClaim', [id, approve, note], 'review_claim', { p_claim_id: id, p_approve: approve, p_note: note }),

    addReward: (r: RewardInput) => {
      const id = crypto.randomUUID();
      return change('addReward', [r, id], 'add_reward', { p_id: id, p_title: r.title, p_details: r.details, p_emoji: r.emoji });
    },
    updateReward: (id, r) =>
      change('updateReward', [id, r], 'update_reward', { p_reward_id: id, p_title: r.title, p_details: r.details, p_emoji: r.emoji }),
    removeReward: (id) => change('removeReward', [id], 'remove_reward', { p_reward_id: id }),
    priceReward: (id, price) => change('priceReward', [id, price], 'price_reward', { p_reward_id: id, p_price: price }),
    redeemReward: (id) => change('redeemReward', [id], 'redeem_reward', { p_reward_id: id }),
    cancelRedemption: (id) => change('cancelRedemption', [id], 'cancel_redemption', { p_redemption_id: id }),
    deliverRedemption: (id) => change('deliverRedemption', [id], 'deliver_redemption', { p_redemption_id: id }),
    giftBrownies: (amount, note) => change('giftBrownies', [amount, note], 'gift_brownies', { p_amount: amount, p_note: note }),

    adminListUsers: () => rpc<AdminUser[]>('admin_list_users'),
    adminSetStatus: (id, status, note) => rpc('admin_set_status', { p_user: id, p_status: status, p_note: note }),
    adminRemove: (id) => rpc('admin_remove_user', { p_user: id }),

    push: VAPID_PUBLIC_KEY
      ? {
          publicKey: VAPID_PUBLIC_KEY,
          save: (sub) =>
            rpc('save_push_subscription', {
              p_endpoint: sub.endpoint,
              p_p256dh: sub.keys?.p256dh ?? '',
              p_auth: sub.keys?.auth ?? '',
              p_user_agent: navigator.userAgent,
            }),
          remove: (endpoint) => rpc('delete_push_subscription', { p_endpoint: endpoint }),
          async test() {
            const { error } = await sb.functions.invoke('send-push', { body: { test: true } });
            if (error) throw new Error('Couldn’t send a test. Is the send-push function set up in Supabase?');
          },
        }
      : undefined,
  };
}

function taskArgs(t: TaskInput) {
  return {
    p_title: t.title,
    p_details: t.details,
    p_partner_points: t.partnerPoints,
    p_my_points: t.shared ? t.myPoints : null,
    p_repeatable: t.repeatable,
    p_decay_hours: t.decayHours,
    p_decay_floor: t.decayFloor,
    p_decay_grace: t.decayHours ? t.decayGrace : 0,
    p_stale_partner: t.decayHours ? t.stalePartner : null,
    p_stale_mine: t.decayHours && t.shared ? t.staleMine : null,
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
