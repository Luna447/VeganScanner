/* sw.js – entkoppelt alte Caches/Registrierungen */
self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    // sich selbst deregistrieren
    const regs = await self.registration.unregister();
  })());
});
