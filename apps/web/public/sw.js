/*
 * SampConnect service worker: app-shell caching only.
 * Message data is never cached here; it lives in IndexedDB and is managed by the offline engine.
 * API requests always go to the network (no stale auth or data responses from cache).
 */
const VERSION = 'sc-shell-v1';
const SHELL = ['/app', '/login', '/register', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API and sockets: network only

  // Static build assets are content-hashed: cache first.
  if (
    url.pathname.startsWith('/_next/static/') ||
    /\.(?:woff2?|svg|png|css|js)$/.test(url.pathname)
  ) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }

  // Pages: network first, fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(
          async () => (await caches.match(req)) || (await caches.match('/app')) || Response.error(),
        ),
    );
  }
});

/*
 * Browser notifications (Web Push). The payload is encrypted end to end and decrypted by the
 * browser; it is shown only while no Connect tab is focused (an open tab shows messages live).
 */
self.addEventListener('push', (event) => {
  let p = {};
  try {
    p = event.data ? event.data.json() : {};
  } catch {
    p = { title: 'SampConnect', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((tabs) => {
      if (tabs.some((t) => t.focused)) return undefined;
      if (typeof p.badge === 'number' && self.navigator.setAppBadge)
        self.navigator.setAppBadge(p.badge).catch(() => undefined);
      return self.registration.showNotification(p.title || 'SampConnect', {
        body: p.body || '',
        icon: '/icon.svg',
        badge: '/icon.svg',
        tag: p.tag || undefined,
        renotify: !!p.tag,
        requireInteraction: p.data && p.data.type === 'call',
        data: { url: p.url || '/app', ...(p.data || {}) },
      });
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(
    (event.notification.data && event.notification.data.url) || '/app',
    self.location.origin,
  );
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (tabs) => {
      const tab = tabs.find((t) => new URL(t.url).pathname.startsWith('/app'));
      if (tab) {
        await tab.focus();
        tab.postMessage({ type: 'open', url: target.pathname + target.search });
        return;
      }
      await self.clients.openWindow(target.href);
    }),
  );
});

// The browser rotated the subscription: let an open tab re-register it.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((tabs) => tabs.forEach((t) => t.postMessage({ type: 'resubscribe' }))),
  );
});
