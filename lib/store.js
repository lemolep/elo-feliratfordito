/* Közös tároló-réteg. Klasszikus script: a service worker importScripts-szel,
   az options oldal <script>-tel, a content scriptek a manifest listáján át töltik be. */
globalThis.LFT = globalThis.LFT || {};

(() => {
  'use strict';

  const K = {
    SETTINGS: 'settings',
    TARGETS: 'targets',
    UI: 'ui',
    LANGS: 'targetLangs',
    INDEX: 'sessionIndex',
    KEYS_REV: 'keysRev',  // kulcsváltáskor nő, hogy a service worker értesüljön róla
    USAGE: 'sttUsage'     // fogyasztásmérő: a hang mód ideje
  };

  const DEFAULT_SETTINGS = {
    deeplKey: '',
    flushDelay: 1200,     // ms — ennyi változatlanság után zárja le a felirat-sort
    fontSize: 20,         // px — alap betűméret
    opacity: 85,          // % — az ablak hátterének átlátszatlansága
    bilingual: true,      // igaz = eredeti + fordítás, hamis = csak a fordítás
    targetLang: 'HU',     // ide fordít — a DeepL bármely célnyelve lehet
    googleKey: '',        // Google Cloud TTS API kulcs (felolvasáshoz)
    deepgramKey: '',      // Deepgram API kulcs (hang mód: beszédfelismerés)
    ttsEnabled: false,    // felolvassa-e a lefordított sorokat
    ttsVoice: '',         // pl. hu-HU-Chirp3-HD-Achernar
    ttsRate: 1,           // beszédtempó, 0.25–2.0
    ttsDuck: 20,          // % — ennyire halkul az eredeti hang a felolvasás alatt
    glossary: '',         // szakszótár, soronként: eredeti = fordítás
    corrections: '',      // hallásjavító lista, soronként: félrehallott → helyes
    autoTrack: true,      // a lejátszó feliratsávját magától bekapcsolja (rejtve)
    autoStart: true,      // magától elindul, ha talál feliratot
    exportFormat: 'txt',  // a mentési ablak utoljára választott formátuma
    domains: [],          // engedélyezett hostnevek; a "*" jelentése: minden oldal
    hasDeeplKey: false,   // csak jelzés a content scriptnek; a kulcs maga nem itt van
    hasGoogleKey: false,
    hasDeepgramKey: false
  };

  /* A kulcsok NEM a chrome.storage.local-ban vannak, hanem a bővítmény saját
     IndexedDB adatbázisában. Ezt csak a bővítmény saját oldalai (beállítások,
     popup) és a service worker érik el; a weboldalakba injektált content script
     a weboldal eredetében fut, oda nem lát be. A chrome.storage.local-ba csak
     annyi kerül, hogy van e kulcs (hasDeeplKey, hasGoogleKey). */
  const SECRET_FIELDS = ['deeplKey', 'googleKey', 'deepgramKey'];
  const FLAG_OF = { deeplKey: 'hasDeeplKey', googleKey: 'hasGoogleKey', deepgramKey: 'hasDeepgramKey' };
  const SECRET_DB = 'lft-secrets';
  const SECRET_OS = 'kv';
  const SECRET_ID = 'keys';

  function trusted() {
    try { return typeof location !== 'undefined' && location.protocol === 'chrome-extension:'; }
    catch (e) { return false; }
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(SECRET_DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(SECRET_OS);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  async function secretsGet() {
    if (!trusted()) return {};
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const q = db.transaction(SECRET_OS, 'readonly').objectStore(SECRET_OS).get(SECRET_ID);
        q.onsuccess = () => resolve(q.result || {});
        q.onerror = () => reject(q.error);
      });
    } finally { db.close(); }
  }

  async function secretsPut(obj) {
    if (!trusted()) throw new Error('secrets: only in extension pages');
    const db = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(SECRET_OS, 'readwrite');
        tx.objectStore(SECRET_OS).put(obj, SECRET_ID);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }

  function stripSecrets(obj) {
    for (const f of SECRET_FIELDS) delete obj[f];
    return obj;
  }

  const DEFAULT_UI = {
    left: null, top: null, width: 480, height: 300,
    fontSize: null, opacity: null, bilingual: null, visible: true
  };

  /* Ha a bővítményt újratöltik vagy kikapcsolják, a már megnyitott oldalon futó
     content script "árván" marad: a chrome.* hívásai innentől
     "Extension context invalidated" hibát dobnak. Ezt itt egy helyen kezeljük,
     hogy sehol ne keletkezzen elkapatlan hiba. */
  function alive() {
    try { return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id); }
    catch (e) { return false; }
  }

  async function raw(key) {
    if (!alive()) return undefined;
    try {
      const o = await chrome.storage.local.get(key);
      return o[key];
    } catch (e) { return undefined; }
  }

  async function write(obj) {
    if (!alive()) return false;
    try { await chrome.storage.local.set(obj); return true; }
    catch (e) { return false; }
  }

  async function drop(keys) {
    if (!alive()) return false;
    try { await chrome.storage.local.remove(keys); return true; }
    catch (e) { return false; }
  }

  const store = {
    K,
    DEFAULT_SETTINGS,
    DEFAULT_UI,

    /* ---------- beállítások ---------- */
    /* Kulcsok nélkül: ezt bárhol lehet hívni, a content scriptben is. */
    async getSettings() {
      const s = Object.assign({}, DEFAULT_SETTINGS, (await raw(K.SETTINGS)) || {});
      // régi (0.8.1 előtti) tárolás: amíg az átköltöztetés le nem fut, a jelzés a régi mezőből jön
      for (const f of SECRET_FIELDS) if (s[f]) s[FLAG_OF[f]] = true;
      return stripSecrets(s);
    },

    /* Kulcsokkal együtt: csak a service worker és a bővítmény saját oldalai hívják. */
    async getSettingsWithKeys() {
      await store.migrateSecrets();
      const s = await store.getSettings();
      const sec = await secretsGet();
      for (const f of SECRET_FIELDS) s[f] = sec[f] || '';
      return s;
    },

    async saveSettings(patch) {
      patch = Object.assign({}, patch);
      // a jelzéseket mindig a valós kulcsból számoljuk, kívülről nem írhatók
      for (const f of SECRET_FIELDS) delete patch[FLAG_OF[f]];

      /* Ha a régi tárolásból még nem költöztek át a kulcsok, azokat meg kell
         tartani, különben ez az írás kitörölné őket. A bővítmény saját oldalain
         előbb átköltöztetünk; a content script (ahol ez nem megy) érintetlenül
         visszaírja őket, és majd a service worker költözteti. */
      if (trusted()) await store.migrateSecrets();
      const cur = (await raw(K.SETTINGS)) || {};
      const next = await store.getSettings();
      for (const f of SECRET_FIELDS) if (cur[f]) next[f] = cur[f];
      const secretPatch = {};
      for (const f of SECRET_FIELDS) {
        if (f in patch) { secretPatch[f] = String(patch[f] || ''); delete patch[f]; }
      }
      Object.assign(next, patch);

      if (Object.keys(secretPatch).length) {
        const sec = Object.assign(await secretsGet(), secretPatch);
        await secretsPut(sec);
        for (const f of SECRET_FIELDS) next[FLAG_OF[f]] = !!sec[f];
        /* Egyik kulcsról a másikra váltva a settings nem változik (a jelzés
           marad igaz), így a storage.onChanged sem jönne. Ez a számláló jelzi. */
        await write({ [K.SETTINGS]: next, [K.KEYS_REV]: Date.now() });
        return stripSecrets(next);
      }
      await write({ [K.SETTINGS]: next });
      return stripSecrets(next);
    },

    /* A 0.8.1 előtti verziók a kulcsot a settings objektumban tartották.
       Ha ott még van, átteszi az IndexedDB-be, és a settingsből kitörli. */
    async migrateSecrets() {
      if (!trusted()) return false;
      const cur = (await raw(K.SETTINGS)) || {};
      if (!SECRET_FIELDS.some(f => f in cur)) return false;
      const sec = await secretsGet();
      for (const f of SECRET_FIELDS) {
        if (cur[f] && !sec[f]) sec[f] = cur[f];
      }
      await secretsPut(sec);
      const next = stripSecrets(Object.assign({}, cur));
      for (const f of SECRET_FIELDS) next[FLAG_OF[f]] = !!sec[f];
      await write({ [K.SETTINGS]: next });
      return true;
    },

    /* ---------- célpont-szabályok (melyik elemet figyeljük) ---------- */
    async getTargets() {
      return (await raw(K.TARGETS)) || {};
    },
    async getTarget(origin) {
      return (await store.getTargets())[origin] || null;
    },
    async setTarget(origin, selector, note) {
      const all = await store.getTargets();
      all[origin] = { selector, note: note || '', savedAt: Date.now() };
      await write({ [K.TARGETS]: all });
    },
    async removeTarget(origin) {
      const all = await store.getTargets();
      delete all[origin];
      await write({ [K.TARGETS]: all });
    },

    /* ---------- célnyelvek (a DeepL-től lekért lista) ---------- */
    async getLangs() {
      const cached = await raw(K.LANGS);
      return (cached && cached.length) ? cached : null;
    },
    async saveLangs(list) {
      await write({ [K.LANGS]: list });
    },

    /* ---------- ablak állapota oldalanként ---------- */
    async getUi(origin) {
      const all = (await raw(K.UI)) || {};
      return Object.assign({}, DEFAULT_UI, all[origin] || {});
    },
    async setUi(origin, patch) {
      const all = (await raw(K.UI)) || {};
      all[origin] = Object.assign({}, DEFAULT_UI, all[origin] || {}, patch);
      await write({ [K.UI]: all });
    },

    /* ---------- felvételek ---------- */
    async listSessions() {
      const idx = (await raw(K.INDEX)) || [];
      return idx.slice().sort((a, b) => b.startedAt - a.startedAt);
    },
    async createSession(meta) {
      const id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const rec = {
        id,
        origin: meta.origin || '',
        url: meta.url || '',
        title: meta.title || '',
        targetLang: meta.targetLang || 'HU',
        startedAt: Date.now(),
        endedAt: null,
        lineCount: 0
      };
      const idx = (await raw(K.INDEX)) || [];
      idx.push(rec);
      await write({
        [K.INDEX]: idx,
        ['session:' + id]: Object.assign({}, rec, { lines: [] })
      });
      return id;
    },
    async saveSession(id, lines, endedAt) {
      const key = 'session:' + id;
      const cur = (await raw(key));
      if (!cur) return false;
      cur.lines = lines;
      cur.lineCount = lines.length;
      if (endedAt) cur.endedAt = endedAt;
      await write({ [key]: cur });

      const idx = (await raw(K.INDEX)) || [];
      const row = idx.find(r => r.id === id);
      if (row) {
        row.lineCount = lines.length;
        if (endedAt) row.endedAt = endedAt;
        await write({ [K.INDEX]: idx });
      }
      return true;
    },
    async getSession(id) {
      return (await raw('session:' + id)) || null;
    },
    async deleteSession(id) {
      await drop('session:' + id);
      const idx = ((await raw(K.INDEX)) || []).filter(r => r.id !== id);
      await write({ [K.INDEX]: idx });
    },
    async clearSessions() {
      const idx = (await raw(K.INDEX)) || [];
      await drop(idx.map(r => 'session:' + r.id));
      await write({ [K.INDEX]: [] });
    },
    async storageBytes() {
      if (!alive()) return -1;
      try { return await chrome.storage.local.getBytesInUse(null); }
      catch (e) { return -1; }
    },

    /* ---------- fogyasztásmérő (hang mód) ---------- */
    async getUsage() {
      return (await raw(K.USAGE)) || null;
    },
    async addUsage(seconds, now) {
      const next = mergeUsage(await raw(K.USAGE), seconds, now || Date.now());
      await write({ [K.USAGE]: next });
      return next;
    },
    /* A mérő nullázása nem törli a megadott egyenleget: az egy másik adat. */
    async resetUsage() {
      const cur = await raw(K.USAGE);
      if (cur && cur.balance) {
        await write({ [K.USAGE]: { since: Date.now(), total: 0, months: {}, balance: cur.balance } });
      } else {
        await drop([K.USAGE]);
      }
    },
    /* A felhasználó beírja, mennyit mutat a szolgáltató konzolja; innentől
       ebből vonjuk le, amit a mérő számol. */
    async setBalance(usd, now) {
      const next = withBalance(await raw(K.USAGE), usd, now || Date.now());
      await write({ [K.USAGE]: next });
      return next;
    }
  };

  /* A fogyasztásmérő összesítője: összesen és hónaponként, másodpercben.
     Tiszta függvény, hogy tesztelhető legyen. A hónap a helyi naptár szerint. */
  function monthKey(ms) {
    const d = new Date(ms);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function copyUsage(cur, now) {
    if (!cur || typeof cur !== 'object') return { since: now, total: 0, months: {} };
    const u = { since: cur.since || now, total: cur.total || 0, months: Object.assign({}, cur.months || {}) };
    if (cur.balance && isFinite(cur.balance.usd)) u.balance = Object.assign({}, cur.balance);
    return u;
  }
  function mergeUsage(cur, seconds, now) {
    const u = copyUsage(cur, now);
    const s = Number(seconds);
    if (!isFinite(s) || s <= 0) return u;
    const add = Math.min(s, 3600);       // egy jelentés legfeljebb 1 óra — védelem a hibás órák ellen
    u.total += add;
    const mk = monthKey(now);
    u.months[mk] = (u.months[mk] || 0) + add;
    if (u.balance) u.balance.used = (u.balance.used || 0) + add;   // az egyenleg megadása óta
    return u;
  }
  function withBalance(cur, usd, now) {
    const u = copyUsage(cur, now);
    const v = Number(usd);
    if (!isFinite(v) || v < 0) delete u.balance;
    else u.balance = { usd: v, at: now, used: 0 };
    return u;
  }
  /* Hátralévő kredit dollárban: a megadott egyenleg mínusz az azóta mért idő
     ára. Ha nincs megadva egyenleg, null. */
  function remainingUsd(u, pricePerMin) {
    if (!u || !u.balance || !isFinite(u.balance.usd)) return null;
    return Math.max(0, u.balance.usd - (u.balance.used || 0) / 60 * pricePerMin);
  }
  /* "199,87", "$199.87", "199.87 $", "1 234,5" → szám; értelmetlenre NaN. */
  function parseUsd(text) {
    let s = String(text || '').replace(/[$\s\u00a0]/g, '').replace(/USD/i, '');
    if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, '');   // 1.234,56
    s = s.replace(',', '.');
    return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }
  store.mergeUsage = mergeUsage;
  store.withBalance = withBalance;
  store.remainingUsd = remainingUsd;
  store.parseUsd = parseUsd;
  store.monthKey = monthKey;

  LFT.alive = alive;
  LFT.store = store;
})();
