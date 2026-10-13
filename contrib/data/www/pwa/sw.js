const CACHE_NAME = 'toniecloud-pwa-v2';
const ASSETS = [
  '/pwa/index.html',
  '/pwa/style.css',
  '/pwa/app.js',
  '/pwa/manifest.json',
  '/favicon.ico',
  '/img_unknown.png',
  '/img_custom.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Cache geloescht:', key);
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // APIs immer direkt vom Netzwerk laden (kein Caching)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // HTML-Dokument-Navigation: Netzwerk zuerst, bei Offline Cache index.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/pwa/index.html'))
    );
    return;
  }

  // Statische Assets: Cache zuerst, Fallback Netzwerk
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return (
        cachedResponse ||
        fetch(event.request).then((networkResponse) => {
          return networkResponse;
        })
      );
    })
  );
});
