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

  async function call(key, path, params) {
    const url = endpointFor(key) + path;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': 'DeepL-Auth-Key ' + String(key).trim(),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      });
    } catch (e) {
      throw new DeepLError(0, humanError(0));
    }
    if (!res.ok) throw new DeepLError(res.status, humanError(res.status));
    return res.json();
  }

  /* Egy kérésben több szöveget is fordít — ez spórolja a legtöbbet a kereten. */
  async function translate(key, texts, targetLang) {
    if (!key) throw new DeepLError(403, humanError(403));
    const p = new URLSearchParams();
    for (const t of texts) p.append('text', t);
    p.append('target_lang', targetLang || 'HU');
    p.append('preserve_formatting', '1');
    p.append('split_sentences', 'nonewlines');
    // source_lang szándékosan hiányzik → a DeepL automatikusan felismeri a nyelvet
    const data = await call(key, '/v2/translate', p);
    const out = (data && data.translations) || [];
    return texts.map((_, i) => (out[i] && out[i].text) || '');
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
    FALLBACK_TARGETS, labelFor
  };
})();
