import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';

// Cloudflare Turnstile, checked by Supabase on sign-up, sign-in and password
// reset. Only active when a site key is configured for the real backend.
export const CAPTCHA_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || undefined;

declare global {
  interface Window {
    turnstile?: {
      render(el: HTMLElement, options: Record<string, unknown>): string;
      reset(widgetId?: string): void;
      remove(widgetId: string): void;
    };
  }
}

let scriptLoading: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptLoading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptLoading = null;
      reject(new Error('Turnstile failed to load'));
    };
    document.head.appendChild(s);
  });
  return scriptLoading;
}

export interface CaptchaHandle {
  /** Tokens are single-use: call after every attempt to get a fresh one. */
  reset(): void;
}

/** Invisible for most people; shows a checkbox only when Cloudflare isn't sure. */
export function Captcha({ onToken, ref }: { onToken: (token: string | null) => void; ref?: Ref<CaptchaHandle> }) {
  const el = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const [failed, setFailed] = useState(false);
  // interaction-only: the widget is invisible unless Cloudflare wants a click
  const [interactive, setInteractive] = useState(false);

  useImperativeHandle(ref, () => ({
    reset() {
      onTokenRef.current(null);
      if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
    },
  }));

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then(() => {
        if (cancelled || !el.current || !window.turnstile || !CAPTCHA_SITE_KEY) return;
        widget.current = window.turnstile.render(el.current, {
          sitekey: CAPTCHA_SITE_KEY,
          theme: 'dark',
          size: 'flexible',
          appearance: 'interaction-only',
          callback: (token: string) => {
            setFailed(false);
            onTokenRef.current(token);
          },
          'expired-callback': () => onTokenRef.current(null),
          'before-interactive-callback': () => setInteractive(true),
          'after-interactive-callback': () => setInteractive(false),
          'error-callback': () => {
            setFailed(true);
            onTokenRef.current(null);
          },
        });
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, []);

  return (
    <div className={`captcha ${interactive || failed ? '' : 'is-collapsed'}`}>
      <div ref={el} />
      {failed && <p className="form-error">We couldn’t check you’re human. Check your connection, or reload the page.</p>}
    </div>
  );
}
