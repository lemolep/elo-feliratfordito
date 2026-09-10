'use strict';

const $ = id => document.getElementById(id);
let settings = null;
let saveTimer = null;

/* A "*" minden oldalt jelent — egyetlen engedélykérés az összes helyett. */
function patternFor(h) { return h === '*' ? '*://*/*' : '*://*.' + h.toLowerCase() + '/*'; }

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

/* ---------------- szakszótár ---------------- */

$('glossary').addEventListener('input', () => {
  queueSave({ glossary: $('glossary').value });
  result('glossResult', LFT.t('opt_gloss_saved'), 'info');
});

$('glossCheck').addEventListener('click', async () => {
  await LFT.store.saveSettings({ glossary: $('glossary').value });
  const res = await chrome.runtime.sendMessage({ type: 'deepl:glossary', force: true });
  if (!res || !res.ok) {
    result('glossResult', (res && res.error) || LFT.t('opt_gloss_failed', ['?']), 'err');
    return;
  }
  if (!res.entries) { result('glossResult', LFT.t('opt_gloss_empty'), 'info'); return; }

  const parts = [LFT.t('opt_gloss_count', [String(res.entries)])];
  if (res.bad && res.bad.length) parts.push(LFT.t('opt_gloss_bad', [res.bad.join(', ')]));
  if (res.uploaded) parts.push(LFT.t('opt_gloss_uploaded', [res.pair]));
  else if (res.error) parts.push(LFT.t('opt_gloss_failed', [res.error]));
  else if (!res.detected) parts.push(LFT.t('opt_gloss_waiting'));

  const kind = (res.bad && res.bad.length) || res.error ? 'err' : 'ok';
  result('glossResult', parts.join(' '), kind);
});

/* ---------------- domainek ---------------- */

