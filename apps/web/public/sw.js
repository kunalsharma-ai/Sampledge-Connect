/*
 * Sampledge Connect service worker: app-shell caching only.
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
