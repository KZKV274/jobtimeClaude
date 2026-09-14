'use strict';

const CACHE_VERSION = 'shiftpulse-v1.0.0';
const CACHE_NAME = `shiftpulse-cache-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './vendor/chart.umd.js',
  './vendor/fonts.css',
  './vendor/fonts/inter-latin-400-normal.woff2',
  './vendor/fonts/inter-cyrillic-400-normal.woff2',
  './vendor/fonts/inter-latin-500-normal.woff2',
  './vendor/fonts/inter-cyrillic-500-normal.woff2',
  './vendor/fonts/inter-latin-600-normal.woff2',
  './vendor/fonts/inter-cyrillic-600-normal.woff2',
  './vendor/fonts/inter-latin-700-normal.woff2',
  './vendor/fonts/inter-cyrillic-700-normal.woff2',
  './vendor/fonts/inter-latin-800-normal.woff2',
  './vendor/fonts/inter-cyrillic-800-normal.woff2',
  './vendor/fonts/manrope-latin-700-normal.woff2',
  './vendor/fonts/manrope-cyrillic-700-normal.woff2',
  './vendor/fonts/manrope-latin-800-normal.woff2',
  './vendor/fonts/manrope-cyrillic-800-normal.woff2',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-192.png',
  './icons/icon-192-maskable.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/favicon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL).catch((err) => {
        console.error('App shell caching failed', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key.startsWith('shiftpulse-cache-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // App shell / same-origin: cache-first, falling back to network,
  // and updating the cache in the background (stale-while-revalidate).
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const networkFetch = fetch(req).then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        }).catch(() => cached || caches.match('./index.html'));
        return cached || networkFetch;
      })
    );
    return;
  }

  // Everything else: try network, fall back to cache.
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});
