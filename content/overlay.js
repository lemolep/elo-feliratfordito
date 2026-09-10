/* A lebegő fordítóablak. Csak a legfelső frame-ben fut.
   Shadow DOM-ban él, így az oldal CSS-e nem tudja elrontani (és fordítva sem). */
globalThis.LFT = globalThis.LFT || {};

(() => {
  'use strict';
  if (window.top !== window) return;
  if (window.__lftOverlayLoaded) return;
  window.__lftOverlayLoaded = true;

  const ORIGIN = location.origin;

  let settings = null;
  let ui = null;
  let host = null, shadow = null, panel = null;
  const el = {};

  let lines = [];
  const nodes = new Map();
  let seq = 0;

  let recording = false;
  let sessionId = null;
  let dirty = false;
  let saveTimer = null;
  let uiTimer = null;
  let stuckToBottom = true;
  let picking = false;

  /* felolvasás */
  let ttsOn = false;
  let ttsPending = [];        // még ki nem mondott szövegdarabok
  let ttsNext = null;         // előre legyártott következő hang
  let ttsMergeTimer = null;
  let ttsPumping = false;
  let ttsAudio = null;        // épp szóló hang
  let ttsGate = Promise.resolve();   // a sorba állítás sorrendjét őrzi
  const TTS_MAX_PENDING = 15; // ennél többnél a legrégebbit dobjuk
  const TTS_MAX_CHARS = 600;  // egy hangba ennél több szöveget nem fűzünk
  const TTS_MERGE_MS = 400;   // ennyit adunk a szomszédos daraboknak, hogy összeérjenek

  /* ---------------- segédek ---------------- */

  async function bg(msg) {
    for (let i = 0; i < 3; i++) {
      try { return await chrome.runtime.sendMessage(msg); }
      catch (e) { await new Promise(r => setTimeout(r, 150)); }
    }
    return null;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function hhmmss(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    return pad2(Math.floor(sec / 3600)) + ':' + pad2(Math.floor(sec / 60) % 60) + ':' + pad2(sec % 60);
  }

  function stamp(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      '_' + pad2(d.getHours()) + '-' + pad2(d.getMinutes());
  }

  function clockOf(ms) {
    const d = new Date(ms);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function safeFileName(s) {
    return String(s || LFT.t('ov_default_filename'))
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, '_')
      .trim()
      .slice(0, 80) || LFT.t('ov_default_filename');
  }

  function targetLang() {
    return (settings && settings.targetLang) || 'HU';
  }

  /* A fejlécben mindig látszik, mire fordít éppen. */
  function applyTargetLang() {
    const ttl = panel && panel.querySelector('.ttl');
    if (ttl) ttl.textContent = '→ ' + targetLang();
  }

  /* ---------------- felépítés ---------------- */

  function build() {
    host = document.createElement('div');
    host.id = 'lft-overlay-host';
    shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = LFT.overlayCSS;

    panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = [
      '<div class="hdr" data-drag>',
        '<span class="dot"></span>',
        '<span class="ttl" data-i18n-title="ov_tip_title">→ …</span>',
        '<span class="spacer"></span>',
        '<button class="primary" data-a="rec"></button>',
        '<button data-a="lang" data-i18n-title="ov_tip_lang"></button>',
        '<button class="icon" data-a="fsdown" data-i18n-title="ov_tip_fsdown">A−</button>',
        '<button class="icon" data-a="fsup" data-i18n-title="ov_tip_fsup">A+</button>',
        '<input type="range" data-a="op" min="30" max="100" step="5" data-i18n-title="ov_tip_opacity">',
        '<button class="icon" data-a="pick" data-i18n-title="ov_tip_pick">◎</button>',
        '<button class="icon" data-a="tts">🔊</button>',
        '<button data-a="save" data-i18n="ov_save" data-i18n-title="ov_tip_save"></button>',
        '<button class="icon" data-a="opts" data-i18n-title="ov_tip_opts">⚙</button>',
        '<button class="icon" data-a="close" data-i18n-title="ov_tip_close">✕</button>',
      '</div>',
      '<div class="body"><div class="lines"></div></div>',
      '<button class="jump" data-a="jump" data-i18n="ov_jump"></button>',
      '<div class="bar"><span class="msg"></span><span class="cnt"></span></div>',
      '<div class="grip" data-resize></div>',
      '<div class="dlg" hidden>',
        '<h3 data-i18n="ov_dlg_title"></h3>',
        '<p data-i18n="ov_dlg_hint"></p>',
        '<input type="text" data-a="fname">',
        '<div class="row">',
          '<button data-a="dlgcancel" data-i18n="ov_cancel"></button>',
          '<button class="primary" data-a="dlgsave" data-i18n="ov_save"></button>',
        '</div>',
      '</div>'
    ].join('');

    shadow.appendChild(style);
    shadow.appendChild(panel);
    LFT.i18n.applyDom(panel);
    document.documentElement.appendChild(host);

    el.dot = panel.querySelector('.dot');
    el.body = panel.querySelector('.body');
    el.lines = panel.querySelector('.lines');
    el.msg = panel.querySelector('.msg');
    el.cnt = panel.querySelector('.cnt');
    el.rec = panel.querySelector('[data-a=rec]');
    el.lang = panel.querySelector('[data-a=lang]');
    el.op = panel.querySelector('[data-a=op]');
    el.tts = panel.querySelector('[data-a=tts]');
    el.dlg = panel.querySelector('.dlg');
    el.fname = panel.querySelector('[data-a=fname]');

    panel.addEventListener('click', onClick);
    el.op.addEventListener('input', () => setOpacity(+el.op.value, true));
    el.body.addEventListener('scroll', onScroll);
    panel.querySelector('[data-drag]').addEventListener('pointerdown', onDragStart);
    panel.querySelector('[data-resize]').addEventListener('pointerdown', onResizeStart);
    el.fname.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); doDownload(); }
      if (e.key === 'Escape') { e.preventDefault(); closeDialog(); }
    });
    window.addEventListener('resize', clampToViewport);
  }

  /* ---------------- megjelenés ---------------- */

  function applyGeometry() {
    const w = Math.max(220, ui.width || 480);
    const h = Math.max(120, ui.height || 300);
    let left = ui.left, top = ui.top;
    if (left == null) left = Math.max(12, window.innerWidth - w - 24);
    if (top == null) top = Math.max(12, window.innerHeight - h - 110);
    host.style.width = w + 'px';
    host.style.height = h + 'px';
    host.style.left = left + 'px';
    host.style.top = top + 'px';
  }

  function clampToViewport() {
    const w = host.offsetWidth, h = host.offsetHeight;
    const left = Math.min(Math.max(0, parseInt(host.style.left, 10) || 0), Math.max(0, window.innerWidth - 80));
    const top = Math.min(Math.max(0, parseInt(host.style.top, 10) || 0), Math.max(0, window.innerHeight - 40));
    host.style.left = left + 'px';
    host.style.top = top + 'px';
    if (w > window.innerWidth) host.style.width = window.innerWidth - 24 + 'px';
    if (h > window.innerHeight) host.style.height = window.innerHeight - 24 + 'px';
  }

  function setFontSize(px, persist) {
    px = Math.max(12, Math.min(48, px));
    ui.fontSize = px;
    panel.style.setProperty('--fs', px + 'px');
    if (persist) queueUiSave();
  }

  function setOpacity(pct, persist) {
    pct = Math.max(30, Math.min(100, pct));
    ui.opacity = pct;
    el.op.value = pct;
    panel.style.setProperty('--bgA', (pct / 100).toFixed(2));
    if (persist) queueUiSave();
  }

  function setBilingual(on, persist) {
    ui.bilingual = !!on;
    panel.classList.toggle('huonly', !on);
    el.lang.textContent = LFT.t(on ? 'ov_bilingual' : 'ov_mono');
    if (persist) queueUiSave();
  }

  /* ---------------- felolvasás ---------------- */

  function setTts(on, persist) {
    ttsOn = !!on;
    el.tts.textContent = ttsOn ? '🔊' : '🔇';
    el.tts.classList.toggle('on', ttsOn);
    el.tts.title = LFT.t(ttsOn ? 'ov_tip_tts_on' : 'ov_tip_tts_off');
    if (!ttsOn) ttsStop();
    if (persist) {
      settings.ttsEnabled = ttsOn;
      LFT.store.saveSettings({ ttsEnabled: ttsOn });
      if (ttsOn && !settings.googleKey) setStatus(LFT.t('ov_tts_nokey'), 'warn');
    }
  }

  function ttsStop() {
    bg({ type: 'relay:frames', payload: { type: 'audio:unduck' } });
    clearTimeout(ttsMergeTimer);
    ttsMergeTimer = null;
    ttsPending = [];
    ttsNext = null;
    if (ttsAudio) {
      try { ttsAudio.pause(); } catch (e) { /* már leállt */ }
      ttsAudio = null;
    }
  }

  /* A felirat sok rövid darabban érkezik. Ha mindegyik külön hangfájl lenne, a
     fájlok közötti rés és a darabonkénti lezáró hanglejtés miatt szaggatottan
     szólna. Ezért NEM várunk szövegre: az elsőt azonnal kimondjuk, és ami közben
     gyűlik össze — vagyis ami úgyis sorban állna, amíg szól a hang —, azt egyetlen
     hanggá vonjuk össze. Így nő a darabok hossza anélkül, hogy késleltetnénk. */
  function ttsEnqueue(text) {
    if (!ttsOn || !text) return;
    ttsPending.push(String(text).trim());
    if (ttsPending.length > TTS_MAX_PENDING) {
      ttsPending.splice(0, ttsPending.length - TTS_MAX_PENDING);
    }

    if (!ttsPumping) {
      ttsPump();                       // nem szól semmi: azonnal, várakozás nélkül
      return;
    }
    /* Szól egy hang. A következőt előre legyártjuk, de adunk neki egy rövid
       ablakot, hogy a közben érkező darabok is beleférjenek. */
    if (!ttsNext && !ttsMergeTimer) {
      ttsMergeTimer = setTimeout(() => {
        ttsMergeTimer = null;
        if (!ttsNext) ttsNext = ttsTakeNext();
      }, TTS_MERGE_MS);
    }
  }

  /* Kivesz annyi várakozó darabot, amennyi belefér egy hangba, és elindítja a
     szintézist. A darabokat szóközzel fűzi össze, így a TTS egy összefüggő
     szövegként mondja ki őket, nem külön mondatokként. */
  function ttsTakeNext() {
    if (!ttsPending.length) return null;
    let text = '';
    while (ttsPending.length) {
      const next = ttsPending[0];
      if (text && text.length + next.length + 1 > TTS_MAX_CHARS) break;
      text += (text ? ' ' : '') + ttsPending.shift();
    }
    if (!text) return null;
    return { audio: bg({ type: 'tts', text: text }), text: text };
  }

  async function ttsPump() {
    if (ttsPumping) return;
    ttsPumping = true;
    let duckedNow = false;
    try {
      while (ttsOn) {
        clearTimeout(ttsMergeTimer);
        ttsMergeTimer = null;

        const item = ttsNext || ttsTakeNext();
        ttsNext = null;
        if (!item) break;

        let res = null;
        try { res = await item.audio; } catch (e) { res = null; }
        if (!ttsOn) break;
        if (!res || res.skip) continue;
        if (!res.audio) {
          if (res.error) setStatus(res.error, 'warn');
          continue;
        }

        /* Csak akkor halkítjuk le az eredeti hangot, amikor tényleg megszólalunk —
           és a hangok között NEM állítjuk vissza, csak amikor elfogyott a sor.
           A videó lehet másik keretben, ezért üzenetben megy. */
        if (!duckedNow) {
          duckedNow = true;
          bg({ type: 'relay:frames',
               payload: { type: 'audio:duck', level: settings && settings.ttsDuck } });
        }
        await ttsPlay(res.audio);
      }
    } finally {
      ttsPumping = false;
      if (duckedNow) bg({ type: 'relay:frames', payload: { type: 'audio:unduck' } });
    }
  }

  function ttsPlay(b64) {
    return new Promise(resolve => {
      let done = false;
      const finish = () => { if (!done) { done = true; ttsAudio = null; resolve(); } };
      try {
        const a = new Audio('data:audio/mp3;base64,' + b64);
        ttsAudio = a;
        a.onended = finish;
        a.onerror = finish;
        a.play().catch(() => {
          /* a böngésző autoplay-tiltása — a Start gomb megnyomása után ez ritka */
          setStatus(LFT.t('ov_tts_blocked'), 'warn');
          finish();
        });
      } catch (e) { finish(); }
    });
  }

  function setVisible(on, persist) {
    ui.visible = !!on;
    host.style.display = on ? '' : 'none';
    if (persist) queueUiSave();
  }

  function queueUiSave() {
    clearTimeout(uiTimer);
    uiTimer = setTimeout(() => {
      LFT.store.setUi(ORIGIN, {
        left: parseInt(host.style.left, 10),
        top: parseInt(host.style.top, 10),
        width: host.offsetWidth,
        height: host.offsetHeight,
        fontSize: ui.fontSize,
        opacity: ui.opacity,
        bilingual: ui.bilingual,
        visible: ui.visible
      });
    }, 300);
  }

  function setStatus(text, kind) {
    if (picking) endPicking();
    el.msg.textContent = text || '';
    el.msg.className = 'msg' + (kind ? ' ' + kind : '');
  }

  function setRecUi(on) {
    recording = on;
    el.dot.className = 'dot' + (on ? ' rec' : '');
    el.rec.textContent = LFT.t(on ? 'ov_stop' : 'ov_start');
    el.rec.className = on ? 'danger' : 'primary';
  }

  function updateCount() {
    el.cnt.textContent = lines.length ? LFT.tn('ov_lines', lines.length, [String(lines.length)]) : '';
  }

  /* ---------------- sorok ---------------- */

  function showEmptyHint(text) {
    el.lines.innerHTML = '';
    nodes.clear();
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = text;
    el.lines.appendChild(d);
  }

  function renderLine(line) {
    const hint = el.lines.querySelector('.empty');
    if (hint) hint.remove();

    const root = document.createElement('div');
    root.className = 'ln';
    const src = document.createElement('div');
    src.className = 'src';
    src.textContent = line.src;
    const hu = document.createElement('div');
    hu.className = 'hu waiting';
    hu.textContent = LFT.t('ov_translating');
    root.appendChild(src);
    root.appendChild(hu);
    el.lines.appendChild(root);
    nodes.set(line.id, { root: root, src: src, hu: hu });
    scrollIfStuck();
  }

  function updateLine(line) {
    const n = nodes.get(line.id);
    if (!n) return;
    if (line.hu) {
      n.hu.className = 'hu';
      n.hu.textContent = line.hu;
    } else if (line.err) {
      n.hu.className = 'hu failed';
      n.hu.textContent = LFT.t('ov_no_translation');
    }
    scrollIfStuck();
  }

  function onScroll() {
    const d = el.body;
    stuckToBottom = (d.scrollHeight - d.scrollTop - d.clientHeight) < 48;
    panel.classList.toggle('unstuck', !stuckToBottom);
  }

  function scrollIfStuck() {
    if (!stuckToBottom) return;
    el.body.scrollTop = el.body.scrollHeight;
  }

  function jumpToEnd() {
    stuckToBottom = true;
    panel.classList.remove('unstuck');
    el.body.scrollTop = el.body.scrollHeight;
  }

  /* ---------------- felirat érkezik ---------------- */

  async function onSegment(payload) {
    if (!recording) return;

    const prevGate = ttsGate;
    let openGate;
    ttsGate = new Promise(r => { openGate = r; });
    const line = {
      id: ++seq,
      t: payload.t || Date.now(),
      videoTime: payload.videoTime,
      src: payload.text,
      hu: null,
      err: null
    };
    lines.push(line);
    renderLine(line);
    updateCount();
    markDirty();

    el.dot.classList.add('busy');
    const res = await bg({ type: 'translate', text: line.src });
    el.dot.classList.remove('busy');

    if (res && res.hu) {
      line.hu = res.hu;
      if (el.msg.classList.contains('err')) setStatus('', '');
    } else {
      line.err = (res && res.error) || LFT.t('ov_err_unknown');
      setStatus(line.err, 'err');
    }
    updateLine(line);
    markDirty();

    /* A fordítások nem feltétlenül ugyanabban a sorrendben készülnek el, ahogy
       a mondatok elhangzottak. Ez a kapu biztosítja, hogy a felolvasás sorrendje
       a felirat sorrendje legyen. */
    try {
      await prevGate;
      if (line.hu) ttsEnqueue(line.hu);
    } finally {
      openGate();
    }
  }

  function markDirty() {
    dirty = true;
    if (saveTimer) return;
    saveTimer = setTimeout(flushSave, 3000);
  }

  async function flushSave(endedAt) {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!sessionId || (!dirty && !endedAt)) return;
    dirty = false;
    await bg({
      type: 'session:save',
      id: sessionId,
      endedAt: endedAt || null,
      lines: lines.map(l => ({ t: l.t, videoTime: l.videoTime, src: l.src, hu: l.hu || '' }))
    });
  }

  /* ---------------- rögzítés ---------------- */

  async function startRec() {
    settings = await LFT.store.getSettings();
    applyTargetLang();
    if (!settings.deeplKey) {
      setStatus(LFT.t('ov_warn_nokey'), 'warn');
    } else {
      setStatus(LFT.t('ov_starting'), '');
    }

    lines = [];
    nodes.clear();
    seq = 0;
    el.lines.innerHTML = '';
    updateCount();
    jumpToEnd();

    const res = await bg({
      type: 'session:start',
      origin: ORIGIN,
      url: location.href,
      title: document.title,
      targetLang: targetLang()
    });
    sessionId = res && res.id ? res.id : null;

    setRecUi(true);
    await bg({ type: 'relay:frames', payload: { type: 'capture:start', flushDelay: settings.flushDelay } });
  }

  /* Magától indulás: a felirat megvan, a kulcs megvan, és a felhasználó nem
     tiltotta le. Csak egyszer sül el egy oldalbetöltésen belül. */
  let autoStarted = false;
  async function autoStart() {
    if (autoStarted || recording) return;
    const s = settings || await LFT.store.getSettings();   // jöhet az init előtt is
    if (!s || s.autoStart === false) return;
    if (!s.deeplKey) return;          // kulcs nélkül nincs mit fordítani
    autoStarted = true;
    setVisible(true, true);
    await startRec();
    setStatus(LFT.t('ov_auto_started'), 'ok');   // a startRec saját üzenete után
  }

  async function stopRec(openDialog) {
    setRecUi(false);
    ttsStop();
    await bg({ type: 'relay:frames', payload: { type: 'capture:stop' } });
    await flushSave(Date.now());
    setStatus(lines.length ? LFT.tn('ov_stopped_lines', lines.length, [String(lines.length)]) : LFT.t('ov_stopped'), 'ok');
    if (openDialog !== false && lines.length) openSaveDialog();
  }

  /* ---------------- mentés fájlba ---------------- */

  function buildTxt() {
    const first = lines.length ? lines[0].t : Date.now();
    const out = [];
    out.push(LFT.t('ov_file_header', [targetLang(), document.title || location.host]));
    out.push(LFT.t('ov_file_source', [location.href]));
    out.push(LFT.t('ov_file_recorded', [clockOf(first) + (lines.length ? ' – ' + clockOf(lines[lines.length - 1].t) : '')]));
    out.push(LFT.t('ov_file_lines', [String(lines.length)]));
    out.push('');
    for (const l of lines) {
      const time = (l.videoTime != null) ? hhmmss(l.videoTime) : hhmmss((l.t - first) / 1000);
      out.push('[' + time + ']');
      out.push(LFT.t('ov_file_original') + ': ' + l.src);
      out.push(targetLang() + ': ' + (l.hu || LFT.t('ov_no_translation')));
      out.push('');
    }
    return out.join('\r\n');
  }

  function openSaveDialog() {
    if (!lines.length) { setStatus(LFT.t('ov_nothing_to_save'), 'warn'); return; }
    el.fname.value = safeFileName(document.title || location.host) + '_' + stamp() + '.txt';
    el.dlg.hidden = false;
    el.fname.focus();
    el.fname.select();
  }

  function closeDialog() { el.dlg.hidden = true; }

  function doDownload() {
    let name = safeFileName(el.fname.value.replace(/\.txt$/i, ''));
    name = name + '.txt';
    const blob = new Blob(['﻿' + buildTxt()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.documentElement.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
    closeDialog();
    setStatus(LFT.t('ov_saved', [name]), 'ok');
  }

  /* ---------------- célzó ---------------- */

  async function startPicking() {
    picking = true;
    panel.classList.add('picking');
    host.style.pointerEvents = 'none';
    el.msg.textContent = LFT.t('ov_pick_active');
    el.msg.className = 'msg warn';
    await bg({ type: 'relay:frames', payload: { type: 'picker:enable' } });
  }

  function endPicking() {
    picking = false;
    panel.classList.remove('picking');
    host.style.pointerEvents = '';
  }

  /* ---------------- egér: húzás és átméretezés ---------------- */

  function onDragStart(e) {
    if (e.target.closest('button, input')) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const ox = parseInt(host.style.left, 10) || 0;
    const oy = parseInt(host.style.top, 10) || 0;
    const move = ev => {
      host.style.left = Math.max(0, Math.min(window.innerWidth - 60, ox + ev.clientX - sx)) + 'px';
      host.style.top = Math.max(0, Math.min(window.innerHeight - 30, oy + ev.clientY - sy)) + 'px';
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      queueUiSave();
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
  }

  function onResizeStart(e) {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY;
    const ow = host.offsetWidth, oh = host.offsetHeight;
    const move = ev => {
      host.style.width = Math.max(220, ow + ev.clientX - sx) + 'px';
      host.style.height = Math.max(120, oh + ev.clientY - sy) + 'px';
      scrollIfStuck();
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      queueUiSave();
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
  }

  /* ---------------- gombok ---------------- */

  function onClick(e) {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    switch (b.dataset.a) {
      case 'rec': recording ? stopRec() : startRec(); break;
      case 'lang': setBilingual(!ui.bilingual, true); break;
      case 'fsup': setFontSize((ui.fontSize || 20) + 2, true); break;
      case 'fsdown': setFontSize((ui.fontSize || 20) - 2, true); break;
      case 'pick': startPicking(); break;
      case 'tts': setTts(!ttsOn, true); break;
      case 'save': openSaveDialog(); break;
      case 'opts': bg({ type: 'openOptions' }); break;
      case 'close': setVisible(false, true); break;
      case 'jump': jumpToEnd(); break;
      case 'dlgsave': doDownload(); break;
      case 'dlgcancel': closeDialog(); break;
    }
  }

  /* ---------------- üzenetek ---------------- */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'segment': onSegment(msg.seg); return;
      case 'status': setStatus(msg.text, msg.kind); return;
      case 'picked': endPicking(); return;
      case 'sourcefound': autoStart(); return;
      case 'overlay:toggle': setVisible(!ui.visible, true); return;
      case 'overlay:show': setVisible(true, true); return;
      case 'overlay:toggleCapture':
        setVisible(true, true);
        recording ? stopRec() : startRec();
        return;
      case 'overlay:pick': setVisible(true, true); startPicking(); return;
      case 'overlay:save': openSaveDialog(); return;
      case 'overlay:state':
        sendResponse({ ok: true, recording: recording, visible: !!ui.visible, lines: lines.length });
        return true;
    }
  });

  window.addEventListener('beforeunload', () => {
    if (dirty && sessionId) {
      // utolsó mentési kísérlet — nem várunk a válaszra
      chrome.runtime.sendMessage({
        type: 'session:save',
        id: sessionId,
        endedAt: Date.now(),
        lines: lines.map(l => ({ t: l.t, videoTime: l.videoTime, src: l.src, hu: l.hu || '' }))
      }).catch(() => {});
    }
  });

  /* Ha a bővítményt újratöltötték vagy kikapcsolták, ez az ablak árván marad:
     a gombjai már nem érnek el semmit. Szólunk róla, és leállítunk mindent,
     hogy ne járjanak tovább az időzítők és ne szemeteljen a konzol. */
  function startAliveWatch() {
    const t = setInterval(() => {
      if (LFT.alive()) return;
      clearInterval(t);
      clearTimeout(saveTimer); saveTimer = null;
      clearTimeout(uiTimer); uiTimer = null;
      recording = false;
      setRecUi(false);
      ttsStop();
      panel.classList.add('stale');
      el.msg.textContent = LFT.t('ov_stale');
      el.msg.className = 'msg warn';
    }, 2000);
  }

  /* Ha a beállítások oldalon célnyelvet váltanak, az ablak azonnal kövesse. */
  function watchSettings() {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.settings) return;
        settings = Object.assign({}, settings, changes.settings.newValue || {});
        applyTargetLang();
        if (!!settings.ttsEnabled !== ttsOn) setTts(settings.ttsEnabled, false);
      });
    } catch (e) { /* érvénytelen kontextus */ }
  }

  /* ---------------- indulás ---------------- */

  async function init() {
    settings = await LFT.store.getSettings();
    ui = await LFT.store.getUi(ORIGIN);
    if (ui.fontSize == null) ui.fontSize = settings.fontSize;
    if (ui.opacity == null) ui.opacity = settings.opacity;
    if (ui.bilingual == null) ui.bilingual = settings.bilingual;

    build();
    applyGeometry();
    setFontSize(ui.fontSize, false);
    setOpacity(ui.opacity, false);
    setBilingual(ui.bilingual, false);
    setVisible(ui.visible !== false, false);
    setRecUi(false);
    setTts(settings.ttsEnabled, false);
    applyTargetLang();
    updateCount();

    const target = await LFT.store.getTarget(ORIGIN);
    if (!settings.deeplKey) {
      showEmptyHint(LFT.t('ov_hint_nokey'));
    } else if (target) {
      showEmptyHint(LFT.t('ov_hint_ready'));
    } else {
      showEmptyHint(LFT.t('ov_hint_start'));
    }

    startAliveWatch();
    watchSettings();

    LFT.overlay = {
      onSegment: onSegment,
      setStatus: setStatus,
      show: () => setVisible(true, true),
      autoStart: autoStart
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
