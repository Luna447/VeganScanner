(async function sanityCheck(){
  const paths = [
    'tesseract/worker.min.js',
    'tesseract/tesseract-core.wasm',
    'tesseract/tessdata/eng.traineddata.gz',
    'tesseract/tessdata/deu.traineddata.gz'
  ];
  for (const p of paths) {
    try {
      const r = await fetch(p, { cache: 'no-store' });
      console.log(p, r.ok ? 'OK' : ('FAIL '+r.status));
    } catch(e){ console.error(p,'FAIL',e); }
  }
})();
  

/* ============ Konfiguration ============ */

// Optionale Online-Listen (kannst du später auf eigene GitHub Raw URLs zeigen lassen)
const ONLINE_DB_URLS = [
  // Beispielplatzhalter – trage hier später echte JSON-URLs ein.
  // "https://dein-host.xyz/veganscanner/ingredients-extended.json"
];

// OCR-Sprache: deutsch + englisch
const OCR_LANG = 'deu+eng';

// Simpler Normalizer für OCR-Fehler
function normalize(s) {
  return s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss')
    .replace(/[‐-–—]/g,'-')              // verschiedene Bindestriche
    .replace(/[\s,;:()\/\\]+/g,' ')       // Trennzeichen vereinheitlichen
    .replace(/\bo\b/g,'0')                // manchmal o↔0 vertauscht; hier konservativ
    .replace(/\b1\b/g,'l')                // 1 ↔ l
    .trim();
}

// UI-Refs
const el = {
  file: document.getElementById('fileInput'),
  btnScan: document.getElementById('btnScan'),
  btnRetake: document.getElementById('btnRetake'),
  status: document.getElementById('status'),
  verdict: document.getElementById('verdict'),
  details: document.getElementById('details'),
  ocrText: document.getElementById('ocrText'),
  hitB: document.getElementById('hitB'),
  hitG: document.getElementById('hitG'),
  hitE: document.getElementById('hitE'),
  btnOnline: document.getElementById('btnOnline'),
  btnReset: document.getElementById('btnReset'),
};

let DB = null;          // Lokale Zutatenliste
let EXT = null;         // Geladene Online-Erweiterungen (gemerged)
let LAST_SCAN = null;   // Merkt sich letzten OCR-Text + Hits

// Zutatenliste laden
fetch('ingredients-data.json')
  .then(r => r.json())
  .then(j => { DB = j; el.status.textContent = 'Bereit. Foto auswählen und „Scannen“.'; })
  .catch(err => { console.error(err); el.status.textContent = 'Fehler beim Laden der Zutatenliste.'; });

// Buttons
el.btnScan.addEventListener('click', () => runScan());
el.btnRetake.addEventListener('click', () => { el.file.value = ''; resetUI(); });
el.btnOnline.addEventListener('click', () => tryOnline());
el.btnReset.addEventListener('click', resetUI);

function resetUI(){
  el.status.textContent = 'Bereit. Foto auswählen und „Scannen“.';
  el.verdict.style.display = 'none';
  el.details.textContent = '';
  el.ocrText.textContent = '';
  el.hitB.innerHTML = '';
  el.hitG.innerHTML = '';
  el.hitE.innerHTML = '';
  el.btnOnline.style.display = 'none';
  el.btnReset.style.display = 'none';
  el.btnRetake.style.display = 'none';
  LAST_SCAN = null;
}

async function runScan(){
  const file = el.file.files?.[0];
  if(!file){ el.status.textContent = 'Kein Bild gewählt.'; return; }

  // HEIC kurz abfangen
  if (file.type && file.type.toLowerCase().includes('heic')) {
    el.status.textContent = 'HEIC nicht unterstützt. Bitte JPG/PNG nutzen.';
    return;
  }

  el.btnScan.disabled = true;
  el.status.textContent = 'OCR läuft… das dauert je nach Gerät ein paar Sekunden.';

  const url = URL.createObjectURL(file);
  try {
	const worker = await Tesseract.createWorker({
	logger: m => console.log(m),
	workerPath: 'tesseract/worker.min.js',
	corePath:   'tesseract/tesseract-core.wasm', // jetzt 2.3.0
	langPath:   'tesseract/tessdata/'            // Slash bleibt Pflicht
	}
);


    await worker.loadLanguage(OCR_LANG || 'deu+eng');
    await worker.initialize(OCR_LANG || 'deu+eng');

    const { data: { text } } = await worker.recognize(url);
    await worker.terminate();

    el.ocrText.textContent = text;
    const scan = analyze(text, DB);
    LAST_SCAN = { text, ...scan };
    renderResult(scan);

  } catch (e) {
    console.error(e);
    el.status.textContent = 'Fehler bei der OCR: ' + (e && e.message ? e.message : 'siehe Konsole');
  } finally {
    URL.revokeObjectURL(url);
    el.btnScan.disabled = false;
    el.btnRetake.style.display = 'inline-block';
    el.btnReset.style.display = 'inline-block';
  }
}



