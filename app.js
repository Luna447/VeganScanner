/* app.js – VeganScanner (V6.9: konsistente Offline-Builds)
   - Akzeptiert fehlendes Tesseract.version, prüft auf createWorker
   - Persistenter Worker, KEIN logger im Worker-Objekt
   - Globaler Logger via setLogger (echte %), Fake-Ticker als Fallback
   - Fortschritt stoppt SOFORT bei Fehlern
   - Vorverarbeitung: Resize + Graustufen + harte Schwelle
*/

console.log('[boot] app.js geladen');
window.addEventListener('error', e => console.error('[JS-Error]', e.message, e.filename + ':' + e.lineno));
window.addEventListener('unhandledrejection', e => console.error('[Promise-Reject]', e.reason));

// ===== DOM =====
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
let worker = null;
let fakeTimer = null;

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
function startFakeProgress() {
  clearInterval(fakeTimer);
  fakeTimer = setInterval(() => {
    if (!els.prog) return;
    const v = Number(els.prog.value);
    if (!Number.isFinite(v)) return; // indeterminate aktiv
    setProgressRatio(Math.min(0.9, (v || 0) + 0.02));
  }, 250);
}
function stopProgress(reset = true) {
  clearInterval(fakeTimer);
  setProgressIndeterminate(false);
  if (reset) setProgressRatio(0);
}

// ===== PFADKONFIG (ohne Query!) =====
const paths = {
  workerPath: 'vendor/tesseract/worker.min.js',
  corePath:   'vendor/tesseract/tesseract-core.wasm.js',
  langPath:   'vendor/tesseract/lang'
};

// ===== Lokale Tesseract-Lib warten =====
async function waitForLocalLib(timeoutMs = 10000) {
  const t0 = performance.now();
  while (true) {
    const T = window.Tesseract;
    if (T && typeof T.createWorker === 'function') return T; // API ok (v5)
    if (T && typeof T.createWorker !== 'function') {
      throw new Error('Gefundene Tesseract-Bibliothek unterstützt createWorker nicht (zu alt/falsch).');
    }
    if (performance.now() - t0 > timeoutMs) {
      throw new Error('Tesseract (lokal) nicht geladen. Script-Tag/Cache/ServiceWorker prüfen.');
    }
    await new Promise(r => setTimeout(r, 50));
  }
}

// ===== PREPROCESSING =====
async function preprocessImage(file) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = URL.createObjectURL(file);
  });

  const maxSide = 1000; // 900–1200 je nach Bedarf
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);

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

// ===== Worker (persistenter v5) =====
async function ensureWorker(lang = 'deu') {
  const T = await waitForLocalLib();
  if (worker) return worker;

  try {
    if (typeof T.setLogger === 'function') {
      T.setLogger(m => {
        try {
          if (m && typeof m.progress === 'number') setProgressRatio(m.progress);
          else setProgressIndeterminate(true);
          if (m && m.status) setStatus(m.status, 'ok');
        } catch {}
      });
    }
  } catch {}

  worker = await T.createWorker({
    workerPath: paths.workerPath,       // KEIN Query!
    corePath:   paths.corePath,         // KEIN Query!
    langPath:   paths.langPath
    // Keine weiteren Optionen. Kein logger im Objekt!
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

// ===== Events =====
if (els.file) {
  els.file.addEventListener('change', () => {
    files = Array.from(els.file.files || []);
    renderThumbs();
    setStatus(files.length ? `${files.length} Datei(en) gewählt` : 'keine Dateien');
    if (els.scan) els.scan.disabled = files.length === 0;
  });
}

// ===== Scan =====
async function doScan() {
  if (!files.length) return;
  setBusy(true);
  if (els.out) els.out.textContent = '';
  setStatus('Scanne...', 'ok');
  setProgressIndeterminate(true);
  startFakeProgress();

  const startAll = performance.now();

  try {
    const lang = 'deu'; // bei Bedarf 'deu+eng'
    const w = await ensureWorker(lang);

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setStatus(`Scanne ${i + 1}/${files.length}: ${f.name}`, 'ok');

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

      setProgressRatio(1);
    }

    const total = Math.round(performance.now() - startAll);
    setStatus(`Fertig in ${Math.round(total / 1000)}s.`, 'ok');
  } catch (e) {
    console.error(e);
    setStatus('Fehler: ' + e.message, 'err');
    log('ERR', e.stack || e);
    stopProgress(true);
    return;
  } finally {
    setBusy(false);
    stopProgress(true);
  }
}

// Doppelbindungen vermeiden
if (els.scan) {
  els.scan.removeEventListener?.('click', window.__scanHandler__);
  window.__scanHandler__ = () => { doScan().catch(() => {}); };
  els.scan.addEventListener('click', window.__scanHandler__);
}
