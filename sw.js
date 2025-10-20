// sw.js
const CACHE = 'veganscanner-v18';

// CDN-Assets (exakte Versionen) + lokale Dateien
const CDN = {
  worker: 'https://unpkg.com/tesseract.js@2.1.1/dist/worker.min.js',
  coreJS: 'https://unpkg.com/tesseract.js-core@2.1.1/tesseract-core.wasm.js',
  coreWASM: 'https://unpkg.com/tesseract.js-core@2.1.1/tesseract-core.wasm',
};

const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './ingredients-data.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // Nur die Sprachdaten bleiben lokal
  './tesseract/tessdata/eng.traineddata.gz',
  './tesseract/tessdata/deu.traineddata.gz',
  // Die Tesseract-Bits holen wir von CDN und cachen sie mit:
  CDN.worker,
  CDN.coreJS,
  CDN.coreWASM,
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(err => {
      // Falls irgendein Asset rumzickt, SW-Install nicht komplett killen
      console.error('SW install error', err);
    })
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
});

// Cache-first für alles von eigener Origin + die drei CDN-URLs
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const isOwn = url.origin === self.location.origin;
  const isCDN = url.href === CDN.worker || url.href === CDN.coreJS || url.href === CDN.coreWASM;

  if (e.request.method !== 'GET' || (!isOwn && !isCDN)) return;

  e.respondWith(
    caches.match(e.request).then(hit => {
      if (hit) return hit;
      return fetch(e.request).then(resp => {
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return resp;
      }).catch(() => hit);
    })
  );
});
