console.log('[Startup] App init');

const $ = s => document.querySelector(s);
const statusEl = $('#status');
const ocrOut = $('#ocrOut');
const setStatus = m => { statusEl.textContent = m || ''; console.log('[Status]', m); };

let worker;

async function ensureWorker() {
  if (worker) return worker;

  worker = await Tesseract.createWorker({
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/worker.min.js',
    corePath:   'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.5/tesseract-core-wasm.js', // Monolith (~4.6 MB)
    langPath:   'vendor/tesseract/lang', // deine Sprachdaten lokal
    logger: 'dummy' // keine Funktion hier, sonst DataCloneError
  });

  setStatus('Lade OCR-Worker…');
  await worker.load();

  setStatus('Lade Sprachdaten (deu+eng)…');
  await worker.loadLanguage('deu+eng');
  await worker.initialize('deu+eng');

  setStatus('Bereit.');
  return worker;
}

async function doOCR(file) {
  if (!file) throw new Error('Keine Datei ausgewählt');
  const w = await ensureWorker();
  setStatus('Erkenne Text…');
  const { data } = await w.recognize(file);
  setStatus('Fertig.');
  return data.text || '';
}

document.getElementById('scanBtn').addEventListener('click', async () => {
  try {
    const file = document.getElementById('file').files[0];
    const text = await doOCR(file);
    ocrOut.textContent = (text || '').trim();
  } catch (e) {
    setStatus('Fehler: ' + (e?.message || String(e)));
    console.error(e);
  }
});

document.getElementById('resetBtn').addEventListener('click', () => {
  document.getElementById('file').value = '';
  ocrOut.textContent = '';
  setStatus('');
});

window.addEventListener('beforeunload', () => {
  try { worker?.terminate(); } catch {}
});
