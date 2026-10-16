// Web Push on this phone: ask permission (from a tap), subscribe with the
// app's public VAPID key, and save the subscription in Supabase so the
// send-push Edge Function can reach it.
import type { Backend } from './backend';

export type PushSupport =
  | 'ok'
  /** iPhone/iPad in Safari: needs to be added to the Home Screen first. */
  | 'ios-browser'
  /** No push support in this browser at all. */
  | 'unsupported';

export function pushSupport(): PushSupport {
  const hasApis = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (hasApis) return 'ok';
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone;
  return ios && !standalone ? 'ios-browser' : 'unsupported';
}

async function registration() {
  const reg = await navigator.serviceWorker.getRegistration();
  if (reg) return navigator.serviceWorker.ready;
  // dev builds don't register the service worker on load
  await navigator.serviceWorker.register('./sw.js');
  return navigator.serviceWorker.ready;
}

/** Is this phone currently subscribed? */
export async function pushEnabled(): Promise<boolean> {
  if (pushSupport() !== 'ok' || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}

function keyBytes(base64url: string) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function enablePush(backend: Backend): Promise<void> {
  if (!backend.push) throw new Error('Notifications aren’t set up for this app yet.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notifications are blocked for this app. Allow them in your phone’s settings, then try again.'
        : 'No problem. You can switch them on any time.',
    );
  }
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(backend.push.publicKey) });
  }
  await backend.push.save(sub.toJSON());
}

export async function disablePush(backend: Backend): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await backend.push?.remove(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}
