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
    INDEX: 'sessionIndex'
  };

  const DEFAULT_SETTINGS = {
    deeplKey: '',
    flushDelay: 1200,     // ms — ennyi változatlanság után zárja le a felirat-sort
    fontSize: 20,         // px — alap betűméret
    opacity: 85,          // % — az ablak hátterének átlátszatlansága
    bilingual: true,      // igaz = eredeti + fordítás, hamis = csak a fordítás
    targetLang: 'HU',     // ide fordít — a DeepL bármely célnyelve lehet
    domains: []           // engedélyezett hostnevek, pl. ["youtube.com"]
  };

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
    async getSettings() {
      return Object.assign({}, DEFAULT_SETTINGS, (await raw(K.SETTINGS)) || {});
    },
    async saveSettings(patch) {
      const next = Object.assign(await store.getSettings(), patch);
      await write({ [K.SETTINGS]: next });
      return next;
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
    }
  };

  LFT.alive = alive;
  LFT.store = store;
})();
