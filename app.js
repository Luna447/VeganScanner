// Minimaler Offline-OCR Flow ohne CDN.
// Wichtig: Pfade zeigen in deinen Repo-Ordner vendor/tesseract

const $ = sel => document.querySelector(sel);
const statusEl = $('#status');
const ocrOut = $('#ocrOut');

function setStatus(msg) {
  statusEl.textContent = msg || '';
  console.log('[Status]', msg);
}

let worker = null;

async function ensureWorker() {
  if (worker) return worker;

  worker = Tesseract.createWorker({
    // exakt diese relativen Pfade:
    workerPath: 'vendor/tesseract/worker.min.js',
    corePath:   'vendor/tesseract/tesseract-core.wasm.js',
    langPath:   'vendor/tesseract/lang'
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

$('#scanBtn').addEventListener('click', async () => {
  try {
    const file = $('#file').files[0];
    const text = await doOCR(file);
    ocrOut.textContent = text.trim();
  } catch (e) {
    setStatus('Fehler: ' + e.message);
    console.error(e);
  }
});

$('#resetBtn').addEventListener('click', () => {
  $('#file').value = '';
  ocrOut.textContent = '';
  setStatus('');
});

// Optional: beim Verlassen Worker beenden
window.addEventListener('beforeunload', async () => {
  try { if (worker) await worker.terminate(); } catch {}
});
