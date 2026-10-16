// Offline mode for the real backend.
//
// * The last state from the server is kept on the phone, so the app opens and
//   shows everything with no signal.
// * Changes are *actions* (claim this, price that…). Online, they go straight
//   to the server. Offline (or if the server can't be reached), they're checked
//   against the same rules locally, queued, and shown straight away by
//   replaying the queue over the last synced state.
// * The queue is sent in order when the connection comes back. Every action
//   carries an id, so a retry can never apply it twice. Anything the server
//   refuses lands in a "Couldn't sync" list; nothing is dropped silently.
import type { AppState, Profile, UUID } from '../types';
import { idbDel, idbGet, idbSet } from '../idb';
import { fromSnapshot, rules, snapshot, type DB, type RuleName, type RuleUser } from './rules';

export interface QueuedOp {
  /** Also the server's idempotency key. */
  id: UUID;
  /** The rule to replay locally, with its arguments. */
  method: RuleName;
  args: unknown[];
  /** The server function and its parameters. */
  name: string;
  params: Record<string, unknown>;
  /** Edits: the version they were based on, so a clash with your partner is caught. */
  base: { table: 'tasks' | 'rewards'; id: UUID; version: number } | null;
  createdAt: string;
  /** Plain words for the "Couldn't sync" list. */
  label: string;
}

export interface FailedOp extends QueuedOp {
  reason: string;
  /** Your partner changed the same thing meanwhile. */
  conflict: boolean;
  failedAt: string;
}

export interface SyncStatus {
  online: boolean;
  syncing: boolean;
  /** Showing what's saved on this phone because the server couldn't be reached. */
  fromCache: boolean;
  lastSynced: string | null;
  pending: QueuedOp[];
  failed: FailedOp[];
}

export interface SyncControl {
  status(): SyncStatus;
  onChange(cb: () => void): () => void;
  flush(): Promise<void>;
  retry(id: UUID): Promise<void>;
  /** Re-send an edit without the version check ("use mine"). */
  useMine(id: UUID): Promise<void>;
  discard(id: UUID): Promise<void>;
}

export interface OfflineDeps {
  userId(): Promise<UUID | null>;
  /** Defaults to the browser's own idea of being online. */
  isOnline?(): boolean;
  fetchState(): Promise<AppState>;
  send(op: QueuedOp): Promise<unknown>;
}

export interface OfflineLayer {
  sync: SyncControl;
  getState(): Promise<AppState>;
  run(method: RuleName, args: unknown[], name: string, params: Record<string, unknown>): Promise<void>;
  /** Forget everything kept on this phone for this person (signing out). */
  forget(userId: UUID): Promise<void>;
}

/** Can't reach the server (as opposed to the server saying no). */
export function isNetworkError(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e);
  return (
    (typeof navigator !== 'undefined' && navigator.onLine === false) ||
    /failed to fetch|load failed|networkerror|network request failed|fetch failed|aborted|timed? ?out|can.t reach the bakery/i.test(m)
  );
}

