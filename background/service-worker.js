/* Háttérszolgáltatás: DeepL hívások, felvételek tárolása, üzenettovábbítás
   a frame-ek között, content scriptek futásidejű regisztrációja. */
importScripts('/lib/i18n.js', '/lib/store.js', '/lib/deepl.js', '/lib/tts.js');

const CS_FILES = [
  'lib/i18n.js',
  'lib/store.js',
  'lib/selector.js',
  'lib/segmenter.js',
  'content/overlay-css.js',
  'content/capture.js',
  'content/overlay.js'
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- content scriptek regisztrációja ---------------- */

function patternFor(host) {
  return '*://*.' + String(host).replace(/^\*?\.?/, '').toLowerCase() + '/*';
}

function hostMatches(host, domain) {
  host = String(host).toLowerCase();
  domain = String(domain).toLowerCase();
  return host === domain || host.endsWith('.' + domain);
}

async function grantedDomains() {
  const s = await LFT.store.getSettings();
  const out = [];
  for (const d of s.domains) {
    try {
      const ok = await chrome.permissions.contains({ origins: [patternFor(d)] });
      if (ok) out.push(d);
    } catch (e) { /* rossz minta — kihagyjuk */ }
  }
  return out;
}

async function syncScripts() {
  const domains = await grantedDomains();
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: ['lft-main'] });
    if (existing && existing.length) {
      await chrome.scripting.unregisterContentScripts({ ids: ['lft-main'] });
    }
  } catch (e) { /* nem volt regisztrálva */ }

  if (!domains.length) return { registered: 0, domains: [] };

  await chrome.scripting.registerContentScripts([{
    id: 'lft-main',
    matches: domains.map(patternFor),
    js: CS_FILES,
    allFrames: true,
    runAt: 'document_idle'
  }]);
  return { registered: domains.length, domains: domains };
}

/* Már megnyitott fülekbe utólag beinjektálja a scripteket, hogy ne kelljen újratölteni. */
async function injectExisting() {
  const domains = await grantedDomains();
  if (!domains.length) return 0;
  let n = 0;
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (!t.url || !/^https?:/i.test(t.url)) continue;
    let host;
    try { host = new URL(t.url).hostname; } catch (e) { continue; }
    if (!domains.some(d => hostMatches(host, d))) continue;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: t.id, allFrames: true },
        files: CS_FILES
      });
      n++;
    } catch (e) { /* pl. védett oldal */ }
  }
  return n;
}

chrome.runtime.onInstalled.addListener(() => { syncScripts(); });
chrome.runtime.onStartup.addListener(() => { syncScripts(); });
chrome.permissions.onRemoved.addListener(() => { syncScripts(); });

/* ---------------- fordítási sor ---------------- */

const cache = new Map();
const MAX_CACHE = 500;
let queue = [];
let batchTimer = null;
let chain = Promise.resolve();
let quotaBlocked = false;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) {
    quotaBlocked = false;
    glossaryFailed = false;
    glossaryError = '';
  }
});

function trimCache() {
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
}

/* A gyorsítótár kulcsában benne van a célnyelv is — különben nyelvváltás után
   a korábbi nyelvű fordítást adnánk vissza. */
function cacheKey(lang, text) { return lang + '\u0000' + text; }

/* A szótár megváltozásakor a korábbi fordítások már nem érvényesek. */
let glossaryTagValue = '';
function glossaryTag() { return glossaryTagValue; }

function translateText(text) {
  return new Promise(resolve => {
    queue.push({ text: text, resolve: resolve });
    if (queue.length >= 5) schedule(0);
    else if (!batchTimer) batchTimer = setTimeout(() => schedule(1), 800);
  });
}

function schedule() {
  clearTimeout(batchTimer);
  batchTimer = null;
  chain = chain.then(runBatch).catch(() => {});
}

