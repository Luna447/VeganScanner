// worker.patched.js
const BASE = 'https://luna447.github.io/VeganScanner/vendor/tesseract/';
self.version = BASE + 'tesseract-core.wasm.js';
importScripts(BASE + 'worker.min.js');
