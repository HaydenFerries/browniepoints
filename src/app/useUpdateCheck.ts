import { useEffect, useState } from 'react';

declare const __APP_VERSION__: string;

const CHECK_EVERY_MS = 10 * 60 * 1000;

/**
 * Notices when a newer version of the app has been deployed. When the app is
 * brought back to the front it reloads straight into the new version, unless
 * a sheet is open (someone's mid-edit), in which case it reports `ready` so a
 * "tap to update" bar can be shown instead.
 */
export function useUpdateCheck() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let cancelled = false;

    async function check(resuming: boolean) {
      try {
        const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const { version } = (await res.json()) as { version?: string };
        if (cancelled || !version || version === __APP_VERSION__) return;
        if (resuming && !document.body.classList.contains('sheet-open')) location.reload();
        else setReady(true);
      } catch {
        /* offline: try again later */
      }
    }

    const onVisible = () => document.visibilityState === 'visible' && check(true);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => document.visibilityState === 'visible' && check(false), CHECK_EVERY_MS);
    check(false);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, []);

  return ready;
}
