// SW – VeganScanner (V6.8)
// Wichtig: Query-Strings werden NICHT mehr ignoriert, um Cache-Busting zu erlauben.
const VERSION = 'vegan-scanner-v6_8';

const APP_SHELL = [
  'index.html',
  'app.js?v=V6_8',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  // Tesseract-Files ohne Query, aber wir matchen jetzt MIT Query
  'vendor/tesseract/tesseract.min.js',
  'vendor/tesseract/worker.min.js',
  'vendor/tesseract/tesseract-core.wasm.js',
  'vendor/tesseract/tesseract-core.wasm'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    try { await c.addAll(APP_SHELL); } catch(e) {}
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
  // Query-Strings NICHT ignorieren
  const hit = await cache.match(req, { ignoreVary: true, ignoreSearch: false });
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
    const hit = await cache.match(req, { ignoreVary: true, ignoreSearch: false });
    if (hit) return hit;
    throw new Error('Offline und nicht im Cache: ' + req.url);
  }
}
