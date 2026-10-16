// Brownie Points service worker: makes the app installable and lets it open
// with no signal.
// * On install it downloads the whole app (the build fills in PRECACHE and a
//   per-build BUILD id), so a cold start offline still works.
// * Pages are network-first (so new deploys show up) but fall back to the saved
//   copy after a few seconds or when offline. Built files are cache-first.
// * Supabase and other cross-origin requests are never touched, and neither is
//   version.json (the app's "is there a newer version?" check).
// It also shows push notifications and opens the right screen when tapped.
const BUILD = 'dev';
const PRECACHE = [];
const CACHE = 'bp-' + BUILD;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // straight from the network, so a fresh deploy never saves stale files
      .then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bp-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** The saved app page (any query string, any path inside the app). */
const savedPage = (req) =>
  caches
    .match(req, { ignoreSearch: true })
    .then((hit) => hit || caches.match('./', { ignoreSearch: true }))
    .then((hit) => hit || caches.match('./index.html'));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/version.json')) return;

  if (req.mode === 'navigate') {
    const network = fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    });
    // Patchy signal: don't leave a blank screen; use the saved copy after 4s.
    const slow = new Promise((resolve) => setTimeout(resolve, 4000)).then(savedPage);
    event.respondWith(
      Promise.race([network, slow.then((hit) => hit || network)]).catch(() =>
        savedPage(req).then((hit) => hit || Response.error()),
      ),
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

// Push notifications from the send-push Edge Function: { title, body, url, tag }
self.addEventListener('push', (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(msg.title || 'Brownie Points', {
      body: msg.body || '',
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      tag: msg.tag || undefined,
      renotify: !!msg.tag,
      data: { url: msg.url || '#home' },
    }),
  );
});

// Tapping a notification: bring the app to the front on the right screen.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const hash = (event.notification.data && event.notification.data.url) || '';
  const target = new URL('./' + (hash.startsWith('#') ? hash : ''), self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => w.url.startsWith(self.registration.scope));
      if (open) {
        return open.focus().then((w) => (w || open).navigate(target)).catch(() => self.clients.openWindow(target));
      }
      return self.clients.openWindow(target);
    }),
  );
});
