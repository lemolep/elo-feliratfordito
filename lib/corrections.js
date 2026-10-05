/* Hallásjavító lista: a félrehallott szavak cseréje, mielőtt a mondat
   fordításra megy.

   Miért kell a szakszótár mellett: a szakszótár a FORDÍTÁST irányítja
   (polyvagal → polivagális), de ha a felismerés eleve rosszul írta le a szót
   ("Unite" az "Unyte" helyett), azt a DeepL már nem tudja megjavítani — ő
   csak azt fordítja, amit kap. A 2026-10-05-i my.unyte.com átiratban így lett
   "MyUnite" és "Unite ILS app". A YouTube automatikus felirata ugyanígy hibázik,
   ezért a javítás mindkét módban érvényes.

   Formátum, soronként egy szabály:
       Unite → Unyte
       MyUnite -> MyUnyte
       safe and sound protocol = Safe and Sound Protocol
       # a # jellel kezdődő sor megjegyzés
   Elválasztó: →  ->  =>  =  vagy tabulátor.

   Illesztés: kis- és nagybetűtől függetlenül, de csak EGÉSZ szóra/kifejezésre —
   a "Unite" szabály a "United"-et nem bántja. A csere szó szerint az, amit a
   jobb oldalra írtál. A hosszabb kifejezések előbb kerülnek sorra, hogy a
   rövidebb szabály ne rágja szét őket. */
globalThis.LFT = globalThis.LFT || {};

(() => {
  'use strict';

  const SEP = /\s*(?:→|->|=>|=|\t)\s*/;
  const MAX_RULES = 200;

  function parse(text) {
    const rules = [];
    const bad = [];
    const seen = new Set();
    String(text || '').split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      const m = SEP.exec(line);
      if (!m) { bad.push(i + 1); return; }
      const from = line.slice(0, m.index).replace(/\s+/g, ' ').trim();
      const to = line.slice(m.index + m[0].length).replace(/\s+/g, ' ').trim();
      if (!from || !to) { bad.push(i + 1); return; }
      const key = from.toLowerCase();
      if (seen.has(key)) return;                 // az első szabály nyer
      seen.add(key);
      if (rules.length < MAX_RULES) rules.push({ from: from, to: to });
    });
    return { rules: rules, bad: bad };
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* Egyetlen reguláris kifejezés az összes szabályból (hosszabb előre), és
     egy táblázat, ami a talált szövegből megmondja a cserét. A szóköz a
     kifejezésen belül bármennyi szóközre illeszkedik. */
  function compile(rules) {
    if (!rules || !rules.length) return t => t;
    const sorted = rules.slice().sort((a, b) => b.from.length - a.from.length);
    const map = new Map(sorted.map(r => [r.from.toLowerCase().replace(/\s+/g, ' '), r.to]));
    const alt = sorted.map(r => escapeRe(r.from).replace(/ /g, '\\s+')).join('|');
    const re = new RegExp('(?<![\\p{L}\\p{N}])(?:' + alt + ')(?![\\p{L}\\p{N}])', 'giu');
    return text => String(text == null ? '' : text).replace(re, m => {
      const to = map.get(m.toLowerCase().replace(/\s+/g, ' '));
      return to == null ? m : to;
    });
  }

  /* Gyorsítótár: a lebegő ablak minden mondatnál hívja, a lista ritkán változik. */
  let cacheText = null;
  let cacheFn = t => t;
  function fixer(text) {
    if (text !== cacheText) {
      cacheText = text;
      cacheFn = compile(parse(text).rules);
    }
    return cacheFn;
  }

  LFT.corrections = { parse: parse, compile: compile, fixer: fixer };
})();
