'use strict';

const $ = id => document.getElementById(id);
let tab = null;
let host = '';
let injected = false;

function patternFor(h) { return '*://*.' + h.toLowerCase() + '/*'; }

async function send(type, extra) {
  if (!tab) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, Object.assign({ type: type }, extra || {}), { frameId: 0 });
  } catch (e) {
    return null;
  }
}

function setControls(on) {
  ['rec', 'show', 'pick', 'save', 'diag'].forEach(id => { $(id).disabled = !on; });
}

function note(text) {
  if (!text) { $('note').classList.add('hidden'); return; }
  $('note').textContent = text;
  $('note').classList.remove('hidden');
}

async function refresh() {
  const state = await send('overlay:state');
  injected = !!(state && state.ok);

  if (!injected) {
    $('dot').className = 'dot off';
    $('stateText').textContent = LFT.t('pop_state_notrunning');
    $('enable').hidden = !host;
    setControls(false);
    return;
  }

  $('enable').hidden = true;
  setControls(true);
  $('dot').className = 'dot ' + (state.recording ? 'on' : '');
  $('stateText').textContent = state.recording
    ? LFT.tn('pop_state_recording', state.lines, [String(state.lines)])
    : (state.lines ? LFT.tn('pop_state_stopped', state.lines, [String(state.lines)]) : LFT.t('pop_state_ready'));
  $('rec').textContent = LFT.t(state.recording ? 'pop_rec_stop' : 'pop_rec_start');
  $('rec').className = state.recording ? 'danger' : 'primary';
  $('save').disabled = !state.lines;
}

async function init() {
  LFT.i18n.applyDom();
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url && /^https?:/i.test(tab.url)) {
    try { host = new URL(tab.url).hostname; } catch (e) { host = ''; }
  }
  $('host').textContent = host || LFT.t('pop_bad_page');

  const settings = await LFT.store.getSettings();
  if (!settings.deeplKey) {
    note(LFT.t('pop_note_nokey'));
  }

  await refresh();
}

$('enable').addEventListener('click', async () => {
  if (!host) return;
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [patternFor(host)] });
  } catch (e) {
    note(LFT.t('pop_perm_failed', [host]));
    return;
  }
  if (!granted) { note(LFT.t('pop_perm_denied')); return; }

  const s = await LFT.store.getSettings();
  if (!s.domains.includes(host)) {
    s.domains.push(host);
    await LFT.store.saveSettings({ domains: s.domains });
  }
  await chrome.runtime.sendMessage({ type: 'domains:sync' });
  await new Promise(r => setTimeout(r, 300));
  await refresh();
  if (!injected) note(LFT.t('pop_enabled_reload'));
});

$('rec').addEventListener('click', async () => {
  await send('overlay:toggleCapture');
  setTimeout(refresh, 350);
});
$('show').addEventListener('click', async () => { await send('overlay:show'); window.close(); });
$('pick').addEventListener('click', async () => { await send('overlay:pick'); window.close(); });
$('save').addEventListener('click', async () => { await send('overlay:save'); window.close(); });
/* ---------------- diagnosztika ---------------- */

function frameCard(f) {
  const div = document.createElement('div');
  div.className = 'frame';

  const h = document.createElement('h3');
  h.textContent = f.frame || LFT.t('pop_frame_main');
  div.appendChild(h);

  const stats = document.createElement('div');
  stats.className = 'k';
  stats.textContent = LFT.t('pop_frame_stats', [String(f.videos), String(f.tracks), String(f.activeTracks)]);
  div.appendChild(stats);

  const line = (cls, text) => {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = text;
    div.appendChild(d);
    return d;
  };
  const sample = text => {
    const s = document.createElement('span');
    s.className = 'sample';
    s.textContent = text;
    div.appendChild(s);
  };

  if (f.trackText) {
    line('good', LFT.t('pop_track_ok'));
    sample(f.trackText);
  }

  if (f.hasTarget) {
    if (f.targetFound && f.targetText) {
      line('good', LFT.t('pop_target_ok'));
      sample(f.targetText);
    } else if (f.targetFound) {
      line('bad', LFT.t('pop_target_empty'));
    } else {
      line('bad', LFT.t('pop_target_missing'));
    }
    line('k', LFT.t('pop_target_rule', [f.targetSelector]));
    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = LFT.t('pop_rule_delete');
    del.addEventListener('click', async () => {
      await LFT.store.removeTarget(f.origin);
      del.textContent = LFT.t('pop_rule_deleted');
      del.disabled = true;
    });
    div.appendChild(del);
  }

  if (f.guess) {
    line('good', LFT.t('pop_guess_found'));
    sample(f.guess.sample);
    const b = document.createElement('button');
    b.className = 'primary';
    b.textContent = LFT.t('pop_guess_set');
    b.addEventListener('click', async () => {
      await LFT.store.setTarget(f.origin, f.guess.selector, 'diagnosztika');
      b.textContent = LFT.t('pop_guess_done');
      b.disabled = true;
    });
    div.appendChild(b);
  }

  if (!f.trackText && !f.guess && !f.hasTarget) {
    if (!f.videos) {
      line('bad', LFT.t('pop_no_video'));
    } else {
      line('bad', LFT.t('pop_no_text'));
    }
  }

  const ifr = f.iframes || { list: [], unknown: 0 };
  if (ifr.list.length) {
    line('bad', LFT.t('pop_iframes_intro'));
    ifr.list.forEach(it => {
      const b = document.createElement('button');
      b.className = 'primary';
      b.textContent = LFT.t('pop_iframe_allow', [it.host]);
      b.addEventListener('click', () => enableDomain(it.host, b));
      div.appendChild(b);
    });
  }
  if (ifr.unknown) {
    line('k', LFT.t('pop_iframes_unknown', [String(ifr.unknown)]));
  }

  return div;
}

/* Domain engedélyezése a diagnosztikából. A permissions.request csak
   felhasználói kattintásból hívható — ezért van itt, a gomb kezelőjében. */
async function enableDomain(h, btn) {
  btn.disabled = true;
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [patternFor(h)] });
  } catch (e) {
    btn.textContent = LFT.t('pop_iframe_failed', [e.message]);
    return;
  }
  if (!granted) {
    btn.disabled = false;
    btn.textContent = LFT.t('pop_iframe_denied', [h]);
    return;
  }
  const s = await LFT.store.getSettings();
  if (!s.domains.includes(h)) {
    s.domains.push(h);
    await LFT.store.saveSettings({ domains: s.domains });
  }
  await chrome.runtime.sendMessage({ type: 'domains:sync' });
  btn.textContent = LFT.t('pop_iframe_allowed', [h]);
}

$('diag').addEventListener('click', async () => {
  const box = $('report');
  box.textContent = LFT.t('pop_diag_running');
  const res = await chrome.runtime.sendMessage({ type: 'diagnose', tabId: tab.id });
  box.textContent = '';
  if (!res || !res.ok) {
    note((res && res.error) || LFT.t('pop_diag_failed'));
    return;
  }
  if (!res.frames.length) {
    note(LFT.t('pop_diag_noframes'));
    return;
  }
  res.frames.forEach(f => box.appendChild(frameCard(f)));
});

$('opts').addEventListener('click', () => { chrome.runtime.openOptionsPage(); window.close(); });

init();
