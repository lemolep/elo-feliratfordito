/* Az élő felirat jellemzően NŐ: "Hello" -> "Hello every" -> "Hello everyone."
   Sok lejátszó ráadásul GÖRDÍT is: a régi sor kicsúszik felül, miközben új jön alul.
   Ez az osztály ebből a folyamatos zajból csinál lezárt, fordítható mondatokat. */
globalThis.LFT = globalThis.LFT || {};

(() => {
  'use strict';

  const SENTENCE_END = /[.!?…。！？]["'”’)\]]?\s*$/;
  const MAX_PENDING = 220;   // ilyen hosszan írásjel nélkül is lezárjuk
  const MIN_LEN = 3;         // ennél rövidebb töredéket nem fordítunk
  const MIN_OVERLAP = 12;    // ennyi közös karaktertől tekintjük gördülésnek
  const DEDUPE_MEMORY = 30;  // ennyi legutóbbi sorra emlékszik az ismétlésszűrő

  function normalize(s) {
    return String(s == null ? '' : s)
      .replace(/[​-‍﻿­]/g, '')   // láthatatlan karakterek
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* Mekkora az "a" vége és a "b" eleje közötti átfedés? Gördülő feliratnál
     a következő állapot a mostani végével kezdődik. */
  function overlapLen(a, b) {
    const max = Math.min(a.length, b.length);
    for (let k = max; k >= MIN_OVERLAP; k--) {
      if (a.endsWith(b.slice(0, k))) return k;
    }
    return 0;
  }

  class Segmenter {
    constructor(opts) {
      opts = opts || {};
      this.flushDelay = opts.flushDelay || 1200;
      this.onSegment = opts.onSegment || function () {};
      this.block = '';         // az aktuálisan látható teljes felirat-blokk
      this.committedLen = 0;   // ebből ennyi karaktert adtunk már ki fordításra
      this.timer = null;
      this.recent = [];
    }

    setDelay(ms) {
      this.flushDelay = Math.max(200, Math.min(5000, ms | 0));
    }

    push(raw) {
      const t = normalize(raw);
      if (!t || t === this.block) return;

      if (!this.block) {
        this.block = t;
        this.committedLen = 0;
      } else if (t.startsWith(this.block)) {
        this.block = t;                                   // ugyanaz a blokk, csak bővült
      } else if (this.block.startsWith(t)) {
        return;                                           // villódzó rövidülés: hagyjuk
      } else {
        const k = overlapLen(this.block, t);
        if (k) {
          /* Gördülés. A blokk vége (k karakter) a képernyőn marad, az előtte lévő rész
             kicsúszik — azt még ki kell adnunk. A maradó részből annyi számít már
             kiadottnak, amennyi a kicsúszó szakaszon túlnyúlt. */
          const cut = this.block.length - k;
          this._emit(this.block.slice(this.committedLen, cut));
          this.committedLen = Math.max(0, this.committedLen - cut);
          this.block = t;
        } else {
          this._emit(this.block.slice(this.committedLen));   // teljesen új blokk
          this.block = t;
          this.committedLen = 0;
        }
      }

      const pending = this._pending();
      if (!pending) return;

      if (SENTENCE_END.test(pending) || pending.length > MAX_PENDING) {
        this.commit();
      } else {
        this._arm();
      }
    }

    _pending() {
      return this.block.slice(this.committedLen).trim();
    }

    _arm() {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.commit(), this.flushDelay);
    }

    /* Lezárja és kiadja az eddig ki nem adott részt. */
    commit() {
      clearTimeout(this.timer);
      this.timer = null;
      const text = this._pending();
      this.committedLen = this.block.length;
      this._emit(text);
    }

    _emit(text) {
      text = String(text || '').trim();
      if (text.length < MIN_LEN) return;
      if (this.recent.includes(text)) return;             // pontos ismétlés kidobva
      this.recent.push(text);
      if (this.recent.length > DEDUPE_MEMORY) this.recent.shift();
      try { this.onSegment(text); } catch (e) { console.warn('[LFT] onSegment hiba', e); }
    }

    /* Új videó / új forrás: minden állapot nullázása. */
    reset() {
      clearTimeout(this.timer);
      this.timer = null;
      this.block = '';
      this.committedLen = 0;
      this.recent = [];
    }

    dispose() {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  LFT.Segmenter = Segmenter;
  LFT.normalizeText = normalize;
})();
