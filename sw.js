// SW: Version heben, wenn du etwas an vendor/tesseract änderst
const VERSION = 'vegan-scanner-v6_7';

const APP_SHELL = [
  'index.html',
  'app.js?v=V6_7',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',

  // Tesseract-Dateien (ohne Query – wir matchen ignoreSearch)
  'vendor/tesseract/tesseract.min.js',
  'vendor/tesseract/worker.min.js',
  'vendor/tesseract/tesseract-core.wasm.js',
  'vendor/tesseract/tesseract-core.wasm',

  // Falls vorhanden, stören nicht:
  'vendor/tesseract/tesseract-core-simd.wasm',
  'vendor/tesseract/tesseract-core-lstm.wasm',
  'vendor/tesseract/tesseract-core-simd-lstm.wasm',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    try { await c.addAll(APP_SHELL); } catch(e) { /* Dev-Server darf zicken */ }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => k !== VERSION && caches.delete(k)));
    self.clients.claim();
  })());
});

// Sprachdaten: network-first, Rest: cache-first
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (url.pathname.includes('/vendor/tesseract/lang/')) {
    e.respondWith(networkThenCache(e.request));
    return;
  }

  const isShell = APP_SHELL.some(p =>
    url.pathname.endsWith('/' + p) || (url.pathname === '/' && p === 'index.html'));

  if (isShell) {
    e.respondWith(cacheFirst(e.request));
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req, { ignoreVary: true, ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok && res.type !== 'opaque') {
    try { await cache.put(req, res.clone()); } catch {}
  }
  return res;
}

async function networkThenCache(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type !== 'opaque') {
      try { await cache.put(req, res.clone()); } catch {}
    }
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreVary: true, ignoreSearch: true });
    if (hit) return hit;
    throw new Error('Offline und nicht im Cache: ' + req.url);
  }
}
