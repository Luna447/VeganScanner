const $ = s => document.querySelector(s);
const statusEl = $('#status'), ocrOut = $('#ocrOut');
const setStatus = m => { statusEl.textContent = m || ''; console.log('[Status]', m); };

let worker;

async function ensureWorker() {
  if (worker) return worker;

  worker = Tesseract.createWorker({
    // harte, relative Pfade – keine Querystrings, keine Module
    workerPath: 'vendor/tesseract/worker.min.js',
    corePath:   'vendor/tesseract/tesseract-core.wasm.js',
    langPath:   'vendor/tesseract/lang',
    logger: m => console.log('[tess]', m)
  });

  setStatus('Lade OCR-Worker…');
  await worker.load();
  setStatus('Lade Sprachdaten…');
  await worker.loadLanguage('deu+eng');
  await worker.initialize('deu+eng');

  console.log('Tesseract version:', Tesseract.version);
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

window.addEventListener('beforeunload', async () => {
  try { if (worker) await worker.terminate(); } catch {}
});