export function createOfflineLayer(deps: OfflineDeps): OfflineLayer {
  let user: UUID | null = null;
  let loading: Promise<void> | null = null;
  let server: { state: AppState; syncedAt: string } | null = null;
  let outbox: QueuedOp[] = [];
  let failed: FailedOp[] = [];
  let fromCache = false;
  let flushing: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((cb) => cb());
  const online = () => (deps.isOnline ? deps.isOnline() : typeof navigator === 'undefined' || navigator.onLine !== false);

  const key = (what: string, id = user) => `${what}:${id}`;
  const saveQueues = () => Promise.all([idbSet(key('outbox'), outbox), idbSet(key('failed'), failed)]);

  async function ready() {
    const id = await deps.userId();
    if (id === user && !loading) return;
    if (id !== user) {
      user = id;
      loading = (async () => {
        if (!id) {
          server = null;
          outbox = [];
          failed = [];
          return;
        }
        const [s, o, f] = await Promise.all([
          idbGet<typeof server>(key('state', id)),
          idbGet<QueuedOp[]>(key('outbox', id)),
          idbGet<FailedOp[]>(key('failed', id)),
        ]);
        if (user !== id) return;
        server = s ?? null;
        outbox = o ?? [];
        failed = f ?? [];
      })();
    }
    await loading;
    loading = null;
  }

  /** The last synced state with everything still queued applied on top. */
  function view(): AppState | null {
    if (!server) return null;
    if (!outbox.length) return server.state;
    const { db, me } = fromSnapshot(server.state);
    for (const op of outbox) {
      try {
        apply(db, me, op);
      } catch {
        // Something changed underneath it; the server will have the final say.
      }
    }
    return snapshot(db, db.users.find((u) => u.id === me.id) ?? me);
  }

  function apply(db: DB, me: RuleUser, op: QueuedOp) {
    const fn = rules[op.method] as (db: DB, me: RuleUser, ...args: unknown[]) => unknown;
    fn(db, db.users.find((u) => u.id === me.id) ?? me, ...op.args);
  }

  /** Another tab of the app may have synced or queued things meanwhile: the copy on the phone wins. */
  async function reloadQueues() {
    if (!user) return;
    const id = user;
    const [o, f] = await Promise.all([idbGet<QueuedOp[]>(key('outbox', id)), idbGet<FailedOp[]>(key('failed', id))]);
    if (user !== id) return;
    outbox = o ?? [];
    failed = f ?? [];
  }

  async function flushNow() {
    await reloadQueues();
    if (!online() || !outbox.length) return;
    let changed = false;
    try {
      while (outbox.length && user) {
        const op = outbox[0];
        try {
          await deps.send(op);
        } catch (e) {
          if (isNetworkError(e)) break;
          const reason = String((e as Error).message ?? e);
          const conflict = /^CONFLICT:/.test(reason);
          failed = [...failed, { ...op, reason: conflict ? reason.replace(/^CONFLICT:\s*/, '') + '.' : reason, conflict, failedAt: new Date().toISOString() }];
        }
        outbox = outbox.slice(1);
        changed = true;
        await saveQueues();
        emit();
      }
    } finally {
      if (changed) emit();
    }
  }

  function flush(): Promise<void> {
    flushing ??= flushNow().finally(() => {
      flushing = null;
      emit();
    });
    emit();
    return flushing;
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      emit();
      flush();
    });
    window.addEventListener('offline', emit);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && flush());
    setInterval(() => outbox.length && flush(), 20000);
  }

  async function move(id: UUID, change: (op: QueuedOp) => QueuedOp) {
    await ready();
    const f = failed.find((x) => x.id === id);
    if (!f) return;
    const { reason: _r, conflict: _c, failedAt: _f, ...op } = f;
    failed = failed.filter((x) => x.id !== id);
    outbox = [...outbox, change(op)];
    await saveQueues();
    emit();
    await flush();
  }

  const sync: SyncControl = {
    status: () => ({
      online: online(),
      syncing: !!flushing,
      fromCache,
      lastSynced: server?.syncedAt ?? null,
      pending: outbox,
      failed,
    }),
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    flush,
    retry: (id) => move(id, (op) => op),
    useMine: (id) => move(id, (op) => ({ ...op, base: null })),
    async discard(id) {
      await ready();
      failed = failed.filter((x) => x.id !== id);
      await saveQueues();
      emit();
    },
  };

  return {
    sync,

    async getState() {
      await ready();
      if (!flushing) await reloadQueues();
      if (online()) {
        try {
          const s = await deps.fetchState();
          server = { state: s, syncedAt: new Date().toISOString() };
          if (user) idbSet(key('state'), server);
          if (fromCache) {
            fromCache = false;
            emit();
          }
          if (outbox.length) flush();
          return view()!;
        } catch (e) {
          if (!isNetworkError(e) || !server) throw e;
        }
      }
      if (!server) throw new Error('You’re offline, and this phone hasn’t synced yet. Connect once to get started.');
      if (!fromCache) {
        fromCache = true;
        emit();
      }
      return view()!;
    },

    async run(method, args, name, params) {
      await ready();
      if (!flushing) await reloadQueues();
      const op: QueuedOp = {
        id: crypto.randomUUID(),
        method,
        args,
        name,
        params,
        base: null,
        createdAt: new Date().toISOString(),
        label: '',
      };
      const current = view();
      if (current) {
        op.label = labelFor(op, current);
        op.base = baseFor(op, current);
      }
      // Online with nothing queued: straight to the server, like always.
      if (online() && !outbox.length && !flushing) {
        try {
          await deps.send(op);
          return;
        } catch (e) {
          if (!isNetworkError(e)) throw e;
        }
      }
      // Offline: check it against the rules now, so mistakes show straight away.
      if (current) {
        const { db, me } = fromSnapshot(current);
        apply(db, me, op);
      }
      outbox = [...outbox, op];
      await saveQueues();
      emit();
      if (online()) flush();
    },

    async forget(id) {
      await Promise.all([idbDel(key('state', id)), idbDel(key('outbox', id)), idbDel(key('failed', id))]);
      if (user === id) {
        server = null;
        outbox = [];
        failed = [];
        fromCache = false;
        emit();
      }
    },
  };
}

