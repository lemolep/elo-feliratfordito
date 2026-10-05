/* A Vimeo-keretben futó lejátszó ideje — a felső keretből.

   Hang módban a mondatok a Deepgramtól jönnek, nem a lejátszóból, ezért a
   videóidőt máshonnan kell tudni. Ha a lejátszó idegen keretben van (pl. a
   my.unyte.com Vimeo-keretei), a bővítmény nem lát bele — a Vimeo viszont
   postMessage-en válaszol a szülő oldalnak. Feliratkozunk a "timeupdate",
   "play", "pause" és "ended" eseményeire, és a legutóbb jelentett időből
   bármikor meg tudjuk mondani, hol tart.

   Biztonság: csak a https://player.vimeo.com eredetű, ÉS a lap saját
   iframe-jeiből érkező üzenetet fogadjuk el.

   Csak a felső keretben dolgozik; máshol minden hívás üres. */
globalThis.LFT = globalThis.LFT || {};

(() => {
  'use strict';

  const ORIGIN = 'https://player.vimeo.com';
  const POLL_MS = 1000;         // új keretek keresése + az idő rákérdezése
  const EVENTS = ['timeupdate', 'play', 'pause', 'ended'];

  const isTop = (() => { try { return window.top === window; } catch (e) { return false; } })();
  const players = new Map();    // contentWindow → { time, at, playing, subscribed }
  let listening = false;
  let rescanTimer = null;

  function vimeoFrames() {
    return Array.from(document.querySelectorAll('iframe'))
      .filter(f => /(^|\/\/)player\.vimeo\.com\//.test(f.getAttribute('src') || ''));
  }

  function isOurFrame(win) {
    return vimeoFrames().some(f => f.contentWindow === win);
  }

  function post(win, method, value) {
    const msg = value === undefined ? { method: method } : { method: method, value: value };
    try { win.postMessage(JSON.stringify(msg), ORIGIN); } catch (e) { /* a keret közben eltűnt */ }
  }

  function stateOf(win) {
    let st = players.get(win);
    if (!st) { st = { time: null, at: 0, playing: false, subscribed: false }; players.set(win, st); }
    return st;
  }

  function subscribe(win) {
    const st = stateOf(win);
    for (const ev of EVENTS) post(win, 'addEventListener', ev);
    post(win, 'getCurrentTime');
    post(win, 'getPaused');
    st.subscribed = true;
  }

  function onMessage(e) {
    if (e.origin !== ORIGIN) return;
    if (!isOurFrame(e.source)) return;
    let d = e.data;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (x) { return; } }
    if (!d || typeof d !== 'object') return;

    const st = stateOf(e.source);
    const now = Date.now();
    if (d.event === 'ready') { subscribe(e.source); return; }
    if (d.event === 'timeupdate' && d.data && typeof d.data.seconds === 'number') {
      st.time = d.data.seconds; st.at = now; st.playing = true;
    } else if (d.event === 'play') {
      st.playing = true;
    } else if (d.event === 'pause' || d.event === 'ended') {
      st.playing = false;
      if (d.data && typeof d.data.seconds === 'number') { st.time = d.data.seconds; st.at = now; }
    } else if (d.method === 'getCurrentTime' && typeof d.value === 'number') {
      st.time = d.value; st.at = now;
    } else if (d.method === 'getPaused' && typeof d.value === 'boolean') {
      st.playing = !d.value;
    }
  }

  /* Az új vagy későn betöltődő lejátszókat feliratkoztatja, a meglévőktől
     pedig rákérdez az időre. A rákérdezés biztonsági háló: a metódushívásokra
     a Vimeo bizonyítottan válaszol (2026-10-05, my.unyte.com), így akkor is
     tudjuk az időt, ha az események valamiért nem jönnének. */
  function rescan() {
    for (const f of vimeoFrames()) {
      const w = f.contentWindow;
      if (!w) continue;
      if (!stateOf(w).subscribed) { subscribe(w); continue; }
      post(w, 'getCurrentTime');
      post(w, 'getPaused');
    }
  }

  /* Bekapcsolva figyeli a lejátszókat; kikapcsolva csak az új keretek
     keresése áll le — a már meglévő adatot nem dobjuk el. */
  function watch(on) {
    if (!isTop) return;
    if (on) {
      if (!listening) { window.addEventListener('message', onMessage); listening = true; }
      rescan();
      clearInterval(rescanTimer);
      rescanTimer = setInterval(rescan, POLL_MS);
    } else {
      clearInterval(rescanTimer);
      rescanTimer = null;
    }
  }

  /* A legvalószínűbb lejátszó: amelyik épp megy; ha egyik sem, amelyik
     legutóbb jelentett. Játszás közben a legutóbbi jelentéstől előreszámolunk. */
  function now() {
    let best = null;
    for (const st of players.values()) {
      if (st.time == null) continue;
      if (!best || (st.playing && !best.playing) || (st.playing === best.playing && st.at > best.at)) best = st;
    }
    if (!best) return null;
    const t = best.playing ? best.time + (Date.now() - best.at) / 1000 : best.time;
    return { time: t, playing: best.playing };
  }

  LFT.vimeo = { watch: watch, now: now, _onMessage: onMessage, _players: players };
})();
