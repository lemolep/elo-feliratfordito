/* Háttérszolgáltatás: DeepL hívások, felvételek tárolása, üzenettovábbítás
   a frame-ek között, content scriptek futásidejű regisztrációja. */
importScripts('/lib/i18n.js', '/lib/store.js', '/lib/deepl.js', '/lib/tts.js', '/lib/stt.js', '/lib/corrections.js');

const CS_FILES = [
  'lib/i18n.js',
  'lib/store.js',
  'lib/selector.js',
  'lib/segmenter.js',
  'lib/sentences.js',
  'lib/srt.js',
  'lib/corrections.js',
  'content/overlay-css.js',
  'content/capture.js',
  'content/vimeo.js',
  'content/overlay.js'
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- content scriptek regisztrációja ---------------- */

/* A "*" domain jelentése: minden oldal. Így egyetlen engedélykéréssel le
   lehet tudni az egészet, és nem kell oldalanként kattintgatni. */
const ALL_SITES = '*';

function patternFor(host) {
  if (String(host) === ALL_SITES) return '*://*/*';
  return '*://*.' + String(host).replace(/^\*?\.?/, '').toLowerCase() + '/*';
}

function hostMatches(host, domain) {
  if (String(domain) === ALL_SITES) return true;
  host = String(host).toLowerCase();
  domain = String(domain).toLowerCase();
  return host === domain || host.endsWith('.' + domain);
}

async function grantedDomains() {
  const s = await LFT.store.getSettingsWithKeys();
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

/* Régi tárolásból a kulcsok átköltöztetése (minden indulásnál, olcsó ha már kész). */
LFT.store.migrateSecrets().catch(e => console.warn('[LFT] migrateSecrets', e));

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
  if (area === 'local' && (changes.settings || changes.keysRev)) {
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

  const s = await LFT.store.getSettingsWithKeys();
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

/* ---------------- a lap hangja (tabCapture + offscreen) ---------------- */

/* A getMediaStreamId csak akkor ad azonosítót, ha a bővítményt az adott lapon
   MEGHÍVTÁK: ikonkattintással (popup) vagy gyorsbillentyűvel. A host engedély
   ezt NEM váltja ki — 2026-10-05-én a bővítmény újratöltése utáni tiszta
   mérésen a lebegő ablak gombja "has not been invoked" hibát kapott. Egy
   meghívás után viszont a lap bezárásáig a lebegő ablak gombja is működik.
   A hangot az offscreen dokumentum kezeli, mert a service workerben nincs
   AudioContext és getUserMedia. Egyszerre egy lap hangját vesszük. */
const OFFSCREEN_URL = 'offscreen/offscreen.html';
let audioTab = null;
let usageChain = Promise.resolve();

async function ensureOffscreen() {
  const url = chrome.runtime.getURL(OFFSCREEN_URL);
  const has = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url]
  });
  if (has.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'A lap hangjának felvétele beszédfelismeréshez.'
  });
}

async function tabAudioStart(tabId) {
  if (tabId == null) throw new Error('nincs lapazonosító');
  if (audioTab != null) await tabAudioStop();
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  await ensureOffscreen();
  const r = await chrome.runtime.sendMessage({
    target: 'offscreen', type: 'start', streamId: streamId, tabId: tabId, stt: await sttConfig()
  });
  if (!r || !r.ok) throw new Error((r && r.error) || 'az offscreen dokumentum nem válaszolt');
  audioTab = tabId;
  notifyTabAudio(tabId, true);
  return r;
}