async function renderDomains() {
  const ul = $('domainList');
  ul.innerHTML = '';
  // a "*" a saját szakaszában szerepel, ne duplázzuk a listában
  const list = settings.domains.filter(d => d !== '*');
  if (!list.length) {
    ul.innerHTML = '<li class="empty"></li>';
    ul.firstChild.textContent = LFT.t('opt_domain_none');
    return;
  }
  for (const d of list) {
    let granted = false;
    try { granted = await chrome.permissions.contains({ origins: [patternFor(d)] }); } catch (e) {}
    const li = document.createElement('li');
    const box = document.createElement('div');
    box.className = 'grow';
    box.innerHTML = '<b></b><span class="mono"></span>';
    box.querySelector('b').textContent = d;
    box.querySelector('.mono').textContent = granted ? patternFor(d) : LFT.t('opt_domain_nogrant');
    li.appendChild(box);

    /* Engedély nélkül a domain csak a listán van, de nem fut rajta semmi —
       adjunk rá egy gombot, mert a permissions.request csak kattintásból hívható. */
    if (!granted) {
      const ok = document.createElement('button');
      ok.className = 'small primary';
      ok.textContent = LFT.t('opt_domain_grant');
      ok.addEventListener('click', async () => {
        let granted2 = false;
        try { granted2 = await chrome.permissions.request({ origins: [patternFor(d)] }); }
        catch (e) { result('domainResult', LFT.t('opt_perm_failed', [e.message]), 'err'); return; }
        if (!granted2) { result('domainResult', LFT.t('pop_perm_denied'), 'err'); return; }
        const r = await chrome.runtime.sendMessage({ type: 'domains:sync' });
        result('domainResult',
          LFT.t('opt_domain_added', [d]) + ' ' +
          (r && r.injected ? LFT.t('opt_domain_injected', [String(r.injected)]) : LFT.t('opt_domain_reload')),
          'ok');
        renderDomains();
      });
      li.appendChild(ok);
    }

    const btn = document.createElement('button');
    btn.className = 'small danger';
    btn.textContent = LFT.t('opt_delete');
    btn.addEventListener('click', () => removeDomain(d));
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

async function fillForm() {
  settings = await LFT.store.getSettings();

  $('key').value = settings.deeplKey || '';
  $('delay').value = settings.flushDelay;
  $('delayVal').textContent = settings.flushDelay + ' ms';
  $('fs').value = settings.fontSize;
  $('fsVal').textContent = settings.fontSize + ' px';
  $('op').value = settings.opacity;
  $('opVal').textContent = settings.opacity + '%';
  $('bilingual').checked = !!settings.bilingual;
  $('glossary').value = settings.glossary || '';

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

  $('autoTrack').checked = settings.autoTrack !== false;
  $('autoStart').checked = settings.autoStart !== false;

  await renderDomains();
  await renderAllSites();
  await renderTargets();
}

/* ---------------- minden oldal egyetlen kattintással ---------------- */

const ALL_SITES = '*';

async function hasAllSites() {
  try { return await chrome.permissions.contains({ origins: [patternFor(ALL_SITES)] }); }
  catch (e) { return false; }
}

async function renderAllSites() {
  const on = await hasAllSites();
  $('allSites').hidden = on;
  $('allSitesOff').hidden = !on;
  if (on) result('allSitesResult', LFT.t('opt_all_sites_on'), 'ok');
}

$('allSites').addEventListener('click', async () => {
  let granted = false;
  try { granted = await chrome.permissions.request({ origins: [patternFor(ALL_SITES)] }); }
  catch (e) { result('allSitesResult', LFT.t('opt_perm_failed', [e.message]), 'err'); return; }
  if (!granted) { result('allSitesResult', LFT.t('pop_perm_denied'), 'err'); return; }

  if (!settings.domains.includes(ALL_SITES)) settings.domains.push(ALL_SITES);
  await LFT.store.saveSettings({ domains: settings.domains });
  const r = await chrome.runtime.sendMessage({ type: 'domains:sync' });
  result('allSitesResult',
    LFT.t('opt_all_sites_done') + ' ' +
    (r && r.injected ? LFT.t('opt_domain_injected', [String(r.injected)]) : LFT.t('opt_domain_reload')),
    'ok');
  await renderAllSites();
  await renderDomains();
});

$('allSitesOff').addEventListener('click', async () => {
  try { await chrome.permissions.remove({ origins: [patternFor(ALL_SITES)] }); }
  catch (e) { /* lehet, hogy már nincs meg */ }
  settings.domains = settings.domains.filter(d => d !== ALL_SITES);
  await LFT.store.saveSettings({ domains: settings.domains });
  await chrome.runtime.sendMessage({ type: 'domains:sync' });
  result('allSitesResult', LFT.t('opt_all_sites_removed'), 'info');
  await renderAllSites();
  await renderDomains();
});

$('autoTrack').addEventListener('change', () => {
  queueSave({ autoTrack: $('autoTrack').checked });
});
$('autoStart').addEventListener('change', () => {
  queueSave({ autoStart: $('autoStart').checked });
});

/* ---------- mentés / visszatöltés ---------- */

const BACKUP_APP = 'elo-feliratfordito';

$('exportBtn').addEventListener('click', async () => {
  const s = await LFT.store.getSettings();
  const withKeys = $('exportKeys').checked;
  if (!withKeys) { s.deeplKey = ''; s.googleKey = ''; }

  const data = {
    app: BACKUP_APP,
    format: 1,
    exportedAt: new Date().toISOString(),
    containsKeys: withKeys,
    settings: s,
    targets: await LFT.store.getTargets(),
    ui: (await chrome.storage.local.get('ui')).ui || {}
  };

  const d = new Date();
  const name = 'elo-feliratfordito-beallitasok_' +
    d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '.json';
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  result('backupResult', LFT.t('opt_exported', [name]), 'ok');
});

$('importBtn').addEventListener('click', () => $('importFile').click());

$('importFile').addEventListener('change', async () => {
  const file = $('importFile').files[0];
  $('importFile').value = '';               // ugyanaz a fájl újra kiválasztható legyen
  if (!file) return;

  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (e) {
    result('backupResult', LFT.t('opt_import_failed'), 'err');
    return;
  }
  if (!data || data.app !== BACKUP_APP || !data.settings) {
    result('backupResult', LFT.t('opt_import_bad'), 'err');
    return;
  }

  /* Csak az ismert beállításkulcsokat vesszük át, hogy a fájlból ne kerüljön be
     semmi váratlan. Az üres kulcsokat nem írjuk felül a meglévők fölé. */
  const patch = {};
  for (const k of Object.keys(LFT.store.DEFAULT_SETTINGS)) {
    if (!(k in data.settings)) continue;
    const v = data.settings[k];
    if ((k === 'deeplKey' || k === 'googleKey') && !v) continue;
    patch[k] = v;
  }
  await LFT.store.saveSettings(patch);

  if (data.targets && typeof data.targets === 'object') {
    const cur = await LFT.store.getTargets();
    await chrome.storage.local.set({ targets: Object.assign(cur, data.targets) });
  }
  if (data.ui && typeof data.ui === 'object') {
    const cur = (await chrome.storage.local.get('ui')).ui || {};
    await chrome.storage.local.set({ ui: Object.assign(cur, data.ui) });
  }

  await chrome.runtime.sendMessage({ type: 'domains:sync' });
  await fillForm();

  const domains = (patch.domains || []).length;
  const targets = Object.keys(data.targets || {}).length;
  result('backupResult',
    LFT.t('opt_import_ok', [String(domains), String(targets)]) +
    (domains ? ' ' + LFT.t('opt_import_perm') : ''),
    'ok');
});

async function init() {
  LFT.i18n.applyDom();
  await fillForm();
  await renderSessions();
}

init();