async function runBatch() {
  const batch = queue.splice(0, 20);
  if (!batch.length) return;

  const s = await LFT.store.getSettings();
  if (!s.deeplKey) {
    batch.forEach(b => b.resolve({ error: LFT.t('dl_err_nokey') }));
    return;
  }
  if (quotaBlocked) {
    batch.forEach(b => b.resolve({ error: LFT.deepl.humanError(456) }));
    return;
  }

  const lang = s.targetLang || 'HU';

  /* Amit már lefordítottunk ugyanerre a nyelvre, azt nem kérjük el újra. */
  const pending = [];
  for (const b of batch) {
    const hit = cache.get(cacheKey(lang + glossaryTag(), b.text));
    if (hit) b.resolve({ hu: hit });
    else pending.push(b);
  }
  if (!pending.length) return;

  const texts = pending.map(b => b.text);
  let glossaryId = lastDetected ? await ensureGlossary(s, lastDetected, lang) : '';

  for (let attempt = 0; ; attempt++) {
    try {
      const out = await LFT.deepl.translate(s.deeplKey, texts, lang, {
        sourceLang: baseLang(lastDetected), glossaryId: glossaryId
      });
      if (out.detected) lastDetected = out.detected;
      pending.forEach((b, i) => {
        const hu = out.texts[i] || '';
        if (hu) cache.set(cacheKey(lang + glossaryTag(), b.text), hu);
        b.resolve(hu ? { hu: hu } : { error: LFT.t('dl_err_empty') });
      });
      trimCache();
      return;
    } catch (e) {
      const st = e.status || 0;
      /* Rossz szótár esetén ne vesszen el a fordítás: egyszer újrapróbáljuk nélküle. */
      if (st === 400 && glossaryId) {
        glossaryFailed = true;
        glossaryError = e.message;
        glossaryId = '';
        continue;
      }
      if (st === 456) {
        quotaBlocked = true;
        pending.forEach(b => b.resolve({ error: e.message }));
        return;
      }
      if ((st === 429 || st === 0 || st >= 500) && attempt < 2) {
        await sleep(1000 * Math.pow(2, attempt));
        continue;
      }
      pending.forEach(b => b.resolve({ error: e.message }));
      return;
    }
  }
}

/* ---------------- szakszótár ---------------- */

/* A DeepL szótára csak akkor használható, ha a forrásnyelvet is megadjuk. Mi
   viszont felismertetjük — ezért a DeepL válaszából megtanuljuk, és onnantól
   használjuk. Az első mondat így még szótár nélkül fordul le. */
let lastDetected = '';
let glossaryFailed = false;
let glossaryError = '';

function baseLang(l) { return String(l || '').split('-')[0].toLowerCase(); }

/* Soronként "eredeti = fordítás". Elválasztónak elfogadjuk a tabulátort, az
   egyenlőségjelet, a nyilat és a pontosvesszőt is; a # sor megjegyzés. */
function parseGlossary(text) {
  const out = [];
  const bad = [];
  const seen = new Set();
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.charAt(0) === '#') continue;
    const parts = line.split(/\t|=|→|;/);
    if (parts.length < 2) { bad.push(i + 1); continue; }
    const a = parts[0].trim();
    const b = parts.slice(1).join(' ').trim();
    if (!a || !b) { bad.push(i + 1); continue; }
    const k = a.toLowerCase();
    if (seen.has(k)) continue;          // a DeepL nem fogad ismétlődő forrásoldalt
    seen.add(k);
    out.push({ a: a, b: b });
  }
  return { entries: out, bad: bad };
}

