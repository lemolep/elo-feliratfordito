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
      case 403: return 'Hibás vagy lejárt DeepL kulcs — ellenőrizd a beállításokban.';
      case 413: return 'Túl hosszú szöveg egy kérésben.';
      case 429: return 'Túl sok kérés — a DeepL átmenetileg lassít.';
      case 456: return 'Elfogyott a havi DeepL keret. A rögzítés megy tovább, csak fordítás nélkül.';
      case 0:   return 'Nincs hálózati kapcsolat a DeepL felé.';
      default:
        if (status >= 500) return 'A DeepL szolgáltatás átmenetileg nem elérhető.';
        return 'DeepL hiba (' + status + ').';
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

  /* Magyar nyelvnevek. Amit nem ismerünk, arra a DeepL saját (angol) nevét használjuk. */
  const LANG_HU = {
    AR: 'arab', BG: 'bolgár', CS: 'cseh', DA: 'dán', DE: 'német', EL: 'görög',
    EN: 'angol', 'EN-GB': 'angol (brit)', 'EN-US': 'angol (amerikai)',
    ES: 'spanyol', ET: 'észt', FI: 'finn', FR: 'francia', HE: 'héber',
    HU: 'magyar', ID: 'indonéz', IT: 'olasz', JA: 'japán', KO: 'koreai',
    LT: 'litván', LV: 'lett', NB: 'norvég (bokmål)', NL: 'holland', PL: 'lengyel',
    PT: 'portugál', 'PT-BR': 'portugál (brazil)', 'PT-PT': 'portugál (európai)',
    RO: 'román', RU: 'orosz', SK: 'szlovák', SL: 'szlovén', SV: 'svéd',
    TH: 'thai', TR: 'török', UK: 'ukrán', VI: 'vietnami',
    ZH: 'kínai (egyszerűsített)', 'ZH-HANS': 'kínai (egyszerűsített)', 'ZH-HANT': 'kínai (hagyományos)'
  };

  /* Ha még nincs kulcs, ebből a listából lehet választani. A kulcs megadása után
     a bővítmény lecseréli a DeepL-től lekért, valóban aktuális listára. */
  const FALLBACK_TARGETS = [
    'AR', 'BG', 'CS', 'DA', 'DE', 'EL', 'EN-GB', 'EN-US', 'ES', 'ET', 'FI', 'FR',
    'HE', 'HU', 'ID', 'IT', 'JA', 'KO', 'LT', 'LV', 'NB', 'NL', 'PL', 'PT-BR',
    'PT-PT', 'RO', 'RU', 'SK', 'SL', 'SV', 'TH', 'TR', 'UK', 'VI', 'ZH'
  ].map(code => ({ language: code, name: LANG_HU[code] || code }));

  function labelFor(code, apiName) {
    const hu = LANG_HU[String(code).toUpperCase()];
    return (hu || apiName || code) + ' (' + code + ')';
  }

  LFT.deepl = {
    translate, usage, languages, endpointFor, humanError, DeepLError,
    LANG_HU, FALLBACK_TARGETS, labelFor
  };
})();