async function tabAudioStop() {
  const was = audioTab;
  audioTab = null;
  try { await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' }); } catch (e) { /* nincs nyitva */ }
  try { await chrome.offscreen.closeDocument(); } catch (e) { /* nincs nyitva */ }
  if (was != null) notifyTabAudio(was, false);
  return was;
}

/* A beszédfelismerés beállításai az offscreen dokumentumnak. A kulcs csak a
   bővítményen belül mozog (service worker → offscreen), a lapra nem jut el.
   Kulcs nélkül null: ilyenkor a hang megy, csak felismerés nincs.
   A szakszótár angol oldalai és a hallásjavító lista helyes alakjai
   kulcskifejezésként mennek a Deepgramnak, hogy a márka- és szakneveket már a
   felismerés is jól írja le. */
async function sttConfig() {
  const s = await LFT.store.getSettingsWithKeys();
  if (!s.deepgramKey) return null;
  const terms = [];
  const seen = new Set();
  const add = t => { const k = String(t).toLowerCase(); if (t && !seen.has(k)) { seen.add(k); terms.push(t); } };
  LFT.corrections.parse(s.corrections).rules.forEach(r => add(r.to));   // ezek elöl: épp ezeket hallja félre
  parseGlossary(s.glossary).entries.forEach(e => add(e.a));
  return { provider: 'deepgram', key: s.deepgramKey, model: 'nova-3', language: 'en', keyterms: terms };
}

/* A lebegő ablak akkor is tudjon róla, ha a popupból vagy gyorsbillentyűről indult. */
function notifyTabAudio(tabId, on) {
  chrome.tabs.sendMessage(tabId, { type: 'tabaudio:state', on: on }, { frameId: 0 }).catch(() => {});
}

async function tabAudioToggle(tabId) {
  if (audioTab === tabId) { await tabAudioStop(); return { ok: true, on: false }; }
  await tabAudioStart(tabId);
  return { ok: true, on: true };
}

// a lap bezárásakor vagy újratöltésekor ne maradjon nyitva a hangfolyam
chrome.tabs.onRemoved.addListener(id => { if (id === audioTab) tabAudioStop(); });
chrome.tabs.onUpdated.addListener((id, info) => {
  if (id === audioTab && info.status === 'loading') tabAudioStop();
});

/* ---------------- üzenetek ---------------- */

async function handle(msg, sender) {
  const tabId = sender && sender.tab ? sender.tab.id : null;

  switch (msg.type) {

    /* a lap hangja */
    /* A popup nem lapból üzen, ezért megadja a lapazonosítót. Lapból (content
       scriptből) érkező üzenetnél csak a saját lapját fogadjuk el. */
    case 'tabaudio:start': {
      const target = tabId != null ? tabId : msg.tabId;
      try { return Object.assign({ ok: true }, await tabAudioStart(target)); }
      catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
    }
    case 'tabaudio:stop':
      await tabAudioStop();
      return { ok: true };
    case 'tabaudio:status':
      return { ok: true, on: audioTab != null && audioTab === (tabId != null ? tabId : msg.tabId) };

    /* Hang módban a felolvasás és a halkítás az offscreen dokumentumban
       történik. Csak attól a laptól fogadjuk el, amelyiknek a hangját vesszük —
       ha közben leállt a hang mód, "off" választ kap, és a lap a régi módon
       (saját maga) játssza le. */
    case 'tabaudio:play':
    case 'tabaudio:duck':
    case 'tabaudio:unduck':
    case 'tabaudio:hush': {
      if (audioTab == null || audioTab !== tabId) return { ok: false, reason: 'off' };
      const sub = msg.type.slice('tabaudio:'.length);
      try {
        const r = await chrome.runtime.sendMessage({ target: 'offscreen', type: sub, audio: msg.audio, level: msg.level });
        return r || { ok: false, reason: 'off' };
      } catch (e) {
        return { ok: false, reason: 'off', error: (e && e.message) || String(e) };
      }
    }
    /* beszédfelismerés */
    case 'stt:test': {
      const r = await LFT.stt.test('deepgram', msg.key);
      if (r.ok) return { ok: true };
      const text = LFT.t(LFT.stt.codeToKey(r.code)) + (r.detail ? ' — ' + r.detail : '');
      return { ok: false, error: text };
    }
    case 'stt:status':         // az offscreen dokumentumtól jön; itt fordítjuk szövegre
      if (msg.tabId != null) {
        const out = Object.assign({}, msg);
        if (msg.code) out.text = LFT.t(LFT.stt.codeToKey(msg.code));
        chrome.tabs.sendMessage(msg.tabId, out, { frameId: 0 }).catch(() => {});
      }
      return { ok: true };
    /* Fogyasztásmérő: az offscreen 10 mp-enként és lezáráskor jelenti az időt.
       Az írásokat sorba fűzzük, hogy két egymás utáni jelentés ne írja felül
       egymást (olvasás–módosítás–írás). */
    case 'stt:usage':
      usageChain = usageChain.then(() => LFT.store.addUsage(msg.seconds)).catch(() => {});
      return { ok: true };

    case 'stt:result':
      if (msg.tabId != null) chrome.tabs.sendMessage(msg.tabId, msg, { frameId: 0 }).catch(() => {});
      return { ok: true };

    case 'tabaudio:level':     // az offscreen dokumentumtól jön
    case 'tabaudio:ended':
      if (msg.tabId != null) {
        if (msg.type === 'tabaudio:ended' && msg.tabId === audioTab) audioTab = null;
        chrome.tabs.sendMessage(msg.tabId, msg, { frameId: 0 }).catch(() => {});
      }
      return { ok: true };

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
    case 'relay:sourcefound':
      if (tabId != null) chrome.tabs.sendMessage(tabId, { type: 'sourcefound' }, { frameId: 0 }).catch(() => {});
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
      const s = await LFT.store.getSettingsWithKeys();
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
      const s = await LFT.store.getSettingsWithKeys();
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
      const s = await LFT.store.getSettingsWithKeys();
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
      const s = await LFT.store.getSettingsWithKeys();
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
      const s = await LFT.store.getSettingsWithKeys();
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
      const s = await LFT.store.getSettingsWithKeys();
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
  if (msg.target === 'offscreen') return;   // azt az offscreen dokumentum válaszolja meg
  handle(msg, sender)
    .then(sendResponse)
    .catch(e => sendResponse({ error: String((e && e.message) || e) }));
  return true;
});

/* ---------------- gyorsbillentyűk ---------------- */

chrome.commands.onCommand.addListener(async command => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  if (command === 'toggle-audio') {
    // a gyorsbillentyű "meghívja" a bővítményt a lapon, tehát itt a tabCapture működik
    try { await tabAudioToggle(tab.id); }
    catch (e) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'status', text: LFT.t('ov_audio_failed', [(e && e.message) || String(e)]), kind: 'warn'
      }, { frameId: 0 }).catch(() => {});
    }
    return;
  }
  const type = command === 'toggle-capture' ? 'overlay:toggleCapture' : 'overlay:toggle';
  chrome.tabs.sendMessage(tab.id, { type: type }, { frameId: 0 }).catch(() => {});
});