function hashOf(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

/* Gondoskodik róla, hogy a DeepL-nél a mostani szólistának megfelelő szótár
   legyen, és visszaadja az azonosítóját. A DeepL szótárai nem módosíthatók,
   ezért változáskor újat hozunk létre és a régit töröljük. */
async function ensureGlossary(s, srcLang, tgtLang) {
  const id = await ensureGlossaryInner(s, srcLang, tgtLang);
  /* A gyorsítótár kulcsába is bekerül, így szótárváltás után nem a régi
     fordítást adjuk vissza. */
  glossaryTagValue = id ? '|' + id : '';
  return id;
}

async function ensureGlossaryInner(s, srcLang, tgtLang) {
  if (glossaryFailed) return '';
  const parsed = parseGlossary(s.glossary);
  if (!parsed.entries.length) return '';

  const sl = baseLang(srcLang), tl = baseLang(tgtLang);
  if (!sl || !tl || sl === tl) return '';

  const tsv = parsed.entries.map(e => e.a + '\t' + e.b).join('\n');
  const want = sl + ':' + tl + ':' + hashOf(tsv);

  const st = (await chrome.storage.local.get('glossaryState')).glossaryState || {};
  if (st.id && st.hash === want) return st.id;

  try {
    if (st.id) { try { await LFT.deepl.glossaryDelete(s.deeplKey, st.id); } catch (e) { /* lehet, hogy már nincs meg */ } }
    const g = await LFT.deepl.glossaryCreate(
      s.deeplKey, 'elo-feliratfordito ' + sl + '-' + tl, sl, tl, tsv);
    const id = g && g.glossary_id;
    if (!id) throw new Error('glossary_id');
    await chrome.storage.local.set({ glossaryState: { id: id, hash: want, at: Date.now(), pair: sl + '-' + tl } });
    glossaryError = '';
    return id;
  } catch (e) {
    /* Nem állítjuk meg a fordítást emiatt — csak szótár nélkül megy tovább. */
    glossaryFailed = true;
    glossaryError = e.message || String(e);
    return '';
  }
}

/* ---------------- üzenetek ---------------- */

async function handle(msg, sender) {
  const tabId = sender && sender.tab ? sender.tab.id : null;

  switch (msg.type) {

    /* fordítás */
    case 'translate':
      return translateText(msg.text);

    /* felvételek */
    case 'session:start': {
      const id = await LFT.store.createSession({
        origin: msg.origin, url: msg.url, title: msg.title, targetLang: msg.targetLang
      });
      return { id: id };
    }
    case 'session:save':
      await LFT.store.saveSession(msg.id, msg.lines || [], msg.endedAt || null);
      return { ok: true };
    case 'session:list':
      return { sessions: await LFT.store.listSessions() };
    case 'session:get':
      return { session: await LFT.store.getSession(msg.id) };
    case 'session:delete':
      await LFT.store.deleteSession(msg.id);
      return { ok: true };
    case 'session:clear':
      await LFT.store.clearSessions();
      return { ok: true };

    /* üzenettovábbítás a frame-ek között */
    case 'relay:segment':
      if (tabId != null) chrome.tabs.sendMessage(tabId, { type: 'segment', seg: msg.seg }, { frameId: 0 }).catch(() => {});
      return { ok: true };
    case 'relay:status':
      if (tabId != null) chrome.tabs.sendMessage(tabId, { type: 'status', text: msg.text, kind: msg.kind }, { frameId: 0 }).catch(() => {});
      return { ok: true };
    case 'relay:picked':
      if (tabId != null) chrome.tabs.sendMessage(tabId, { type: 'picked' }, { frameId: 0 }).catch(() => {});
      return { ok: true };
    case 'relay:frames':
      // frameId nélkül a tab MINDEN frame-je megkapja
      if (tabId != null) chrome.tabs.sendMessage(tabId, msg.payload).catch(() => {});
      return { ok: true };

    /* beállítások oldal */
    case 'deepl:usage': {
      const s = await LFT.store.getSettings();
      const key = msg.key || s.deeplKey;
      try {
        const u = await LFT.deepl.usage(key);
        return { ok: true, usage: u, endpoint: LFT.deepl.endpointFor(key) };
      } catch (e) {
        return { ok: false, error: e.message, status: e.status };
      }
    }
    /* szakszótár állapota és feltöltése */
    case 'deepl:glossary': {
      const s = await LFT.store.getSettings();
      const parsed = parseGlossary(s.glossary);
      const st = (await chrome.storage.local.get('glossaryState')).glossaryState || {};
      if (msg.force) { glossaryFailed = false; glossaryError = ''; }

      let id = '';
      if (parsed.entries.length && lastDetected) {
        id = await ensureGlossary(s, lastDetected, s.targetLang || 'HU');
      }
      return {
        ok: true,
        entries: parsed.entries.length,
        bad: parsed.bad,
        detected: lastDetected,
        pair: id ? (baseLang(lastDetected) + ' → ' + baseLang(s.targetLang || 'HU')) : '',
        uploaded: !!id,
        error: glossaryError
      };
    }

    /* célnyelvek lekérése a DeepL-től (a beállítások oldalnak) */
    case 'deepl:languages': {
      const s = await LFT.store.getSettings();
      const key = msg.key || s.deeplKey;
      try {
        const list = await LFT.deepl.languages(key, 'target');
        if (Array.isArray(list) && list.length) await LFT.store.saveLangs(list);
        return { ok: true, langs: list };
      } catch (e) {
        return { ok: false, error: e.message, status: e.status };
      }
    }

    case 'domains:sync': {
      const r = await syncScripts();
      const injected = await injectExisting();
      return { ok: true, registered: r.registered, injected: injected };
    }
    /* felolvasás: egy szövegdarab hanggá alakítása (a kulcs itt marad, nem megy a lapba) */
    case 'tts': {
      const s = await LFT.store.getSettings();
      if (!s.ttsEnabled) return { skip: true };
      if (!s.googleKey) return { error: LFT.t('tts_err_nokey') };
      if (!s.ttsVoice) return { error: LFT.t('tts_err_novoice') };
      try {
        const audio = await LFT.tts.synthesize(s.googleKey, msg.text, s.ttsVoice, s.ttsRate);
        return { audio: audio };
      } catch (e) {
        return { error: e.message, status: e.status };
      }
    }

    /* hangminta a beállítások oldalnak — a megadott kulccsal és hanggal */
    case 'tts:sample': {
      const s = await LFT.store.getSettings();
      /* A mintamondatot előbb a célnyelvre fordítjuk, hogy a hang a saját
         nyelvén szólaljon meg. Ha nincs DeepL kulcs vagy hibázik, marad az eredeti. */
      let text = msg.text;
      if (s.deeplKey) {
        try {
          const out = await LFT.deepl.translate(s.deeplKey, [text], s.targetLang || 'HU');
          if (out && out[0]) text = out[0];
        } catch (e) { /* marad az eredeti mondat */ }
      }
      try {
        const audio = await LFT.tts.synthesize(
          msg.key || s.googleKey, text, msg.voice || s.ttsVoice, msg.rate || s.ttsRate);
        return { ok: true, audio: audio, text: text };
      } catch (e) {
        return { ok: false, error: e.message, status: e.status };
      }
    }

    /* elérhető hangok egy nyelvhez */
    case 'tts:voices': {
      const s = await LFT.store.getSettings();
      try {
        const list = await LFT.tts.voices(msg.key || s.googleKey, msg.lang);
        return { ok: true, voices: list };
      } catch (e) {
        return { ok: false, error: e.message, status: e.status };
      }
    }

    /* diagnosztika: minden elérhető frame-ből visszakérdez */
    case 'diagnose': {
      try {
        const res = await chrome.scripting.executeScript({
          target: { tabId: msg.tabId, allFrames: true },
          func: () => (globalThis.LFT && LFT.capture) ? LFT.capture.diagnose() : null
        });
        return { ok: true, frames: res.map(r => r.result).filter(Boolean) };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }

    case 'openOptions':
      chrome.runtime.openOptionsPage();
      return { ok: true };
  }
  return undefined;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  handle(msg, sender)
    .then(sendResponse)
    .catch(e => sendResponse({ error: String((e && e.message) || e) }));
  return true;
});

/* ---------------- gyorsbillentyűk ---------------- */

chrome.commands.onCommand.addListener(async command => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const type = command === 'toggle-capture' ? 'overlay:toggleCapture' : 'overlay:toggle';
  chrome.tabs.sendMessage(tab.id, { type: type }, { frameId: 0 }).catch(() => {});
});
