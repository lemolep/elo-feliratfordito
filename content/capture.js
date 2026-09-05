/* Felirat kiolvasása. Minden frame-ben fut (a lejátszó gyakran iframe-ben van).
   Két forrást ismer:
     1. a videó saját TextTrack-je (cuechange) — ha van, ez a legmegbízhatóbb
     2. a "célzóval" kijelölt DOM elem szövege (MutationObserver)
   A lezárt mondatokat a legfelső frame ablakának küldi. */
globalThis.LFT = globalThis.LFT || {};

(() => {
  'use strict';
  if (window.__lftCaptureLoaded) return;   // kétszeri beinjektálás ellen
  window.__lftCaptureLoaded = true;

  const IS_TOP = window.top === window;
  const ORIGIN = location.origin;

  let seg = null;              // Segmenter
  let running = false;
  let mode = null;             // 'texttrack' | 'dom' | null
  let observer = null;
  let targetEl = null;
  let targetSelector = null;
  let rescanTimer = null;
  let noTextTimer = null;
  let gotAnyText = false;
  const boundTracks = new WeakSet();

  /* ---------------- kimenet ---------------- */

  /* A bővítmény újratöltése után a chrome.runtime.sendMessage azonnal dob
     ("Extension context invalidated"), ezért nem elég a .catch(). */
  function send(msg) {
    if (!LFT.alive()) return;
    try {
      const p = chrome.runtime.sendMessage(msg);
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* nincs hova küldeni */ }
  }

  function bestVideo() {
    let best = null, bestArea = -1;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (area >= bestArea) { bestArea = area; best = v; }
    }
    return best;
  }

  function emit(text) {
    gotAnyText = true;
    const v = bestVideo();
    const payload = {
      text: text,
      t: Date.now(),
      videoTime: v && isFinite(v.currentTime) ? v.currentTime : null
    };
    if (IS_TOP && LFT.overlay) LFT.overlay.onSegment(payload);
    else send({ type: 'relay:segment', seg: payload });
  }

  function status(text, kind) {
    if (IS_TOP && LFT.overlay) LFT.overlay.setStatus(text, kind);
    else send({ type: 'relay:status', text: text, kind: kind });
  }

  /* ---------------- 1. forrás: TextTrack ---------------- */

  function readActiveCues(track) {
    const cues = track.activeCues;
    if (!cues || !cues.length) return '';
    const parts = [];
    for (let i = 0; i < cues.length; i++) {
      const c = cues[i];
      let s = c.text;
      if (s == null && c.getCueAsHTML) s = c.getCueAsHTML().textContent;
      if (s) parts.push(String(s).replace(/<[^>]*>/g, ' '));
    }
    return parts.join(' ');
  }

  function bindTrack(track) {
    if (!track || boundTracks.has(track)) return;
    const kind = track.kind;
    if (kind && kind !== 'subtitles' && kind !== 'captions') return;
    if (track.mode === 'disabled') return;   // a lejátszó kikapcsolta — nem nyúlunk hozzá
    boundTracks.add(track);
    track.addEventListener('cuechange', () => {
      if (!running || mode !== 'texttrack') return;
      const txt = readActiveCues(track);
      if (txt) seg.push(txt);
    });
  }

  function scanTextTracks() {
    let active = 0;
    for (const v of document.querySelectorAll('video')) {
      const list = v.textTracks;
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const tr = list[i];
        if (tr.mode !== 'disabled') active++;
        bindTrack(tr);
      }
      if (!v.__lftTrackHook && list.addEventListener) {
        v.__lftTrackHook = true;
        list.addEventListener('addtrack', ev => bindTrack(ev.track));
      }
    }
    return active;
  }

  /* ---------------- 2. forrás: kijelölt DOM elem ---------------- */

  function readTarget() {
    if (!targetEl || !targetEl.isConnected) return null;
    return targetEl.innerText || targetEl.textContent || '';
  }

  function attachObserver(el) {
    detachObserver();
    targetEl = el;
    observer = new MutationObserver(() => {
      if (!running) return;
      const txt = readTarget();
      if (txt) seg.push(txt);
    });
    observer.observe(el, { childList: true, characterData: true, subtree: true });
    const first = readTarget();
    if (first) seg.push(first);
  }

  function detachObserver() {
    if (observer) { observer.disconnect(); observer = null; }
    targetEl = null;
  }

  /* A lejátszó újrarajzoláskor kicserélheti az elemet — fél másodpercenként visszakeressük. */
  function keepTargetAlive() {
    clearInterval(rescanTimer);
    let missingSince = 0;
    rescanTimer = setInterval(() => {
      if (!running || mode !== 'dom') return;
      if (targetEl && targetEl.isConnected) { missingSince = 0; return; }
      const el = LFT.selector.find(targetSelector);
      if (el) {
        missingSince = 0;
        attachObserver(el);
      } else if (!missingSince) {
        missingSince = Date.now();
      } else if (Date.now() - missingSince > 10000) {
        missingSince = Date.now();
        status(LFT.t('cap_target_lost'), 'warn');
      }
    }, 500);
  }

  /* Ha nincs miből dolgoznunk, mondjuk meg konkrétan, miért. A leggyakoribb ok,
     hogy a lejátszó külön keretben van, amibe engedély nélkül nem látunk bele —
     ilyenkor a célzó sem segít, mert a kattintás oda be sem jut. */
  function noSourceHint() {
    if (!document.querySelector('video')) {
      const ifr = listIframes();
      if (ifr.list.length) {
        return LFT.t('cap_no_source_iframe', [ifr.list[0].host]);
      }
    }
    return LFT.t('cap_no_source');
  }

  /* ---------------- indítás / leállítás ---------------- */

  async function start(flushDelay) {
    if (running) return;
    if (!seg) seg = new LFT.Segmenter({ flushDelay: flushDelay || 1200, onSegment: emit });
    else { seg.setDelay(flushDelay || 1200); seg.reset(); }

    running = true;
    gotAnyText = false;

    const target = await LFT.store.getTarget(ORIGIN);
    if (target && target.selector) {
      mode = 'dom';
      targetSelector = target.selector;
      const el = LFT.selector.find(targetSelector);
      if (el) attachObserver(el);
      keepTargetAlive();
    } else {
      mode = 'texttrack';
      const active = scanTextTracks();
      clearInterval(rescanTimer);
      rescanTimer = setInterval(() => { if (running && mode === 'texttrack') scanTextTracks(); }, 1000);
      if (IS_TOP && !active) status(noSourceHint(), 'warn');
    }

    clearTimeout(noTextTimer);
    noTextTimer = setTimeout(() => {
      if (!running || gotAnyText) return;

      /* Biztonsági háló: ha a kijelölt elemből nem jön semmi, de a videónak van
         saját feliratsávja, magunktól átváltunk arra — egy rossz szabály így nem
         teszi használhatatlanná az egészet. */
      if (mode === 'dom' && scanTextTracks() > 0) {
        mode = 'texttrack';
        detachObserver();
        clearInterval(rescanTimer);
        rescanTimer = setInterval(() => { if (running && mode === 'texttrack') scanTextTracks(); }, 1000);
        status(LFT.t('cap_switched_to_track'), 'warn');
        return;
      }

      if (IS_TOP) status(noSourceHint(), 'warn');
    }, 6000);
  }

  function stop() {
    running = false;
    mode = null;
    clearTimeout(noTextTimer);
    clearInterval(rescanTimer);
    detachObserver();
    if (seg) { seg.commit(); seg.reset(); }
  }

  /* Ha a bővítményt újratöltötték vagy kikapcsolták, ez a példány árván marad.
     Ilyenkor mindent leállítunk, hogy ne járjanak tovább az időzítők. */
  let aliveTimer = setInterval(() => {
    if (LFT.alive()) return;
    clearInterval(aliveTimer);
    aliveTimer = null;
    running = false;
    mode = null;
    clearTimeout(noTextTimer);
    clearInterval(rescanTimer);
    detachObserver();
    disablePicker();
    if (seg) seg.dispose();
  }, 2000);

  /* ---------------- célzó ---------------- */

  let pickerOn = false;
  let pickArmedAt = 0;
  let hlHost = null, hlBox = null, hlTip = null;

  /* A célzás alatt a fordítóablak átkattintható, hogy elérd az alatta lévő feliratot.
     Emiatt viszont az ablakra érkező kattintás is átmenne az oldalra — azt itt fogjuk meg. */
  function pointOverOverlay(x, y) {
    const h = document.getElementById('lft-overlay-host');
    if (!h || h.style.display === 'none') return false;
    const r = h.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  /* Felirat gyakorlatilag soha nem link vagy gomb — ez biztos elgépelt kattintás. */
  function looksLikeUiChrome(el) {
    return !!(el.closest && el.closest('a[href], button, [role="button"], [role="link"]'));
  }

  function ensureHighlight() {
    if (hlHost && hlHost.isConnected) return;
    hlHost = document.createElement('div');
    hlHost.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483647';
    const sh = hlHost.attachShadow({ mode: 'open' });
    const st = document.createElement('style');
    st.textContent = [
      '.box{position:fixed;pointer-events:none;border:2px solid #3ddc97;',
      'background:rgba(61,220,151,.18);border-radius:4px;',
      'box-shadow:0 0 0 9999px rgba(0,0,0,.15)}',
      '.tip{position:fixed;left:50%;top:14px;transform:translateX(-50%);pointer-events:none;',
      'background:#111;color:#fff;font:13px/1.4 system-ui,sans-serif;padding:8px 14px;',
      'border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.45);white-space:nowrap}'
    ].join('');
    const tip = document.createElement('div');
    tip.className = 'tip';
    tip.textContent = LFT.t('cap_pick_tip');
    hlTip = tip;
    hlBox = document.createElement('div');
    hlBox.className = 'box';
    sh.appendChild(st);
    sh.appendChild(hlBox);
    sh.appendChild(tip);
    (document.body || document.documentElement).appendChild(hlHost);
  }

  function moveHighlight(el) {
    if (!hlBox || !el) return;
    const r = el.getBoundingClientRect();
    hlBox.style.left = r.left + 'px';
    hlBox.style.top = r.top + 'px';
    hlBox.style.width = r.width + 'px';
    hlBox.style.height = r.height + 'px';
  }

  function onPickMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && el !== hlHost) moveHighlight(el);
  }

  async function onPickClick(e) {
    e.preventDefault();
    e.stopPropagation();

    // a célzót bekapcsoló kattintás ne számítson kijelölésnek
    if (Date.now() - pickArmedAt < 300) return;

    if (pointOverOverlay(e.clientX, e.clientY)) {
      disablePicker();
      status(LFT.t('cap_pick_on_overlay'), 'warn');
      return;
    }

    const hit = document.elementFromPoint(e.clientX, e.clientY);
    disablePicker();
    if (!hit) {
      status(LFT.t('cap_pick_nothing'), 'warn');
      return;
    }

    if (looksLikeUiChrome(hit)) {
      status(LFT.t('cap_pick_uichrome'), 'warn');
      return;
    }

    // a lejátszók a legbelső szövegdarabkát mondatonként eldobják — a stabil dobozt keressük
    const el = LFT.selector.pickTarget(hit) || hit;

    const sel = LFT.selector.build(el);
    if (!sel) {
      status(LFT.t('cap_pick_noselector'), 'warn');
      return;
    }

    const sample = LFT.normalizeText(el.innerText || el.textContent || '');
    await LFT.store.setTarget(ORIGIN, sel, LFT.selector.describe(el));
    targetSelector = sel;

    if (!sample) {
      status(LFT.t('cap_pick_notext'), 'warn');
    } else {
      status(LFT.t('cap_picked', [sample.slice(0, 40)]), 'ok');
    }
    send({ type: 'relay:picked', origin: ORIGIN, sample: sample });

    if (running) {
      stop();
      const s = await LFT.store.getSettings();
      start(s.flushDelay);
    }
  }

  function onPickKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      disablePicker();
      status(LFT.t('cap_pick_cancelled'), '');
    }
  }

  function enablePicker() {
    if (pickerOn) return;
    pickerOn = true;
    pickArmedAt = Date.now();
    ensureHighlight();

    /* Ha a lejátszó külön keretben van, a videó fölött nem kapunk egéreseményt —
       a kijelölés "beragad". Szóljunk róla előre, ne a felhasználó találgassa. */
    if (IS_TOP && hlTip && !document.querySelector('video')) {
      const ifr = listIframes();
      if (ifr.list.length) {
        hlTip.textContent = LFT.t('cap_pick_tip_iframe', [ifr.list[0].host]);
      }
    }
    window.addEventListener('mousemove', onPickMove, true);
    window.addEventListener('click', onPickClick, true);
    window.addEventListener('keydown', onPickKey, true);
  }

  function disablePicker() {
    if (!pickerOn) return;
    pickerOn = false;
    window.removeEventListener('mousemove', onPickMove, true);
    window.removeEventListener('click', onPickClick, true);
    window.removeEventListener('keydown', onPickKey, true);
    if (hlHost) { hlHost.remove(); hlHost = null; hlBox = null; }
  }

  /* ---------------- diagnosztika ---------------- */

  /* Mit ad most a videó saját feliratsávja? */
  function activeCueText() {
    for (const v of document.querySelectorAll('video')) {
      const l = v.textTracks || [];
      for (let i = 0; i < l.length; i++) {
        if (l[i].mode === 'disabled') continue;
        const t = readActiveCues(l[i]);
        if (t) return LFT.normalizeText(t).slice(0, 90);
      }
    }
    return '';
  }

  /* Tippet ad arra, melyik elem lehet a felirat, ha a felhasználó még nem célzott. */
  const GUESS_SEL = [
    '[class*="caption" i]', '[class*="subtitle" i]', '[class*="cue" i]',
    '[id*="caption" i]', '[id*="subtitle" i]', '[aria-live]'
  ].join(',');

  function guessCaptionEl() {
    let best = null, bestLen = Infinity;
    let nodes;
    try { nodes = document.querySelectorAll(GUESS_SEL); } catch (e) { return null; }
    for (const cand of nodes) {
      const txt = LFT.normalizeText(cand.innerText || '');
      if (txt.length < 4 || txt.length > 300) continue;
      const r = cand.getBoundingClientRect();
      if (r.width < 40 || r.height < 8) continue;
      if (txt.length < bestLen) { bestLen = txt.length; best = cand; }
    }
    if (!best) return null;
    const target = LFT.selector.pickTarget(best) || best;
    const sel = LFT.selector.build(target);
    if (!sel) return null;
    return { selector: sel, sample: LFT.normalizeText(target.innerText || '').slice(0, 90) };
  }

  /* A beágyazott kereteket a szülő oldal fel tudja sorolni (a src attribútum
     olvasható), még ha a tartalmukba nem is lát bele. Így ki tudjuk írni, melyik
     domaint kell még engedélyezni ahhoz, hogy a lejátszóba is belássunk. */
  function listIframes() {
    const seen = new Set();
    const list = [];
    let unknown = 0;
    for (const f of document.querySelectorAll('iframe')) {
      const raw = f.getAttribute('src') || '';
      let host = '';
      try { host = raw ? new URL(raw, location.href).hostname : ''; } catch (e) { host = ''; }
      if (!host) { unknown++; continue; }
      if (seen.has(host)) continue;
      seen.add(host);
      const r = f.getBoundingClientRect();
      list.push({ host: host, area: Math.round(r.width * r.height) });
    }
    list.sort((a, b) => b.area - a.area);   // a legnagyobb keret a legvalószínűbb lejátszó
    return { list: list, unknown: unknown };
  }

  async function diagnose() {
    const videos = document.querySelectorAll('video').length;
    let tracks = 0, activeTracks = 0;
    for (const v of document.querySelectorAll('video')) {
      const l = v.textTracks || [];
      tracks += l.length;
      for (let i = 0; i < l.length; i++) if (l[i].mode !== 'disabled') activeTracks++;
    }
    const target = await LFT.store.getTarget(ORIGIN);
    let targetFound = false, targetText = '';
    if (target && target.selector) {
      const el = LFT.selector.find(target.selector);
      targetFound = !!el;
      if (el) targetText = LFT.normalizeText(el.innerText || '').slice(0, 60);
    }
    return {
      frame: IS_TOP ? '' : (location.host || 'iframe'),
      origin: ORIGIN,
      videos: videos,
      tracks: tracks,
      activeTracks: activeTracks,
      trackText: activeCueText(),
      hasTarget: !!(target && target.selector),
      targetSelector: (target && target.selector) || '',
      targetFound: targetFound,
      targetText: targetText,
      guess: guessCaptionEl(),
      iframes: IS_TOP ? listIframes() : { list: [], unknown: 0 }
    };
  }

  /* ---------------- üzenetek ---------------- */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'capture:start': start(msg.flushDelay); return;
      case 'capture:stop': stop(); return;
      case 'picker:enable': enablePicker(); return;
      case 'picker:disable': disablePicker(); return;
      case 'capture:diagnose': diagnose().then(sendResponse); return true;
    }
  });

  LFT.capture = {
    start: start,
    stop: stop,
    enablePicker: enablePicker,
    disablePicker: disablePicker,
    diagnose: diagnose,
    isRunning: () => running
  };
})();
