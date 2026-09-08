/* DeepL kliens. Kizárólag a service workerben és az options oldalon fut,
   így az API kulcs soha nem kerül be a megnyitott weboldalba. */
globalThis.LFT = globalThis.LFT || {};

(() => {
  'use strict';

  class DeepLError extends Error {
    constructor(status, message) {
      super(message);
      this.name = 'DeepLError';
      this.status = status;
    }
  }

  /* A Free kulcs ":fx"-re végződik — ebből dől el az endpoint.
     Így Pro-ra váltáskor sem kell kódot módosítani. */
  function endpointFor(key) {
    return String(key || '').trim().endsWith(':fx')
      ? 'https://api-free.deepl.com'
      : 'https://api.deepl.com';
  }

  function humanError(status) {
    switch (status) {
      case 401:
      case 403: return LFT.t('dl_err_key');
      case 413: return LFT.t('dl_err_toolong');
      case 429: return LFT.t('dl_err_rate');
      case 456: return LFT.t('dl_err_quota');
      case 0:   return LFT.t('dl_err_offline');
      default:
        if (status >= 500) return LFT.t('dl_err_server');
        return LFT.t('dl_err_other', [String(status)]);
    }
  }

  async function call(key, path, params, method) {
    const url = endpointFor(key) + path;
    const opts = {
      method: method || 'POST',
      headers: { 'Authorization': 'DeepL-Auth-Key ' + String(key).trim() }
    };
    if (params && opts.method !== 'GET' && opts.method !== 'DELETE') {
      opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      opts.body = params.toString();
    }

    let res;
    try {
      res = await fetch(url, opts);
    } catch (e) {
      throw new DeepLError(0, humanError(0));
    }
    if (!res.ok) {
      let detail = '';
      try {
        const j = await res.json();
        detail = (j && j.message) || '';
      } catch (e) { /* nem JSON */ }
      throw new DeepLError(res.status, humanError(res.status) + (detail ? ' — ' + detail : ''));
    }
    if (res.status === 204) return {};
    const text = await res.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch (e) { return {}; }
  }

  /* Egy kérésben több szöveget is fordít — ez spórolja a legtöbbet a kereten.
     opts: { sourceLang, glossaryId }  — szótár használatakor a DeepL megköveteli
     a forrásnyelv megadását. */
  async function translate(key, texts, targetLang, opts) {
    if (!key) throw new DeepLError(403, humanError(403));
    opts = opts || {};

    const p = new URLSearchParams();
    for (const t of texts) p.append('text', t);
    p.append('target_lang', targetLang || 'HU');
    p.append('preserve_formatting', '1');
    p.append('split_sentences', 'nonewlines');

    /* source_lang csak akkor megy, ha szótárat is használunk — egyébként
       hagyjuk, hadd ismerje fel a DeepL magától. */
    if (opts.glossaryId && opts.sourceLang) {
      p.append('source_lang', opts.sourceLang);
      p.append('glossary_id', opts.glossaryId);
    }

    const data = await call(key, '/v2/translate', p);
    const out = (data && data.translations) || [];
    return {
      texts: texts.map((_, i) => (out[i] && out[i].text) || ''),
      detected: (out[0] && out[0].detected_source_language) || ''
    };
  }

  async function usage(key) {
    if (!key) throw new DeepLError(403, humanError(403));
    return call(key, '/v2/usage', new URLSearchParams());
  }

  /* A DeepL maga mondja meg, mely nyelvekre tud fordítani — így a lista akkor is
     naprakész marad, ha a szolgáltatás újakkal bővül. */
  async function languages(key, type) {
    if (!key) throw new DeepLError(403, humanError(403));
    const p = new URLSearchParams();
    p.append('type', type || 'target');
    return call(key, '/v2/languages', p);
  }

  /* ---------------- szakszótár ---------------- */

  /* A DeepL szótárai nem módosíthatók: változtatáskor újat kell létrehozni,
     a régit pedig törölni, hogy ne gyűljenek a fiókban. */
  async function glossaryCreate(key, name, sourceLang, targetLang, entriesTsv) {
    if (!key) throw new DeepLError(403, humanError(403));
    const p = new URLSearchParams();
    p.append('name', name);
    p.append('source_lang', sourceLang);
    p.append('target_lang', targetLang);
    p.append('entries', entriesTsv);
    p.append('entries_format', 'tsv');
    return call(key, '/v2/glossaries', p);
  }

  async function glossaryDelete(key, id) {
    if (!key || !id) return {};
    return call(key, '/v2/glossaries/' + encodeURIComponent(id), null, 'DELETE');
  }

  async function glossaryList(key) {
    if (!key) throw new DeepLError(403, humanError(403));
    const data = await call(key, '/v2/glossaries', null, 'GET');
    return (data && data.glossaries) || [];
  }

  /* Ha még nincs kulcs, ebből a listából lehet választani. A kulcs megadása után
     a bővítmény lecseréli a DeepL-től lekért, valóban aktuális listára. */
  const FALLBACK_TARGETS = [
    'AR', 'BG', 'CS', 'DA', 'DE', 'EL', 'EN-GB', 'EN-US', 'ES', 'ET', 'FI', 'FR',
    'HE', 'HU', 'ID', 'IT', 'JA', 'KO', 'LT', 'LV', 'NB', 'NL', 'PL', 'PT-BR',
    'PT-PT', 'RO', 'RU', 'SK', 'SL', 'SV', 'TH', 'TR', 'UK', 'VI', 'ZH'
  ].map(code => ({ language: code, name: null }));

  /* A nyelvneveket a böngésző adja, a felület nyelvén — így nem kell kézzel
     karbantartott névlistát vezetnünk, és minden felületi nyelven helyes. */
  let displayNames = null;
  function nameOf(code) {
    if (displayNames === null) {
      try {
        displayNames = new Intl.DisplayNames([LFT.i18n.uiLang()], { type: 'language' });
      } catch (e) { displayNames = false; }
    }
    if (!displayNames) return null;
    try { return displayNames.of(code) || null; }
    catch (e) { return null; }
  }

  function labelFor(code, apiName) {
    const nice = nameOf(code) || apiName || code;
    return nice + ' (' + code + ')';
  }

  LFT.deepl = {
    translate, usage, languages, endpointFor, humanError, DeepLError,
    glossaryCreate, glossaryDelete, glossaryList,
    FALLBACK_TARGETS, labelFor
  };
})();
