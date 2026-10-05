/* .srt feliratfájl készítése a rögzített sorokból.

   Bemenet: a felvétel sorai — { t, videoTime, src, hu } (lásd overlay/session).
   Kimenet: SRT szöveg, amit bármelyik lejátszó (VLC, mpv, YouTube feltöltés,
   videószerkesztők) betölt.

   Amire figyelünk, hogy lejátszóban is jól használható legyen:
     - Időzítés: a videó saját idejéből (videoTime). Ahol az hiányzik, a
       legközelebbi ismert sortól a falióra-különbséggel számolunk.
     - Meddig látszik: a következő felirat kezdetéig, de legalább MIN_DUR,
       legfeljebb MAX_DUR másodpercig, az olvasási sebességhez (CPS) igazítva.
     - Sorhossz: egy sor legfeljebb MAX_LINE karakter, egy kocka legfeljebb két
       sor; a hosszabb mondat több egymást követő kockára bomlik, az időt a
       szöveg arányában osztjuk szét.
     - Tekerés: ha a felhasználó visszatekert, a kockák videóidő szerint
       sorba kerülnek. */
globalThis.LFT = globalThis.LFT || {};

(() => {
  'use strict';

  const MIN_DUR = 1.2;    // mp — ennél rövidebb ideig nem olvasható el semmi
  const MAX_DUR = 7;      // mp — ennél tovább egy felirat se álljon a képen
  const CPS = 15;         // karakter/mp — kényelmes olvasási sebesség
  const GAP = 0.05;       // mp — rés két felirat között, hogy ne folyjanak egybe
  const MAX_LINE = 42;    // karakter/sor — a feliratozásban szokásos felső határ

  function pad(n, w) { return String(n).padStart(w || 2, '0'); }

  /* 83.4 → "00:01:23,400" */
  function ts(sec) {
    const ms = Math.max(0, Math.round((sec || 0) * 1000));
    return pad(Math.floor(ms / 3600000)) + ':' + pad(Math.floor(ms / 60000) % 60) + ':' +
      pad(Math.floor(ms / 1000) % 60) + ',' + pad(ms % 1000, 3);
  }

  /* Minden sor kezdete videóidőben. Ahol a videoTime hiányzik, a legközelebbi
     ismert sortól a falióra-különbséggel számolunk; ha egyik sornál sincs,
     a felvétel kezdetétől. */
  function startTimes(lines) {
    const known = [];
    lines.forEach((l, i) => { if (l.videoTime != null && isFinite(l.videoTime)) known.push(i); });
    const t0 = lines.length ? lines[0].t : 0;
    return lines.map((l, i) => {
      if (l.videoTime != null && isFinite(l.videoTime)) return l.videoTime;
      if (!known.length) return Math.max(0, (l.t - t0) / 1000);
      // a legközelebbi ismert sor (előtte, ha van; különben utána)
      let ref = known[0];
      for (const k of known) { if (k <= i) ref = k; else break; }
      return Math.max(0, lines[ref].videoTime + (l.t - lines[ref].t) / 1000);
    });
  }

  function clean(text) {
    return String(text || '').replace(/\s+/g, ' ').replace(/-->/g, '→').trim();
  }

  /* Szövegsorokra tördelés: mohón tölt, szóhatáron, legfeljebb max karakterig. */
  function wrapAll(text, max) {
    const words = clean(text).split(' ').filter(Boolean);
    const out = [];
    let cur = '';
    for (const w of words) {
      if (cur && cur.length + 1 + w.length > max) { out.push(cur); cur = w; }
      else cur = cur ? cur + ' ' + w : w;
    }
    if (cur) out.push(cur);
    return out;
  }

  /* Egy kockányi szöveg (legfeljebb 2 sor) — a középhez legközelebbi szóközön
     törve, hogy a két sor nagyjából egyforma legyen. */
  function wrap(text, max) {
    text = clean(text);
    max = max || MAX_LINE;
    if (text.length <= max) return text ? [text] : [];
    const mid = text.length / 2;
    let best = -1;
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== ' ') continue;
      const ok = i <= max && text.length - i - 1 <= max;
      const bestOk = best >= 0 && best <= max && text.length - best - 1 <= max;
      if (best < 0 || (ok && !bestOk) || (ok === bestOk && Math.abs(i - mid) < Math.abs(best - mid))) best = i;
    }
    if (best < 0) return [text];                 // egyetlen hosszú szó
    return [text.slice(0, best), text.slice(best + 1)];
  }

  /* Hosszú szöveg darabolása kockákra (egy kocka legfeljebb 2*max karakter),
     szóhatáron, nagyjából egyenlő részekre. */
  function chunks(text, max) {
    text = clean(text);
    max = max || MAX_LINE;
    const limit = 2 * max;
    if (text.length <= limit) return text ? [text] : [];
    const n = Math.ceil(text.length / limit);
    const target = Math.ceil(text.length / n);
    const words = text.split(' ');
    const out = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? cur + ' ' + w : w;
      if (cur && (next.length > limit || (cur.length >= target && out.length < n - 1))) { out.push(cur); cur = w; }
      else cur = next;
    }
    if (cur) out.push(cur);
    return out;
  }

  /* lines: [{ t, videoTime, src, hu }]
     mode:  'target' — a fordítás (ahol nincs, az eredeti, hogy ne legyen lyuk)
            'source' — az eredeti
            'both'   — fordítás, alatta dőlten az eredeti */
  function build(lines, opts) {
    opts = opts || {};
    const mode = opts.mode || 'target';
    const max = opts.maxLine || MAX_LINE;
    lines = (lines || []).filter(l => l && (clean(l.src) || clean(l.hu)));
    const starts = startTimes(lines);

    const items = lines.map((l, i) => ({
      start: starts[i], i: i,
      src: clean(l.src), hu: clean(l.hu)
    })).sort((a, b) => (a.start - b.start) || (a.i - b.i));

    const cues = [];
    items.forEach((it, k) => {
      const main = mode === 'source' ? it.src : (it.hu || it.src);
      const next = items[k + 1];
      /* A 7 mp-es korlát KOCKÁNKÉNT érvényes, nem a teljes sorra: egy hosszú
         mondatból több kocka lesz, és mindegyiknek el kell tudni olvasni.
         (Egy 600 karakteres sor 7 mp-be préselve 1 mp alatti kockákat adott.)
         A teljes időt csak a következő felirat kezdete vághatja el. */
      const parts = chunks(main, max);
      const durs = parts.map(p => Math.max(MIN_DUR, Math.min(MAX_DUR, p.length / CPS)));
      const want = durs.reduce((a, b) => a + b, 0) || MIN_DUR;
      let end = it.start + want;
      if (next) end = Math.min(end, next.start - GAP);
      end = Math.max(end, it.start + 0.5);           // azonos időben induló soroknál is látsszon

      if (mode === 'both') {
        const top = wrapAll(it.hu || it.src, max);
        const bottom = it.hu && it.src ? wrapAll(it.src, max) : [];
        if (bottom.length) { bottom[0] = '<i>' + bottom[0]; bottom[bottom.length - 1] += '</i>'; }
        cues.push({ start: it.start, end: end, lines: top.concat(bottom) });
        return;
      }

      // a rendelkezésre álló időt a kockák kívánt hosszának arányában osztjuk szét
      const scale = (end - it.start) / want;
      let at = it.start;
      parts.forEach((p, j) => {
        const span = durs[j] * scale;
        const e = j === parts.length - 1 ? end : at + span;
        cues.push({ start: at, end: e, lines: wrap(p, max) });
        at = e;
      });
    });

    return cues.map((c, i) =>
      (i + 1) + '\r\n' + ts(c.start) + ' --> ' + ts(c.end) + '\r\n' + c.lines.join('\r\n') + '\r\n'
    ).join('\r\n');
  }

  LFT.srt = { build: build, ts: ts, wrap: wrap, wrapAll: wrapAll, chunks: chunks, startTimes: startTimes };
})();
