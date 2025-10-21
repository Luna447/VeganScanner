// Root-Setup. Wenn du an vendor-Dateien drehst: VERSION hochzählen.
const VERSION = 'v16';

const APP_SHELL = [
  'index.html',
  'app.js',
  'manifest.webmanifest',
  'vendor/tesseract/tesseract.min.js',
  'vendor/tesseract/worker.min.js',
  'vendor/tesseract/tesseract-core.wasm.js',
  'vendor/tesseract/tesseract-core.wasm',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    try { await c.addAll(APP_SHELL); } catch(e) { /* dev server darf auch mal zicken */ }
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

// Strategie: App-Shell cache-first, Sprachdaten network-first mit Fallback.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Sprachmodelle: networkThenCache
  if (url.pathname.includes('/vendor/tesseract/lang/')) {
    e.respondWith(networkThenCache(e.request));
    return;
  }

  // App-Shell: cache-first
  const isShell = APP_SHELL.some(p => url.pathname.endsWith('/' + p) || url.pathname === '/' && p === 'index.html');
  if (isShell) {
    e.respondWith(cacheFirst(e.request));
    return;
  }

  // Rest: Durchlassen
});

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req, { ignoreVary:true, ignoreSearch:true });
  if (hit) return hit;
  const res = await fetch(req);
  cache.put(req, res.clone());
  return res;
}

async function networkThenCache(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreVary:true, ignoreSearch:true });
    if (hit) return hit;
    throw new Error('Offline und nicht im Cache: ' + req.url);
  }
}