function baseFor(op: QueuedOp, s: AppState): QueuedOp['base'] {
  if (op.method === 'editTask') {
    const t = s.tasks.find((x) => x.id === op.args[0]);
    return t ? { table: 'tasks', id: t.id, version: t.version ?? 1 } : null;
  }
  if (op.method === 'updateReward') {
    const r = s.rewards.find((x) => x.id === op.args[0]);
    return r ? { table: 'rewards', id: r.id, version: r.version ?? 1 } : null;
  }
  return null;
}

/** "Mark ‘Dishes’ as done" – what the queued change was, in plain words. */
export function labelFor(op: Pick<QueuedOp, 'method' | 'args'>, s: AppState): string {
  const a = op.args;
  const q = (t: string | undefined) => (t ? `‘${t}’` : 'a task');
  const task = (id: unknown) => s.tasks.find((t) => t.id === id)?.title;
  const wish = (id: unknown) => s.rewards.find((r) => r.id === id)?.title;
  const claim = (id: unknown) => task(s.claims.find((c) => c.id === id)?.task_id);
  const redemption = (id: unknown) => s.redemptions.find((d) => d.id === id)?.title;
  const input = (x: unknown) => (x as { title?: string })?.title?.trim();
  const partner = (p: Profile | null) => p?.display_name ?? 'your partner';
  switch (op.method) {
    case 'updateProfile': return 'Update your profile';
    case 'createTask': return `Add the task ${q(input(a[0]))}`;
    case 'editTask': return `Edit ${q(task(a[0]) ?? input(a[1]))}`;
    case 'respondShared': return `${a[1] ? 'Agree to' : 'Decline'} ${q(task(a[0]))}`;
    case 'setTaskActive': return `${a[1] ? 'Switch on' : 'Rest'} ${q(task(a[0]))}`;
    case 'bumpTask': return `Warm up ${q(task(a[0]))}`;
    case 'setTaskOrder': return 'Reorder your tasks';
    case 'removeTask': return `Remove ${q(task(a[0]))}`;
    case 'claimTask': return `Mark ${q(task(a[0]))} as done`;
    case 'withdrawClaim': return `Undo “done” on ${q(claim(a[0]))}`;
    case 'reviewClaim': return `${a[1] ? 'Approve' : 'Send back'} ${q(claim(a[0]))}`;
    case 'addReward': return `Wish for ${q(input(a[0]))}`;
    case 'updateReward': return `Edit the wish ${q(wish(a[0]) ?? input(a[1]))}`;
    case 'removeReward': return `Remove the wish ${q(wish(a[0]))}`;
    case 'priceReward': return `Price ${q(wish(a[0]))} at ${a[1]} brownies`;
    case 'redeemReward': return `Cash in ${q(wish(a[0]))}`;
    case 'cancelRedemption': return `Cancel ${q(redemption(a[0]))}`;
    case 'deliverRedemption': return `Mark ${q(redemption(a[0]))} as delivered`;
    case 'giftBrownies': return `Gift ${a[0]} brownies to ${partner(s.partner)}`;
  }
}
