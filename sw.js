const CACHE = 'veganscanner-v5';
const ASSETS = [
  './','./index.html','./app.js','./manifest.webmanifest',
  './ingredients-data.json',
  './icons/icon-192.png','./icons/icon-512.png',
  './tesseract/tesseract.min.js','./tesseract/worker.min.js',
  './tesseract/tesseract-core.wasm',
  './tesseract/tessdata/eng.traineddata.gz',
  './tesseract/tessdata/deu.traineddata.gz'
];


self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
});
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
      // Dynamisch nachcachen: nur GET und nur eigene Domain
      try {
        const url = new URL(e.request.url);
        if (e.request.method === 'GET' && url.origin === self.location.origin) {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
      } catch {}
      return resp;
    }).catch(() => r))
  );
});
