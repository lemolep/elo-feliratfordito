/* Mondatgyűjtő a hangfelismeréshez.

   A Deepgram ott zár le egy szakaszt, ahol a beszélő levegőt vesz — ez
   sokszor mondat közben van ("…intro video to help" | "you get started…").
   A fél mondat rosszul fordul, és a DeepL a megszólítást is elvéti, mert
   nem látja az egészet. Ez az osztály a lezárt szakaszokat mondatvégig
   gyűjti, és csak kész mondatot ad tovább.

     - Ha egy szakaszban egy mondat vége és egy új eleje is van, a
       mondatvégnél vág, a maradékot a következőhöz fűzi.
     - Ha egy ideig (waitMs) nem jön mondatvég, akkor is továbbadja,
       hogy semmi ne ragadjon be.
     - A rövidítések pontja ("Dr. Porges", "e.g.") nem mondatvég.

   Ez NEM a lib/segmenter.js: az a DOM-felirat növekedését és gördülését
   kezeli. A Deepgram végleges szakaszai nem nőnek és nem fednek át. */
globalThis.LFT = globalThis.LFT || {};

(() => {
  'use strict';

  /* Mondatvég: írásjel, utána esetleg idézőjel/zárójel, utána szóköz vagy vége. */
  const END = /[.!?…]+["'”’)\]]*(?=\s|$)/g;

  /* Ezek után a pont nem zár mondatot. Kisbetűvel hasonlítunk. */
  const ABBREV = new Set([
    'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e',
    'approx', 'dept', 'inc', 'ltd', 'co', 'no', 'vol', 'fig', 'u.s', 'a.m', 'p.m'
  ]);

  function isRealEnd(text, idx) {
    // csak a pontnál lehet rövidítés; a ! ? … mindig mondatvég
    if (text[idx] !== '.') return true;
    const before = text.slice(0, idx);
    const word = (/([A-Za-z][A-Za-z.]*)$/.exec(before) || [])[1] || '';
    if (!word) return true;
    if (ABBREV.has(word.toLowerCase())) return false;
    if (/^[A-Z]$/.test(word)) return false;           // monogram: "S. Porges"
    return true;
  }

  /* A szövegben a kész mondatok végeinek pozíciói (a végjel utáni index). */
  function sentenceEnds(text) {
    const out = [];
    END.lastIndex = 0;
    let m;
    while ((m = END.exec(text))) {
      if (isRealEnd(text, m.index)) out.push(m.index + m[0].length);
    }
    return out;
  }

  class SentenceJoiner {
    constructor(opts) {
      opts = opts || {};
      this.onSentence = opts.onSentence || function () {};
      this.waitMs = opts.waitMs || 2500;
      this.maxLen = opts.maxLen || 400;
      this.buf = '';
      this.meta = null;          // a pufferben lévő (első) mondat kezdetének adatai
      this.timer = null;
    }

    /* text: egy végleges szakasz; meta: { at, duration } — mikor kezdődött. */
    push(text, meta) {
      text = String(text || '').trim();
      if (!text) return;
      if (!this.buf) this.meta = meta || null;
      this.buf = this.buf ? this.buf + ' ' + text : text;

      const ends = sentenceEnds(this.buf);
      let from = 0;
      for (const end of ends) {
        const sentence = this.buf.slice(from, end).trim();
        if (sentence) this._emit(sentence, from === 0 ? this.meta : meta);
        from = end;
      }
      if (from > 0) {
        this.buf = this.buf.slice(from).trim();
        // a maradék a mostani szakaszban kezdődött: annak az adatai a legközelebbiek
        this.meta = this.buf ? (meta || null) : null;
      }

      if (this.buf.length > this.maxLen) { this.flush(); return; }
      this._arm();
    }

    /* Mindent továbbad, ami a pufferben van (leállításkor, vagy ha nem jön mondatvég). */
    flush() {
      clearTimeout(this.timer);
      this.timer = null;
      const rest = this.buf.trim();
      const meta = this.meta;
      this.buf = '';
      this.meta = null;
      if (rest) this._emit(rest, meta);
    }

    reset() {
      clearTimeout(this.timer);
      this.timer = null;
      this.buf = '';
      this.meta = null;
    }

    _arm() {
      clearTimeout(this.timer);
      this.timer = null;
      if (this.buf) this.timer = setTimeout(() => this.flush(), this.waitMs);
    }

    _emit(text, meta) {
      try { this.onSentence(text, meta || {}); } catch (e) { /* a hívó hibája ne állítsa meg a gyűjtést */ }
    }
  }

  LFT.SentenceJoiner = SentenceJoiner;
  LFT.sentenceEnds = sentenceEnds;
})();
