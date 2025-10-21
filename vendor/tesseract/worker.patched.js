// worker.patched.js (robust gegen Pfad-Geraffel)
const BASE = self.location.origin + '/VeganScanner/vendor/tesseract/';
self.version = BASE + 'tesseract-core.wasm.js';
importScripts(BASE + 'worker.min.js');
