// app.js
const els = {
  file:   document.getElementById('file'),
  scan:   document.getElementById('scan'),
  prog:   document.getElementById('prog'),
  status: document.getElementById('status'),
  out:    document.getElementById('out'),
  thumbs: document.getElementById('thumbs'),
  log:    document.getElementById('log'),
};

let ocrWorker = null;
let files = [];

function log(...args) {
  const line = args.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' ');
  els.log.textContent += line + '\n';
  console.log('[app]', ...args);
}

function setBusy(b) {
  els.scan.disabled = b || files.length === 0;
  els.file.disabled = b;
  els.prog.hidden = !b;
}

function setStatus(msg, cls='') {
  els.status.className = 'muted mono ' + cls;
  els.status.textContent = msg;
}

function renderThumbs() {
  els.thumbs.innerHTML = '';
  files.forEach(f => {
    const url = URL.createObjectURL(f);
    const img = document.createElement('img');
    img.src = url;
    img.onload = () => URL.revokeObjectURL(url);
    els.thumbs.appendChild(img);
  });
}

// Falls das lokale Script fehlschlug: gleiches Major (v5) vom CDN nachladen
async function ensureLibrary() {
  if (typeof window.Tesseract !== 'undefined') return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('tesseract.min.js konnte nicht geladen werden'));
    document.head.appendChild(s);
  });
}

// Wichtiger Teil: corePath zeigt auf die .wasm.js, nicht nur den Ordner.
// Logger NICHT als Option mitgeben, sondern global setzen.
const paths = {
  workerPath: 'vendor/tesseract/worker.min.js',
  corePath:   'vendor/tesseract/tesseract-core.wasm.js',
  langPath:   'vendor/tesseract/lang'
};

Tesseract.setLogger(m => {
  if (m.progress != null) els.prog.value = m.progress;
  if (m.status) els.status.textContent = m.status;
  if (m.progress != null || m.status) log('[tess]', m.status || '', m.progress ?? '');
});

async function ensureWorker() {
  await ensureLibrary();
  if (!window.Tesseract) throw new Error('Tesseract nicht geladen');

  if (ocrWorker) return ocrWorker;

  const w = Tesseract.createWorker({
    workerPath: paths.workerPath,
    corePath:   paths.corePath,
    langPath:   paths.langPath,
    workerBlobURL: false
  });

  await w.load();
  await w.loadLanguage('deu+eng');
  await w.initialize('deu+eng');

  ocrWorker = w;
  log('Worker bereit');
  return w;
}

els.file.addEventListener('change', () => {
  files = Array.from(els.file.files || []);
  renderThumbs();
  setStatus(files.length ? `${files.length} Datei(en) gewählt` : 'keine Dateien');
  els.scan.disabled = files.length === 0;
});

els.scan.addEventListener('click', async () => {
  if (!files.length) return;
  setBusy(true);
  setStatus('Scanne...', 'ok');
  els.out.textContent = '';

  try {
    const w = await ensureWorker();
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setStatus(`Scanne ${i+1}/${files.length}: ${f.name}`, 'ok');
      const { data } = await w.recognize(f);
      els.out.textContent += `# ${f.name}\n${data.text.trim()}\n\n`;
    }
    setStatus('Fertig.', 'ok');
  } catch (e) {
    console.error(e);
    setStatus('Fehler: ' + e.message, 'err');
    log('ERR', e.stack || e);
  } finally {
    setBusy(false);
  }
});

// Selbsttest
window.addEventListener('load', async () => {
  try {
    const check = async (p) => {
      const r = await fetch(p);
      const len = r.headers.get('content-length');
      log('check', p, r.status, len);
      return +len || 0;
    };
    await check(paths.workerPath);
    await check(paths.corePath);
    await check('vendor/tesseract/tesseract-core.wasm'); // eine der Varianten

    setTimeout(() => log('Tesseract?', typeof window.Tesseract), 200);
    setStatus('Bereit.');
  } catch (e) {
    log('Self-check failed', e);
  }
});

window.addEventListener('beforeunload', async () => {
  try { if (ocrWorker) await ocrWorker.terminate(); } catch {}
});
