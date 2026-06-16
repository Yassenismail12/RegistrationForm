const CACHE_NAME = 'yly-v1';

// Assets to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/assets/YLY-logo.png',
  '/assets/Wzara.png',
  '/assets/ITIHAD.png',
  '/assets/Ministry.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Delete old caches from previous versions
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// sw.js — in your fetch handler, bail out early for anything not same-origin
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only cache same-origin requests; let everything else pass through
  if (url.origin !== self.location.origin) {
    return; // don't call event.respondWith — browser handles it normally
  }

  // also skip chrome-extension and non-http schemes
  if (!event.request.url.startsWith('http')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const cache = caches.open('v1');
        cache.then(c => c.put(event.request, response.clone())); // line 51
        return response;
      });
    })
  );
});