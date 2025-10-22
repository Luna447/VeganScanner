/* app.js – VeganScanner (V6.1)
   • Persistenter Worker (schneller bei mehreren Scans)
   • Logger zurück + indeterminater Progress
   • Aggressiveres Resize + B/W-Threshold
   • Offline-first (vendor/), Online-Fallback (CDN)
*/

// ===== BOOT DIAGNOSE =====
console.log('[boot] app.js geladen');
window.addEventListener('error', e => console.error('[JS-Error]', e.message, e.filename + ':' + e.lineno));
window.addEventListener('unhandledrejection', e => console.error('[Promise-Reject]', e.reason));

// ===== DOM HOOKS =====
const els = {
  file:   document.getElementById('file'),
  scan:   document.getElementById('scan'),
  prog:   document.getElementById('prog'),   // <progress id="prog">
  status: document.getElementById('status'),
  out:    document.getElementById('out'),
  thumbs: document.getElementById('thumbs'),
  log:    document.getElementById('log'),
};

let files = [];
let worker = null;   // persistenter Worker

// ===== UTIL =====
function log(...args) {
  const line = args.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' ');
  if (els.log) els.log.textContent += line + '\n';
  console.log('[app]', ...args);
}
function setBusy(b) {
  if (els.scan) els.scan.disabled = b || files.length === 0;
  if (els.file) els.file.disabled = b;
  if (els.prog) els.prog.hidden = !b;
}
function setStatus(msg, cls = '') {
  if (!els.status) return;
  els.status.className = 'muted mono ' + cls;
  els.status.textContent = msg;
}
function renderThumbs() {
  if (!els.thumbs) return;
  els.thumbs.innerHTML = '';
  files.forEach(f => {
    const url = URL.createObjectURL(f);
    const img = document.createElement('img');
    img.decoding = 'async';
    img.loading = 'lazy';
    img.src = url;
    img.onload = () => URL.revokeObjectURL(url);
    els.thumbs.appendChild(img);
  });
}

// ===== PROGRESS =====
let rafLock = false;
function setProgressIndeterminate(on) {
  if (!els.prog) return;
  if (on) {
    // indeterminat: value-Attribut entfernen
    els.prog.removeAttribute('value');
    els.prog.max = 1;
  } else {
    els.prog.value = 0;
    els.prog.max = 1;
  }
}
function setProgressRatio(r) {
  if (!els.prog) return;
  if (rafLock) return;
  rafLock = true;
  requestAnimationFrame(() => {
    els.prog.max = 1;
    els.prog.value = Math.max(0, Math.min(1, r || 0));
    rafLock = false;
  });
}

// ===== PFADKONFIG OFFLINE =====
const paths = {
  workerPath: 'vendor/tesseract/worker.min.js',
  corePath:   'vendor/tesseract/tesseract-core.wasm.js',
  langPath:   'vendor/tesseract/lang'
};

// ===== ONLINE-FALLBACK (nur wenn Tesseract fehlt) =====
async function ensureLibrary() {
  // Wenn vorhanden, aber nicht v5 => neu laden
  if (typeof window.Tesseract !== 'undefined') {
    const ver = String(window.Tesseract.version || '');
    console.log('[tess] vorhandene Version:', ver);
    if (/^5\./.test(ver)) return; // passt
  }

  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload = () => {
      console.log('[tess] geladen:', window.Tesseract?.version);
      resolve();
    };
    s.onerror = () => reject(new Error('tesseract.min.js konnte nicht geladen werden'));
    document.head.appendChild(s);
  });
}


// ===== PREPROCESSING (schneller + stabiler OCR-Input) =====
async function preprocessImage(file) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = URL.createObjectURL(file);
  });

  // Aggressiveres Resize: große, komprimierte JPGs werden sonst langsam
  const maxSide = 900; // vorher 1500
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);

  // Graustufen + härtere Schwelle + leichte Entglättung
  const data = ctx.getImageData(0, 0, w, h);
  const p = data.data;
  for (let i = 0; i < p.length; i += 4) {
    const g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    // etwas knackiger: harte Schwelle um 180 + clamp
    const v = g > 200 ? 255 : g < 70 ? 0 : g;
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  ctx.putImageData(data, 0, 0);

  URL.revokeObjectURL(img.src);
  return c;
}

// ===== Vegan-Quickcheck (Platzhalter) =====
function analyzeIngredients(txt) {
  if (!txt || !txt.trim()) return '– Kein Text für Zutatenanalyse –';
  const lower = txt.toLowerCase();
  const redFlags = ['gelatine', 'e120', 'karmin', 'l-cystein', 'molke', 'honig', 'fisch', 'schwein', 'rind'];
  const hit = redFlags.find(k => lower.includes(k));
  return hit ? `Vegan-Quickcheck: potentiell NICHT vegan (gefunden: "${hit}")`
             : 'Vegan-Quickcheck: keine offensichtlichen tierischen Zutaten gefunden';
}

