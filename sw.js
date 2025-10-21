// Simpler App-Shell-SW mit Versionierung. Wenn du an vendor-Dateien drehst, VERSION hochzählen.
const VERSION = 'v2025-10-21a';
const APP_SHELL = [
  '/VeganScanner/',
  '/VeganScanner/index.html',
  '/VeganScanner/app.js',
  '/VeganScanner/manifest.webmanifest',
  '/VeganScanner/vendor/tesseract/tesseract.min.js',
  '/VeganScanner/vendor/tesseract/worker.min.js',
  '/VeganScanner/vendor/tesseract/tesseract-core.wasm.js',
  '/VeganScanner/vendor/tesseract/tesseract-core.wasm',
  '/VeganScanner/icons/icon-192.png',
  '/VeganScanner/icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(APP_SHELL);
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

// Strategie: App-Shell cache-first, Sprachdaten und Bilder network-first mit Fallback.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Nur unsere App managen
  if (!url.pathname.startsWith('/VeganScanner/')) return;

  // Große Sprachdateien nicht precachen, aber nachladen + cachen
  if (url.pathname.includes('/vendor/tesseract/lang/')) {
    e.respondWith(networkThenCache(e.request));
    return;
  }

  // Default: cache-first
  e.respondWith(cacheFirst(e.request));
});

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req, { ignoreVary:true, ignoreSearch:true });
  if (hit) return hit;
  const res = await fetch(req);
  // wasms und js ruhig cachen
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
