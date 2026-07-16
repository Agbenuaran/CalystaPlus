// Calysta Plus CRM — Service Worker
// Goal: the app SHELL (this HTML file + fonts/CSS/icons) loads even with
// no connection, so a field agent on a dead network can still open the app,
// see their last-synced data, and use the offline outbox to queue work.
// Supabase API calls are deliberately left untouched — those are handled
// by the app's own offline outbox (calysta_outbox), not by this worker.

const CACHE_VERSION = 'calysta-shell-v1';
const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(SHELL_URLS).catch(() => {
        // Individual failures (e.g. a file not deployed yet) shouldn't block install
        return Promise.allSettled(SHELL_URLS.map((u) => cache.add(u)));
      })
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Never intercept Supabase (data must always be live or explicitly queued
  // by the app's own outbox — a stale cached API response would be worse
  // than a failed request).
  if (url.hostname.endsWith('.supabase.co')) return;

  // Only handle GET requests; everything else passes straight through.
  if (req.method !== 'GET') return;

  // App navigation (loading the page itself): try network first so the
  // team always gets the latest deployed version, fall back to the cached
  // shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Same-origin assets (manifest, icons): cache-first.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
    return;
  }

  // Cross-origin CDN assets (Tailwind, Lucide, Google Fonts): stale-while-
  // revalidate — serve the cached copy instantly if we have one (works
  // offline after the first successful load), and refresh it in the
  // background whenever there's a connection.
  event.respondWith(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    )
  );
});
