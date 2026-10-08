import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createBackend, type Backend } from '../lib/backend';
import { describe } from '../lib/describe';
import type { AppState, UUID } from '../lib/types';
import { derive, type Derived } from '../lib/util';

export type ToastTone = 'info' | 'success' | 'error';
export interface Toast {
  id: number;
  text: string;
  tone: ToastTone;
  delta?: number | null;
}

interface AppCtx {
  backend: Backend;
  status: 'loading' | 'signed-out' | 'signed-in';
  state: AppState | null;
  d: Derived | null;
  loadError: string | null;
  recovery: boolean;
  endRecovery(): void;
  refresh(): Promise<void>;
  /** Run a backend change, refresh, and report the outcome. Returns false on error. */
  act(fn: (b: Backend) => Promise<unknown>, opts?: { success?: string; celebrate?: boolean }): Promise<boolean>;
  toasts: Toast[];
  toast(text: string, tone?: ToastTone, delta?: number | null): void;
  dismissToast(id: number): void;
  burst: number;
  celebrate(): void;
}

const Ctx = createContext<AppCtx | null>(null);

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

/** For screens that only render once someone is signed in and loaded. */
export function useLoaded() {
  const c = useApp();
  if (!c.state || !c.d) throw new Error('state not loaded');
  return { ...c, state: c.state, d: c.d };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const backend = useMemo(createBackend, []);
  const [userId, setUserId] = useState<UUID | null | undefined>(undefined);
  const [state, setState] = useState<AppState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [burst, setBurst] = useState(0);
  const toastId = useRef(1);
  const lastBalance = useRef<number | null>(null);
  const lastStatus = useRef<string | null>(null);

  const toast = useCallback((text: string, tone: ToastTone = 'info', delta?: number | null) => {
    const id = toastId.current++;
    setToasts((ts) => [...ts.slice(-2), { id, text, tone, delta }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), tone === 'error' ? 5200 : 3800);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const celebrate = useCallback(() => setBurst((n) => n + 1), []);

  const refresh = useCallback(async () => {
    try {
      const s = await backend.getState();
      const bal = s.balances[s.me.id] ?? 0;
      if (lastBalance.current != null && bal > lastBalance.current) celebrate();
      lastBalance.current = bal;
      const st = s.me.status ?? 'approved';
      if (lastStatus.current === 'pending' && st === 'approved') {
        toast('You’re approved! Welcome to the bakery.', 'success');
        celebrate();
      }
      lastStatus.current = st;
      setState(s);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [backend, celebrate, toast]);

  // Auth
  useEffect(() => {
    let alive = true;
    backend.currentUserId().then((id) => alive && setUserId(id));
    const off = backend.onAuthChange((id, event) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setUserId(id);
    });
    return () => {
      alive = false;
      off();
    };
  }, [backend]);

  useEffect(() => {
    lastBalance.current = null;
    lastStatus.current = null;
    setState(null);
    if (userId) refresh();
  }, [userId, refresh]);

  // Live updates from the partner
  const coupleId = state?.me.couple_id ?? null;
  const partnerName = state?.partner?.display_name ?? 'Your partner';
  const partnerNameRef = useRef(partnerName);
  partnerNameRef.current = partnerName;
  useEffect(() => {
    if (!userId) return;
    return backend.subscribe(userId, coupleId, (activity) => {
      refresh();
      if (activity && activity.actor_id !== userId) {
        toast(describe(activity, userId, partnerNameRef.current), 'info', activity.beneficiary_id === userId ? activity.delta : null);
      }
    });
  }, [backend, userId, coupleId, refresh, toast]);

  // Safety net: refresh when the app comes back to the foreground, and poll
  // (quickly while waiting to be paired, slowly otherwise).
  useEffect(() => {
    if (!userId) return;
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => document.visibilityState === 'visible' && refresh(), coupleId ? 30000 : 4000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [userId, coupleId, refresh]);

  const act = useCallback<AppCtx['act']>(
    async (fn, opts) => {
      try {
        await fn(backend);
        await refresh();
        if (opts?.celebrate) celebrate();
        if (opts?.success) toast(opts.success, 'success');
        return true;
      } catch (e) {
        toast((e as Error).message || 'Something went wrong.', 'error');
        return false;
      }
    },
    [backend, refresh, toast, celebrate],
  );

  const d = useMemo(() => (state ? derive(state) : null), [state]);
  const status: AppCtx['status'] = userId === undefined ? 'loading' : userId ? 'signed-in' : 'signed-out';

  const value: AppCtx = {
    backend,
    status,
    state,
    d,
    loadError,
    recovery,
    endRecovery: () => setRecovery(false),
    refresh,
    act,
    toasts,
    toast,
    dismissToast,
    burst,
    celebrate,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
