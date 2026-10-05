/* Beszédfelismerés (STT), szolgáltató-független felülettel.

   Két helyen fut:
     - az offscreen dokumentumban: élő kapcsolat (open), ide jön a hangfolyam;
     - a service workerben: kulcsteszt (test).
   Az offscreen dokumentumban nincs chrome.i18n, ezért az élő ág nem fordít
   szöveget: hibakódot ad vissza, a felhasználónak szóló üzenetet a service
   worker vagy a lebegő ablak állítja elő (codeToKey).

   Egy szolgáltató ennyit tud:
     open(opts, handlers) → { send(blob), close() }
       opts:     { key, model, language, keyterms[] }
       handlers: { onOpen(), onResult({ text, final, speechFinal, start, duration }),
                   onClose({ code, reason, wasOpen }), onError(code) }
     test(key) → Promise<{ ok } | { ok:false, status, code }>

   Új szolgáltató (pl. AssemblyAI vagy helyi Whisper) ugyanilyen alakú objektum
   a PROVIDERS-ben — a lánc többi része nem tud róla, melyik fut. */
globalThis.LFT = globalThis.LFT || {};

(() => {
  'use strict';

  /* Vágólapról másolt kulcsban gyakran van láthatatlan karakter — lásd a
     lib/deepl.js azonos részét. WebSocket alprotokollban egy ilyen karakter
     a kapcsolatot magát buktatja el, hibaüzenet nélkül. */
  const JUNK = /[\s​-‏­⁠﻿]/g;
  function cleanKey(k) { return String(k == null ? '' : k).replace(JUNK, ''); }
  function keyCharProblem(k) { return /[^\x21-\x7e]/.test(k); }

  /* ======================= Deepgram ======================= */

  const DG_WS = 'wss://api.deepgram.com/v1/listen';
  const DG_HTTP = 'https://api.deepgram.com/v1/listen';
  const DG_MAX_KEYTERMS = 50;    // bőven a Deepgram korlátja alatt
  const DG_KEEPALIVE_MS = 5000;  // 10 mp adat nélkül a Deepgram bontja a kapcsolatot

  function dgUrl(opts) {
    const p = new URLSearchParams();
    p.set('model', opts.model || 'nova-3');
    p.set('language', opts.language || 'en');
    p.set('smart_format', 'true');        // írásjelek, nagybetűk — a szegmentáláshoz és a DeepL-hez is kell
    p.set('interim_results', 'true');     // köztes találatok a halvány sorhoz
    p.set('endpointing', '300');          // ennyi ms csend után zár le egy szakaszt
    p.set('utterance_end_ms', '1000');
    p.set('vad_events', 'true');
    /* A Nova-3 a megadott kifejezéseket előnyben részesíti — ide jönnek a
       szakszótár angol oldalai, így a márka- és szaknevek már a felismerésben
       jók lesznek ("Unyte" és nem "Unite"). */
    const terms = (opts.keyterms || [])
      .map(t => String(t).trim()).filter(t => t && t.length <= 60)
      .slice(0, DG_MAX_KEYTERMS);
    for (const t of terms) p.append('keyterm', t);
    return DG_WS + '?' + p.toString();
  }

  /* A Deepgram üzenetéből a mi alakunk. A köztes és a végleges találat
     ugyanilyen; a "final" dönti el, hogy fordításra mehet-e. */
  function dgParse(data) {
    let m;
    try { m = JSON.parse(data); } catch (e) { return null; }
    if (!m || m.type !== 'Results') return null;
    const alt = m.channel && m.channel.alternatives && m.channel.alternatives[0];
    const text = alt && alt.transcript ? String(alt.transcript).trim() : '';
    return {
      text: text,
      final: !!m.is_final,
      speechFinal: !!m.speech_final,
      start: typeof m.start === 'number' ? m.start : null,
      duration: typeof m.duration === 'number' ? m.duration : null
    };
  }

  function dgOpen(opts, h) {
    h = h || {};
    const key = cleanKey(opts.key);
    if (!key) { setTimeout(() => h.onError && h.onError('nokey'), 0); return null; }
    if (keyCharProblem(key)) { setTimeout(() => h.onError && h.onError('keychars'), 0); return null; }

    /* A böngészőben a WebSocketnek nem lehet fejlécet adni: a Deepgram ezért
       alprotokollként fogadja a kulcsot. Nem kerül URL-be, így naplóba sem. */
    const ws = new WebSocket(dgUrl(opts), ['token', key]);
    let wasOpen = false;
    let closed = false;
    let keepAlive = null;
    const early = [];          // a kapcsolat felépülése előtt érkező hangdarabok

    ws.onopen = () => {
      wasOpen = true;
      while (early.length) ws.send(early.shift());
      keepAlive = setInterval(() => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'KeepAlive' }));
      }, DG_KEEPALIVE_MS);
      h.onOpen && h.onOpen();
    };
    ws.onmessage = ev => {
      const r = dgParse(ev.data);
      if (r && h.onResult) h.onResult(r);
    };
    ws.onerror = () => { /* a részleteket az onclose adja */ };
    ws.onclose = ev => {
      clearInterval(keepAlive);
      if (closed) return;
      closed = true;
      h.onClose && h.onClose({ code: ev.code, reason: ev.reason || '', wasOpen: wasOpen });
    };

    return {
      send(blob) {
        if (closed || !blob || !blob.size) return;
        if (ws.readyState === 1) ws.send(blob);
        else if (ws.readyState === 0 && early.length < 40) early.push(blob);
      },
      /* A CloseStream után a Deepgram még elküldi a függőben lévő végleges
         találatot, aztán maga bontja a kapcsolatot. Ezt megvárjuk (legfeljebb
         2 mp-ig), különben a leállítás előtti utolsó mondat elveszne. */
      close() {
        return new Promise(resolve => {
          if (closed) { resolve(); return; }
          clearInterval(keepAlive);
          const prev = ws.onclose;
          ws.onclose = ev => { prev(ev); resolve(); };
          try {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'CloseStream' }));
            else ws.close(1000);
          } catch (e) { resolve(); }
          setTimeout(() => { try { ws.close(1000); } catch (e) {} resolve(); }, 2000);
        });
      }
    };
  }

  /* Egy másodpercnyi csendes WAV — ezzel ellenőrizzük a kulcsot. A kérés
     "használatnak" számít (a Default szerepű kulcs csak ezt tudja), és
     a díja egy töredék cent. */
  function silentWav(seconds) {
    const rate = 8000, n = Math.round(rate * (seconds || 1));
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 2, true);
    return buf;
  }

  async function dgTest(rawKey) {
    const key = cleanKey(rawKey);
    if (!key) return { ok: false, code: 'nokey' };
    if (keyCharProblem(key)) return { ok: false, code: 'keychars' };
    let res;
    try {
      res = await fetch(DG_HTTP + '?model=nova-3&language=en', {
        method: 'POST',
        headers: { 'Authorization': 'Token ' + key, 'Content-Type': 'audio/wav' },
        body: silentWav(1)
      });
    } catch (e) {
      const offline = (typeof navigator !== 'undefined' && navigator.onLine === false);
      return { ok: false, code: offline ? 'offline' : 'blocked' };
    }
    if (res.ok) return { ok: true };
    let detail = '';
    try { const j = await res.json(); detail = (j && (j.err_msg || j.message)) || ''; } catch (e) {}
    const code = res.status === 401 || res.status === 403 ? 'key'
      : res.status === 402 ? 'credit'
      : res.status === 429 ? 'rate'
      : res.status >= 500 ? 'server' : 'other';
    return { ok: false, status: res.status, code: code, detail: detail };
  }

  const PROVIDERS = {
    deepgram: { open: dgOpen, test: dgTest, url: dgUrl, parse: dgParse }
  };

  /* Hibakód → üzenetkulcs a _locales-ban. */
  function codeToKey(code) {
    return {
      nokey: 'stt_err_nokey', keychars: 'stt_err_keychars', key: 'stt_err_key',
      credit: 'stt_err_credit', rate: 'stt_err_rate', server: 'stt_err_server',
      offline: 'stt_err_offline', blocked: 'stt_err_blocked', other: 'stt_err_other',
      noaudio: 'stt_err_noaudio', closed: 'stt_err_closed'
    }[code] || 'stt_err_other';
  }

  /* A WebSocket bezárásának kódjából a mi kódunk. A böngésző a sikertelen
     kézfogásnál (pl. rossz kulcs) nem árulja el az okot, csak 1006-ot ad —
     ezért ilyenkor a Teszt gombra irányítunk. */
  function closeToCode(ev) {
    if (!ev) return 'closed';
    if (!ev.wasOpen) return 'key';           // fel sem épült: szinte mindig a kulcs
    if (ev.code === 1011) return 'noaudio';  // Deepgram: nem kapott hangot
    if (ev.code === 1000) return null;       // rendes lezárás
    return 'closed';
  }

  LFT.stt = {
    PROVIDERS: PROVIDERS,
    open: (provider, opts, h) => (PROVIDERS[provider] || PROVIDERS.deepgram).open(opts, h),
    test: (provider, key) => (PROVIDERS[provider] || PROVIDERS.deepgram).test(key),
    codeToKey: codeToKey,
    closeToCode: closeToCode,
    cleanKey: cleanKey
  };
})();