function analyze(text, data) {
  if(!data) return { verdict:'Unklar', hitsB:[], hitsG:[], eHits:[], unknownTokens:[] };

  const t = normalize(text);
  const hitsB = [];
  const hitsG = [];
  const unknown = new Set();

  // Volltext-Matches
  for(const k of data.blacklist) if(t.includes(k)) hitsB.push(k);
  for(const k of data.greylist)  if(t.includes(k)) hitsG.push(k);

  // E-Nummern herausziehen
  const eHits = Array.from(t.matchAll(/\be\d{3,4}\b/g)).map(m => m[0]);

  // E-Nummern auflösen
  for(const e of eHits){
    const tag = data.enumbers[e];
    if(tag === 'not_vegan' && !hitsB.includes(e)) hitsB.push(e);
    else if(tag === 'maybe' && !hitsG.includes(e)) hitsG.push(e);
    else if(!tag) unknown.add(e);
  }

  // Unbekannte Wörter grob schätzen: nimm einzelne Zutaten-Tokens
  // Split an Trennzeichen, filtere zu kurze/unnütze Tokens.
  const tokens = t.split(/[\s,;:()]+/g).filter(s => s.length >= 3);
  const knownSet = new Set([...data.blacklist, ...data.greylist, ...Object.keys(data.enumbers)]);
  for(const tok of tokens){
    if(/^[a-z0-9\-]+$/.test(tok) && !knownSet.has(tok) && /^[a-z]/.test(tok)) {
      // ein paar offensichtlich generische Wörter ignorieren
      if(['zutaten','spuren','kann','enthält','hergestellt','mit','und','oder','aus','von','frei','ohne','natürliches','natuerliches','aroma','aromen','farbstoff','emulgator','stabilisator','säureregulator','saeureregulator','suesstoff','süßstoff','gewürz','gewuerz','gewürze','gewuerze','pflanzlich','pflanzliche','öl','oel','fett','fette','protein','proteinpulver','extrakt','pulver','konzentrat','mehl','stärke','staerke'].includes(tok)) continue;
      unknown.add(tok);
    }
  }

  let verdict = 'Vegan ✅';
  if(hitsB.length) verdict = 'Nicht vegan ❌';
  else if(hitsG.length || unknown.size) verdict = 'Unklar ⚠️';

  return {
    verdict,
    hitsB: Array.from(new Set(hitsB)).sort(),
    hitsG: Array.from(new Set(hitsG)).sort(),
    eHits: Array.from(new Set(eHits)).sort(),
    unknownTokens: Array.from(unknown).slice(0, 30) // begrenzen für die Anzeige
  };
}

function renderResult(scan){
  const v = el.verdict;
  v.style.display = 'inline-block';
  v.textContent = scan.verdict;
  v.classList.remove('ok','warn','bad');
  if(scan.verdict.startsWith('Vegan')) v.classList.add('ok');
  else if(scan.verdict.startsWith('Nicht')) v.classList.add('bad');
  else v.classList.add('warn');

  el.hitB.innerHTML = scan.hitsB.map(x => `<span class="pill">${x}</span>`).join(' ') || '<span class="small">keine</span>';
  el.hitG.innerHTML = scan.hitsG.map(x => `<span class="pill">${x}</span>`).join(' ') || '<span class="small">keine</span>';
  el.hitE.innerHTML = scan.eHits.map(x => `<span class="pill">${x}</span>`).join(' ') || '<span class="small">keine</span>';

  const unknown = scan.unknownTokens.map(x => `<span class="pill">${x}</span>`).join(' ');
  el.details.innerHTML = (unknown ? `Unbekannt/prüfen: ${unknown}` : '');
  el.status.textContent = 'Fertig.';

  // Hybrid-Button einblenden, wenn unklar oder unbekanntes Zeug dabei ist
  el.btnOnline.style.display = (scan.verdict !== 'Vegan ✅') ? 'inline-block' : 'none';
}

async function tryOnline(){
  if(!ONLINE_DB_URLS.length){
    el.status.textContent = 'Keine Online-Quellen konfiguriert. Trage URLs in ONLINE_DB_URLS ein.';
    return;
  }
  el.btnOnline.disabled = true;
  el.status.textContent = 'Lade Online-Erweiterungen…';

  try{
    // Online-Listen holen und mergen
    const lists = await Promise.allSettled(ONLINE_DB_URLS.map(u => fetch(u, {cache:'no-store'}).then(r => r.json())));
    const ext = { blacklist:[], greylist:[], enumbers:{} };
    for(const r of lists){
      if(r.status !== 'fulfilled') continue;
      const j = r.value;
      if(Array.isArray(j.blacklist)) ext.blacklist.push(...j.blacklist);
      if(Array.isArray(j.greylist))  ext.greylist.push(...j.greylist);
      if(j.enumbers && typeof j.enumbers === 'object') Object.assign(ext.enumbers, j.enumbers);
    }
    // Deduplizieren
    ext.blacklist = Array.from(new Set(ext.blacklist || []));
    ext.greylist  = Array.from(new Set(ext.greylist  || []));

    // Merge in DB (ohne Original zu zerstören)
    EXT = {
      blacklist: Array.from(new Set([...(DB.blacklist||[]), ...(ext.blacklist||[])])),
      greylist:  Array.from(new Set([...(DB.greylist||[]),  ...(ext.greylist||[])])),
      enumbers:  Object.assign({}, DB.enumbers||{}, ext.enumbers||{})
    };

    // Neu analysieren mit erweiterter DB
    const scan = analyze(LAST_SCAN?.text || '', EXT);
    LAST_SCAN = { text: LAST_SCAN?.text || '', ...scan };
    renderResult(scan);
    el.status.textContent = 'Online-Erweiterung geladen.';

  } catch(e){
    console.error(e);
    el.status.textContent = 'Fehler bei der Online-Prüfung.';
  } finally {
    el.btnOnline.disabled = false;
  }
}