// ===== Worker-Setup (persistenter Worker, v5-kompatibel) =====
async function ensureWorker(lang = 'deu') {
  await ensureLibrary();
  const T = window.Tesseract;
  if (!T) throw new Error('Tesseract nicht geladen');

  if (worker) return worker;

  // Sicherer Progress: erst versuchen, den globalen Logger zu setzen (wird NICHT über postMessage geschickt)
  try {
    if (typeof T.setLogger === 'function') {
      T.setLogger(m => {
        try {
          if (m && typeof m.progress === 'number') {
            setProgressRatio(m.progress);           // echter Fortschritt
          } else {
            setProgressIndeterminate(true);         // „arbeitet…“
          }
          if (m && m.status) setStatus(m.status, 'ok');
        } catch (_) {}
      });
    }
  } catch (_) {
    // Notfalls ignorieren; indeterminate bleibt aktiv
  }

  // WICHTIG: createWorker ist in v5 ASYNC
  worker = await T.createWorker({
    workerPath: 'vendor/tesseract/worker.min.js',
    corePath:   'vendor/tesseract/tesseract-core.wasm.js',
    langPath:   'vendor/tesseract/lang',
    workerBlobURL: false,
    gzip: false
    // KEIN logger hier! Sonst DataCloneError in manchen Umgebungen.
  });

  await worker.load();
  await worker.loadLanguage(lang);
  await worker.initialize(lang);
  await worker.setParameters({
    tessedit_pageseg_mode: '6',
    tessedit_ocr_engine_mode: '1',
    user_defined_dpi: '150',
    preserve_interword_spaces: '1'
  });

  return worker;
}

// ===== DATEI-EVENTS =====
if (els.file) {
  els.file.addEventListener('change', () => {
    files = Array.from(els.file.files || []);
    renderThumbs();
    setStatus(files.length ? `${files.length} Datei(en) gewählt` : 'keine Dateien');
    if (els.scan) els.scan.disabled = files.length === 0;
  });
}

// direkt vor der Schleife in doScan():
let fakeTimer = null;

// pro Datei:
setProgressIndeterminate(true);
setProgressRatio(0);
clearInterval(fakeTimer);
fakeTimer = setInterval(() => {
  // sanft Richtung 0.9 „atmen“, falls keine echten Updates kommen
  if (els.prog && !isNaN(els.prog.value)) {
    const v = Math.min(0.9, (Number(els.prog.value) || 0) + 0.02);
    setProgressRatio(v);
  }
}, 250);

// nach erfolgreichem recognize:
clearInterval(fakeTimer);
setProgressRatio(1);

// im finally von doScan():
clearInterval(fakeTimer);
setProgressIndeterminate(false);
setProgressRatio(0);


// ===== SCAN =====
async function doScan() {
  if (!files.length) return;
  setBusy(true);
  if (els.out) els.out.textContent = '';
  setStatus('Scanne...', 'ok');
  setProgressIndeterminate(true);

  const startAll = performance.now();

  try {
    // Standard: nur deutsch für Tempo. Wenn nötig -> 'deu+eng'
    const lang = 'deu';
    const w = await ensureWorker(lang);

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setStatus(`Scanne ${i + 1}/${files.length}: ${f.name}`, 'ok');

      // pro Datei: Progress zurücksetzen
      setProgressIndeterminate(true);
      setProgressRatio(0);

      const t0 = performance.now();
      const canvas = await preprocessImage(f);
      const { data } = await w.recognize(canvas);
      const t1 = performance.now();

      const ms = Math.max(1, Math.round(t1 - t0));
      const text = (data && data.text ? data.text : '').trim();

      if (els.out) {
        els.out.textContent += `# ${f.name}  (${ms} ms)\n${text}\n\n`;
        els.out.textContent += analyzeIngredients(text) + '\n\n';
      }
    }

    const total = Math.round(performance.now() - startAll);
    setStatus(`Fertig in ${Math.round(total / 1000)}s.`, 'ok');
    setProgressRatio(1);
  } catch (e) {
    console.error(e);
    setStatus('Fehler: ' + e.message, 'err');
    log('ERR', e.stack || e);
  } finally {
    setBusy(false);
    // Progress zurücksetzen, damit der Balken nicht "klebt"
    setProgressIndeterminate(false);
    setProgressRatio(0);
  }
}

// Doppelte Bindungen vermeiden
if (els.scan) {
  els.scan.removeEventListener?.('click', window.__scanHandler__);
  window.__scanHandler__ = () => { doScan().catch(() => {}); };
  els.scan.addEventListener('click', window.__scanHandler__);
}

// ===== SELF CHECK =====
window.addEventListener('load', async () => {
  try {
    const check = async (p) => {
      const r = await fetch(p, { cache: 'no-store' });
      log('check', p, r.status, r.headers.get('content-length'));
    };
    await check(paths.workerPath);
    await check(paths.corePath);
    await check('vendor/tesseract/tesseract-core.wasm'); // optional
    setStatus('Bereit.');
    if (els.scan) els.scan.disabled = files.length === 0;
  } catch (e) {
    log('Self-check failed', e);
  }
});

// ===== Aufräumen (optional) =====
window.addEventListener('beforeunload', async () => {
  try { await worker?.terminate(); } catch(_) {}
});
