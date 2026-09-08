'use strict';

const $ = id => document.getElementById(id);
let settings = null;
let saveTimer = null;

function patternFor(h) { return '*://*.' + h.toLowerCase() + '/*'; }

function cleanDomain(v) {
  let s = String(v || '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) return null;
  return s;
}

function result(id, text, kind) {
  const e = $(id);
  e.textContent = text || '';
  e.className = 'result' + (kind ? ' ' + kind : '');
}

let pendingPatch = {};

function queueSave(patch) {
  Object.assign(settings, patch);
  Object.assign(pendingPatch, patch);   // gyors egymás utáni állításnál se vesszen el semmi
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const p = pendingPatch;
    pendingPatch = {};
    LFT.store.saveSettings(p);
  }, 250);
}

function pad2(n) { return String(n).padStart(2, '0'); }

function hhmmss(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  return pad2(Math.floor(sec / 3600)) + ':' + pad2(Math.floor(sec / 60) % 60) + ':' + pad2(sec % 60);
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

function duration(ms) {
  if (!ms || ms < 0) return '—';
  const m = Math.round(ms / 60000);
  if (m < 60) return LFT.t('opt_minutes', [String(m)]);
  return LFT.t('opt_hours', [String(Math.floor(m / 60)), String(m % 60)]);
}

/* ---------------- DeepL kulcs ---------------- */

$('keyShow').addEventListener('click', () => {
  const f = $('key');
  const shown = f.type === 'text';
  f.type = shown ? 'password' : 'text';
  $('keyShow').textContent = LFT.t(shown ? 'opt_show' : 'opt_hide');
});

$('key').addEventListener('input', () => {
  queueSave({ deeplKey: $('key').value.trim() });
  result('keyResult', LFT.t('opt_key_saved'), 'info');
});

$('keyTest').addEventListener('click', async () => {
  const key = $('key').value.trim();
  if (!key) { result('keyResult', LFT.t('opt_key_empty'), 'err'); return; }
  await LFT.store.saveSettings({ deeplKey: key });
  result('keyResult', LFT.t('opt_key_checking'), 'info');
  const res = await chrome.runtime.sendMessage({ type: 'deepl:usage', key: key });
  if (res && res.ok) {
    const u = res.usage || {};
    const used = u.character_count || 0;
    const limit = u.character_limit || 0;
    const pct = limit ? Math.round(used / limit * 100) : 0;
    const loc = LFT.i18n.uiLang();
    result('keyResult', LFT.t('opt_key_ok', [
      res.endpoint, used.toLocaleString(loc), limit.toLocaleString(loc), String(pct)
    ]), 'ok');
  } else {
    result('keyResult', (res && res.error) || LFT.t('opt_key_failed'), 'err');
  }
});

/* ---------------- célnyelv ---------------- */

function fillLangs(list, selected) {
  const sel = $('target');
  sel.innerHTML = '';
  list.slice()
    .map(l => ({ code: l.language, label: LFT.deepl.labelFor(l.language, l.name) }))
    .sort((a, b) => a.label.localeCompare(b.label, LFT.i18n.uiLang()))
    .forEach(l => {
      const o = document.createElement('option');
      o.value = l.code;
      o.textContent = l.label;
      sel.appendChild(o);
    });

  /* Ha a mentett célnyelv nincs a listában (pl. a DeepL átnevezte), ne vesszen el. */
  if (selected && !Array.from(sel.options).some(o => o.value === selected)) {
    const o = document.createElement('option');
    o.value = selected;
    o.textContent = LFT.deepl.labelFor(selected, null);
    sel.insertBefore(o, sel.firstChild);
  }
  sel.value = selected || 'HU';
}

async function refreshLangs(quiet) {
  const key = $('key').value.trim();
  if (!key) {
    if (!quiet) result('langResult', LFT.t('opt_lang_needkey'), 'err');
    return;
  }
  if (!quiet) result('langResult', LFT.t('opt_lang_loading'), 'info');
  const res = await chrome.runtime.sendMessage({ type: 'deepl:languages', key: key });
  if (res && res.ok && res.langs && res.langs.length) {
    fillLangs(res.langs, settings.targetLang);
    if (!quiet) result('langResult', LFT.t('opt_lang_count', [String(res.langs.length)]), 'ok');
  } else if (!quiet) {
    result('langResult', (res && res.error) || LFT.t('opt_lang_failed'), 'err');
  }
}

$('target').addEventListener('change', () => {
  queueSave({ targetLang: $('target').value });
  refreshVoices(true);   // a hangok a célnyelvhez igazodnak
  const label = $('target').options[$('target').selectedIndex].textContent;
  result('langResult', LFT.t('opt_lang_changed', [label]), 'ok');
});

$('langRefresh').addEventListener('click', () => refreshLangs(false));

/* ---------------- felolvasás (Google TTS) ---------------- */

$('gkeyShow').addEventListener('click', () => {
  const f = $('gkey');
  const shown = f.type === 'text';
  f.type = shown ? 'password' : 'text';
  $('gkeyShow').textContent = LFT.t(shown ? 'opt_show' : 'opt_hide');
});

$('gkey').addEventListener('input', () => {
  queueSave({ googleKey: $('gkey').value.trim() });
  result('ttsResult', LFT.t('opt_key_saved'), 'info');
});

$('ttsEnabled').addEventListener('change', () => {
  queueSave({ ttsEnabled: $('ttsEnabled').checked });
});

function duckLabel(v) {
  return v <= 0 ? LFT.t('opt_tts_duck_mute') : v + '%';
}

$('duck').addEventListener('input', () => {
  const v = Number($('duck').value);
  $('duckVal').textContent = duckLabel(v);
  queueSave({ ttsDuck: v });
});

$('rate').addEventListener('input', () => {
  const v = Number($('rate').value);
  $('rateVal').textContent = v.toFixed(2).replace(/0$/, '') + '×';
  queueSave({ ttsRate: v });
});

function fillVoices(list, selected) {
  const sel = $('ttsVoice');
  sel.innerHTML = '';
  /* a Chirp3 HD hangok előre, azok szólnak a legtermészetesebben */
  const sorted = list.slice().sort((a, b) => {
    const ca = /Chirp3-HD/i.test(a.name) ? 0 : 1;
    const cb = /Chirp3-HD/i.test(b.name) ? 0 : 1;
    return ca !== cb ? ca - cb : a.name.localeCompare(b.name);
  });
  for (const v of sorted) {
    const o = document.createElement('option');
    o.value = v.name;
    o.textContent = LFT.tts.labelFor(v);
    sel.appendChild(o);
  }
  if (selected && sorted.some(v => v.name === selected)) sel.value = selected;
  else if (sorted.length) sel.value = LFT.tts.pickDefaultVoice(sorted);
  return sel.value || '';
}

async function refreshVoices(quiet) {
  const key = $('gkey').value.trim();
  if (!key) {
    if (!quiet) result('ttsResult', LFT.t('opt_tts_needkey'), 'err');
    return;
  }
  const lang = LFT.tts.voiceLangFor(settings.targetLang);
  if (!quiet) result('ttsResult', LFT.t('opt_tts_loading'), 'info');

  const res = await chrome.runtime.sendMessage({ type: 'tts:voices', key: key, lang: lang });
  if (!res || !res.ok) {
    if (!quiet) result('ttsResult', (res && res.error) || LFT.t('opt_tts_voices_failed'), 'err');
    return;
  }
  const list = res.voices || [];
  if (!list.length) {
    result('ttsResult', LFT.t('opt_tts_no_voices', [lang]), 'err');
    return;
  }
  const chosen = fillVoices(list, settings.targetLang && settings.ttsVoice);
  /* ha a mentett hang nem ehhez a nyelvhez tartozik, az újat el is mentjük */
  if (chosen && chosen !== settings.ttsVoice) queueSave({ ttsVoice: chosen });
  if (!quiet) result('ttsResult', LFT.t('opt_tts_voices_count', [String(list.length), lang]), 'ok');
}

$('voiceRefresh').addEventListener('click', () => refreshVoices(false));

$('ttsVoice').addEventListener('change', () => {
  queueSave({ ttsVoice: $('ttsVoice').value });
  const label = $('ttsVoice').options[$('ttsVoice').selectedIndex].textContent;
  result('ttsResult', LFT.t('opt_tts_voice_changed', [label]), 'ok');
});

$('gkeyTest').addEventListener('click', async () => {
  const key = $('gkey').value.trim();
  if (!key) { result('ttsResult', LFT.t('opt_tts_needkey'), 'err'); return; }
  let voice = $('ttsVoice').value;
  if (!voice) { await refreshVoices(true); voice = $('ttsVoice').value; }
  if (!voice) { result('ttsResult', LFT.t('tts_err_novoice'), 'err'); return; }

  result('ttsResult', LFT.t('opt_tts_testing'), 'info');
  const res = await chrome.runtime.sendMessage({
    type: 'tts:sample', key: key, voice: voice,
    rate: Number($('rate').value), text: LFT.t('opt_tts_sample')
  });
  if (!res || !res.ok || !res.audio) {
    result('ttsResult', (res && res.error) || LFT.t('opt_tts_test_failed'), 'err');
    return;
  }
  try {
    const a = new Audio('data:audio/mp3;base64,' + res.audio);
    await a.play();
    result('ttsResult', LFT.t('opt_tts_test_ok'), 'ok');
  } catch (e) {
    result('ttsResult', LFT.t('opt_tts_test_failed'), 'err');
  }
});

/* ---------------- domainek ---------------- */

async function renderDomains() {
  const ul = $('domainList');
  ul.innerHTML = '';
  if (!settings.domains.length) {
    ul.innerHTML = '<li class="empty"></li>';
    ul.firstChild.textContent = LFT.t('opt_domain_none');
    return;
  }
  for (const d of settings.domains) {
    let granted = false;
    try { granted = await chrome.permissions.contains({ origins: [patternFor(d)] }); } catch (e) {}
    const li = document.createElement('li');
    const box = document.createElement('div');
    box.className = 'grow';
    box.innerHTML = '<b></b><span class="mono"></span>';
    box.querySelector('b').textContent = d;
    box.querySelector('.mono').textContent = granted ? patternFor(d) : LFT.t('opt_domain_nogrant');
    const btn = document.createElement('button');
    btn.className = 'small danger';
    btn.textContent = LFT.t('opt_delete');
    btn.addEventListener('click', () => removeDomain(d));
    li.appendChild(box);
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

async function removeDomain(d) {
  settings.domains = settings.domains.filter(x => x !== d);
  await LFT.store.saveSettings({ domains: settings.domains });
  try { await chrome.permissions.remove({ origins: [patternFor(d)] }); } catch (e) {}
  await chrome.runtime.sendMessage({ type: 'domains:sync' });
  result('domainResult', LFT.t('opt_domain_removed', [d]), 'info');
  renderDomains();
}

$('domainAdd').addEventListener('click', async () => {
  const d = cleanDomain($('domainInput').value);
  if (!d) { result('domainResult', LFT.t('opt_domain_invalid'), 'err'); return; }
  if (settings.domains.includes(d)) { result('domainResult', LFT.t('opt_domain_exists'), 'info'); return; }

  let granted = false;
  try { granted = await chrome.permissions.request({ origins: [patternFor(d)] }); }
  catch (e) { result('domainResult', LFT.t('opt_perm_failed', [e.message]), 'err'); return; }
  if (!granted) { result('domainResult', LFT.t('pop_perm_denied'), 'err'); return; }

  settings.domains.push(d);
  await LFT.store.saveSettings({ domains: settings.domains });
  const r = await chrome.runtime.sendMessage({ type: 'domains:sync' });
  $('domainInput').value = '';
  result('domainResult',
    LFT.t('opt_domain_added', [d]) + ' ' +
    (r && r.injected ? LFT.t('opt_domain_injected', [String(r.injected)]) : LFT.t('opt_domain_reload')),
    'ok');
  renderDomains();
});

$('domainInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); $('domainAdd').click(); }
});

/* ---------------- csúszkák ---------------- */

$('delay').addEventListener('input', () => {
  $('delayVal').textContent = $('delay').value + ' ms';
  queueSave({ flushDelay: +$('delay').value });
});
$('fs').addEventListener('input', () => {
  $('fsVal').textContent = $('fs').value + ' px';
  queueSave({ fontSize: +$('fs').value });
});
$('op').addEventListener('input', () => {
  $('opVal').textContent = $('op').value + '%';
  queueSave({ opacity: +$('op').value });
});
$('bilingual').addEventListener('change', () => {
  queueSave({ bilingual: $('bilingual').checked });
});

/* ---------------- célpontok ---------------- */

async function renderTargets() {
  const ul = $('targetList');
  const targets = await LFT.store.getTargets();
  const keys = Object.keys(targets);
  ul.innerHTML = '';
  if (!keys.length) {
    ul.innerHTML = '<li class="empty"></li>';
    ul.firstChild.textContent = LFT.t('opt_target_none');
    return;
  }
  for (const origin of keys) {
    const t = targets[origin];
    const li = document.createElement('li');
    const box = document.createElement('div');
    box.className = 'grow';
    box.innerHTML = '<b></b><span class="mono"></span>';
    box.querySelector('b').textContent = origin;
    box.querySelector('.mono').textContent = t.selector;
    const btn = document.createElement('button');
    btn.className = 'small danger';
    btn.textContent = LFT.t('opt_rule_delete');
    btn.addEventListener('click', async () => {
      await LFT.store.removeTarget(origin);
      renderTargets();
    });
    li.appendChild(box);
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

/* ---------------- előzmények ---------------- */

function buildTxt(s) {
  const lines = s.lines || [];
  const first = lines.length ? lines[0].t : s.startedAt;
  const out = [];
  const lang = s.targetLang || 'HU';
  out.push(LFT.t('ov_file_header', [lang, s.title || s.origin]));
  out.push(LFT.t('ov_file_source', [s.url]));
  out.push(LFT.t('ov_file_recorded', [clockOf(s.startedAt) + (s.endedAt ? ' – ' + clockOf(s.endedAt) : '')]));
  out.push(LFT.t('ov_file_lines', [String(lines.length)]));
  out.push('');
  for (const l of lines) {
    const time = (l.videoTime != null) ? hhmmss(l.videoTime) : hhmmss((l.t - first) / 1000);
    out.push('[' + time + ']');
    out.push(LFT.t('ov_file_original') + ': ' + l.src);
    out.push(lang + ': ' + (l.hu || LFT.t('ov_no_translation')));
    out.push('');
  }
  return out.join('\r\n');
}

async function downloadSession(id, title, startedAt) {
  const res = await chrome.runtime.sendMessage({ type: 'session:get', id: id });
  const s = res && res.session;
  if (!s) return;
  const d = new Date(startedAt);
  const stamp = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
    '_' + pad2(d.getHours()) + '-' + pad2(d.getMinutes());
  const name = safeFileName(title || s.origin) + '_' + stamp + '.txt';
  const blob = new Blob(['﻿' + buildTxt(s)], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function renderSessions() {
  const tbody = document.querySelector('#sessions tbody');
  const res = await chrome.runtime.sendMessage({ type: 'session:list' });
  const rows = (res && res.sessions) || [];
  tbody.innerHTML = '';

  const bytes = await LFT.store.storageBytes();
  $('storageInfo').textContent = rows.length
    ? LFT.tn('opt_sessions_count', rows.length, [String(rows.length), bytes >= 0 ? (bytes / 1024 / 1024).toFixed(2) : '?'])
    : LFT.t('opt_sessions_none');

  if (!rows.length) {
    tbody.innerHTML = '<tr class="none"><td colspan="5"></td></tr>';
    tbody.querySelector('td').textContent = LFT.t('opt_sessions_empty_row');
    return;
  }

  for (const r of rows) {
    const tr = document.createElement('tr');

    const td1 = document.createElement('td');
    td1.textContent = clockOf(r.startedAt);
    td1.style.whiteSpace = 'nowrap';

    const td2 = document.createElement('td');
    td2.className = 'title';
    td2.textContent = r.title || r.origin;
    td2.title = r.url || '';

    const td3 = document.createElement('td');
    td3.textContent = r.endedAt ? duration(r.endedAt - r.startedAt) : LFT.t('opt_ongoing');

    const td4 = document.createElement('td');
    td4.textContent = r.lineCount || 0;

    const td5 = document.createElement('td');
    td5.className = 'actions';
    const dl = document.createElement('button');
    dl.className = 'small primary';
    dl.textContent = LFT.t('opt_download');
    dl.addEventListener('click', () => downloadSession(r.id, r.title, r.startedAt));
    const del = document.createElement('button');
    del.className = 'small danger';
    del.textContent = LFT.t('opt_delete');
    del.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'session:delete', id: r.id });
      renderSessions();
    });
    td5.appendChild(dl);
    td5.appendChild(del);

    tr.append(td1, td2, td3, td4, td5);
    tbody.appendChild(tr);
  }
}

$('clearAll').addEventListener('click', async () => {
  if (!confirm(LFT.t('opt_confirm_clear'))) return;
  await chrome.runtime.sendMessage({ type: 'session:clear' });
  renderSessions();
});

/* ---------------- indulás ---------------- */

async function init() {
  LFT.i18n.applyDom();
  settings = await LFT.store.getSettings();

  $('key').value = settings.deeplKey || '';
  $('delay').value = settings.flushDelay;
  $('delayVal').textContent = settings.flushDelay + ' ms';
  $('fs').value = settings.fontSize;
  $('fsVal').textContent = settings.fontSize + ' px';
  $('op').value = settings.opacity;
  $('opVal').textContent = settings.opacity + '%';
  $('bilingual').checked = !!settings.bilingual;

  // előbb a gyorsítótárazott (vagy a beépített) lista, hogy azonnal legyen mit választani
  fillLangs((await LFT.store.getLangs()) || LFT.deepl.FALLBACK_TARGETS, settings.targetLang);
  if (settings.deeplKey) refreshLangs(true);   // majd csendben frissítjük a DeepL-től

  $('gkey').value = settings.googleKey || '';
  $('ttsEnabled').checked = !!settings.ttsEnabled;
  $('duck').value = settings.ttsDuck == null ? 20 : settings.ttsDuck;
  $('duckVal').textContent = duckLabel(Number($('duck').value));
  $('rate').value = settings.ttsRate || 1;
  $('rateVal').textContent = Number(settings.ttsRate || 1).toFixed(2).replace(/0$/, '') + '×';
  if (settings.ttsVoice) {
    fillVoices([{ name: settings.ttsVoice, ssmlGender: '' }], settings.ttsVoice);
  }
  if (settings.googleKey) refreshVoices(true);

  await renderDomains();
  await renderTargets();
  await renderSessions();
}

init();
