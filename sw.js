const CACHE_NAME = 'gazi-cash-shell-v7-debt-invoice-details';
const APP_SHELL = [
  './',
  './index.html',
  './index-B73cf3Uz.js',
  './index-CIUyuTgi.css',
  './invoice-history.js',
  './invoice-history.css',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(
        APP_SHELL.map(async (url) => {
          const absoluteUrl = new URL(url, self.registration.scope);
          const response = await fetch(new Request(absoluteUrl, { cache: 'reload' }));
          if (!response.ok) {
            throw new Error(`Failed to cache ${url}: ${response.status}`);
          }
          await cache.put(url, response);
        }),
      );
    }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter(
            (name) =>
              name !== CACHE_NAME &&
              (name.startsWith('gazi-cash-shell-') ||
                (name.startsWith('workbox-precache-') &&
                  name.includes(self.registration.scope))),
          )
          .map((name) => caches.delete(name)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put('./index.html', response.clone());
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          return (
            (await cache.match('./index.html')) ||
            (await cache.match('./')) ||
            Response.error()
          );
        }),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response.ok) return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    }),
  );
});
