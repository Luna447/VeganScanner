/* app.js – VeganScanner (V6.3, passend zu deiner index.html)
   - Kein zusätzliches Script-Nachladen (vertraut ausschließlich auf <script ... tesseract.min.js>)
   - Strenge v5-Prüfung, klare Fehlermeldung bei Version-Mix
   - Persistenter Worker (await createWorker in v5)
   - Keinen logger im Worker-Objekt (verhindert DataCloneError)
   - Optional globaler Logger via Tesseract.setLogger, wenn vorhanden
   - Fortschrittsbalken: indeterminate + echter % + Fake-Ticker, Stop sofort bei Fehlern
   - Schnellere Vorverarbeitung (Resize + Graustufen + harte Schwelle)
*/

// ===== BOOT DIAGNOSE =====
console.log('[boot] app.js geladen');
window.addEventListener('error', e => console.error('[JS-Error]', e.message, e.filename + ':' + e.lineno));
window.addEventListener('unhandledrejection', e => console.error('[Promise-Reject]', e.reason));

// ===== DOM HOOKS =====
const els = {
  file:   document.getElementById('file'),
  scan:   document.getElementById('scan'),
  prog:   document.getElementById('prog'),
  status: document.getElementById('status'),
  out:    document.getElementById('out'),
  thumbs: document.getElementById('thumbs'),
  log:    document.getElementById('log'),
};

let files = [];
let worker = null;         // persistenter Worker
let fakeTimer = null;      // Fake-Progress-Ticker

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
    els.prog.removeAttribute('value'); // indeterminate
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
function startFakeProgress() {
  clearInterval(fakeTimer);
  // falls value existiert, langsam Richtung 0.9 „atmen“, bis echte Events kommen
  fakeTimer = setInterval(() => {
    if (!els.prog) return;
    const v = Number(els.prog.value);
    if (!Number.isFinite(v)) return;       // indeterminate aktiv, nichts tun
    setProgressRatio(Math.min(0.9, (v || 0) + 0.02));
  }, 250);
}
function stopProgress(reset = true) {
  clearInterval(fakeTimer);
  setProgressIndeterminate(false);
  if (reset) setProgressRatio(0);
}

// ===== PFADKONFIG OFFLINE =====
const paths = {
  workerPath: 'vendor/tesseract/worker.min.js',
  corePath:   'vendor/tesseract/tesseract-core.wasm.js',
  langPath:   'vendor/tesseract/lang'
};

// ===== Warten bis Tesseract v5 geladen ist (aus index.html Script-Tag) =====
async function waitForTesseractV5(timeoutMs = 8000) {
  const t0 = performance.now();
  while (true) {
    const T = window.Tesseract;
    if (T && /^5\./.test(String(T.version || ''))) return T;
    if (T && !/^5\./.test(String(T.version || ''))) {
      throw new Error(`Falsche Tesseract-Version (${T.version}). Erwartet v5.x. Bitte lokale vendor/tesseract/tesseract.min.js gegen v5 ersetzen oder nur CDN v5 nutzen.`);
    }
    if (performance.now() - t0 > timeoutMs) {
      throw new Error('Tesseract wurde nicht geladen. Prüfe Script-Tag in index.html.');
    }
    await new Promise(r => setTimeout(r, 50));
  }
}

// ===== PREPROCESSING (schneller + stabiler OCR-Input) =====
async function preprocessImage(file) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = URL.createObjectURL(file);
  });

  // Aggressives Resize: JPG-Ziegelsteine werden sonst lahm
  const maxSide = 1000; // feinfühlig zwischen 900–1200 anpassen
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);

  // Graustufen + harte Schwelle
  const data = ctx.getImageData(0, 0, w, h);
  const p = data.data;
  for (let i = 0; i < p.length; i += 4) {
    const g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
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
  const T = await waitForTesseractV5();
  if (worker) return worker;

  // Globaler Logger (wenn vorhanden) für echte Prozent, OHNE in Worker-Options zu landen
  try {
    if (typeof T.setLogger === 'function') {
      T.setLogger(m => {
        try {
          if (m && typeof m.progress === 'number') {
            // Wechsel aus indeterminate raus, echte Werte übernehmen
            setProgressRatio(m.progress);
          } else {
            setProgressIndeterminate(true);
          }
          if (m && m.status) setStatus(m.status, 'ok');
        } catch (_) {}
      });
    }
  } catch (_) {}

  // Wichtig: in v5 ist createWorker ASYNC und der logger DARF HIER NICHT rein
  worker = await T.createWorker({
    workerPath: paths.workerPath,
    corePath:   paths.corePath,
    langPath:   paths.langPath,
    workerBlobURL: false,
    gzip: false
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

// ===== SCAN =====
async function doScan() {
  if (!files.length) return;
  setBusy(true);
  if (els.out) els.out.textContent = '';
  setStatus('Scanne...', 'ok');
  setProgressIndeterminate(true);
  startFakeProgress();

  const startAll = performance.now();

  try {
    // Standard: nur deutsch für Tempo. Wenn nötig -> 'deu+eng'
    const lang = 'deu';
    const w = await ensureWorker(lang);

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setStatus(`Scanne ${i + 1}/${files.length}: ${f.name}`, 'ok');

      // pro Datei: Progress sauber zurücksetzen
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

      // Datei fertig: Progress voll
      setProgressRatio(1);
    }

    const total = Math.round(performance.now() - startAll);
    setStatus(`Fertig in ${Math.round(total / 1000)}s.`, 'ok');
  } catch (e) {
    console.error(e);
    setStatus('Fehler: ' + e.message, 'err');
    log('ERR', e.stack || e);
    // Bei Fehler: Progress sofort stoppen, damit nix weiterblinkt
    stopProgress(true);
    return; // früh raus
  } finally {
    setBusy(false);
    // Nach Lauf: sauber zurücksetzen
    stopProgress(true);
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

// ===== Aufräumen =====
window.addEventListener('beforeunload', async () => {
  try { await worker?.terminate(); } catch(_) {}
});
