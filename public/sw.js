// Marble Mayhem -- Service Worker
// v2: network-first for HTML so stale cached index never breaks new builds.

const CACHE = 'marble-mayhem-v2';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(['/manifest.json'])
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // HTML pages (including '/') -- always network-first.
  // Expo builds use hashed JS filenames; if the cached HTML references old
  // hashes that no longer exist on the CDN, the app breaks with a white screen.
  // Fetching HTML fresh on every load prevents this.
  if (e.request.mode === 'navigate' || url.pathname === '/') {
    e.respondWith(
      fetch(e.req