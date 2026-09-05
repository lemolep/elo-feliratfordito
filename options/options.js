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
  return String(s || 'atirat')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '_')
    .trim()
    .slice(0, 80) || 'atirat';
}

function duration(ms) {
  if (!ms || ms < 0) return '—';
  const m = Math.round(ms / 60000);
  if (m < 60) return m + ' perc';
  return Math.floor(m / 60) + ' ó ' + (m % 60) + ' p';
}

/* ---------------- DeepL kulcs ---------------- */

$('keyShow').addEventListener('click', () => {
  const f = $('key');
  const shown = f.type === 'text';
  f.type = shown ? 'password' : 'text';
  $('keyShow').textContent = shown ? 'Mutat' : 'Rejt';
});

$('key').addEventListener('input', () => {
  queueSave({ deeplKey: $('key').value.trim() });
  result('keyResult', 'Elmentve. A "Teszt" gombbal ellenőrizheted.', 'info');
});

$('keyTest').addEventListener('click', async () => {
  const key = $('key').value.trim();
  if (!key) { result('keyResult', 'Előbb írd be a kulcsot.', 'err'); return; }
  await LFT.store.saveSettings({ deeplKey: key });
  result('keyResult', 'Ellenőrzés…', 'info');
  const res = await chrome.runtime.sendMessage({ type: 'deepl:usage', key: key });
  if (res && res.ok) {
    const u = res.usage || {};
    const used = u.character_count || 0;
    const limit = u.character_limit || 0;
    const pct = limit ? Math.round(used / limit * 100) : 0;
    result('keyResult',
      'Működik. Végpont: ' + res.endpoint + ' — elhasználva ' +
      used.toLocaleString('hu-HU') + ' / ' + limit.toLocaleString('hu-HU') +
      ' karakter (' + pct + '%).', 'ok');
  } else {
    result('keyResult', (res && res.error) || 'Nem sikerült elérni a DeepL-t.', 'err');
  }
});

/* ---------------- célnyelv ---------------- */

function fillLangs(list, selected) {
  const sel = $('target');
  sel.innerHTML = '';
  list.slice()
    .map(l => ({ code: l.language, label: LFT.deepl.labelFor(l.language, l.name) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'hu'))
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
    if (!quiet) result('langResult', 'A friss listához előbb add meg a DeepL kulcsot.', 'err');
    return;
  }
  if (!quiet) result('langResult', 'Lista lekérése…', 'info');
  const res = await chrome.runtime.sendMessage({ type: 'deepl:languages', key: key });
  if (res && res.ok && res.langs && res.langs.length) {
    fillLangs(res.langs, settings.targetLang);
    if (!quiet) result('langResult', res.langs.length + ' célnyelv elérhető.', 'ok');
  } else if (!quiet) {
    result('langResult', (res && res.error) || 'Nem sikerült lekérni a nyelvek listáját.', 'err');
  }
}

$('target').addEventListener('change', () => {
  queueSave({ targetLang: $('target').value });
  const label = $('target').options[$('target').selectedIndex].textContent;
  result('langResult', 'Mostantól ide fordít: ' + label, 'ok');
});

$('langRefresh').addEventListener('click', () => refreshLangs(false));

/* ---------------- domainek ---------------- */

async function renderDomains() {
  const ul = $('domainList');
  ul.innerHTML = '';
  if (!settings.domains.length) {
    ul.innerHTML = '<li class="empty">Még nincs engedélyezett oldal.</li>';
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
    box.querySelector('.mono').textContent = granted
      ? patternFor(d)
      : 'nincs engedély — töröld és add hozzá újra';
    const btn = document.createElement('button');
    btn.className = 'small danger';
    btn.textContent = 'Törlés';
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
  result('domainResult', d + ' eltávolítva.', 'info');
  renderDomains();
}

$('domainAdd').addEventListener('click', async () => {
  const d = cleanDomain($('domainInput').value);
  if (!d) { result('domainResult', 'Ez nem érvényes domain. Például: pelda-stream.hu', 'err'); return; }
  if (settings.domains.includes(d)) { result('domainResult', 'Ez már a listán van.', 'info'); return; }

  let granted = false;
  try { granted = await chrome.permissions.request({ origins: [patternFor(d)] }); }
  catch (e) { result('domainResult', 'Nem sikerült engedélyt kérni: ' + e.message, 'err'); return; }
  if (!granted) { result('domainResult', 'Az engedélyt elutasítottad, így itt nem tud futni.', 'err'); return; }

  settings.domains.push(d);
  await LFT.store.saveSettings({ domains: settings.domains });
  const r = await chrome.runtime.sendMessage({ type: 'domains:sync' });
  $('domainInput').value = '';
  result('domainResult',
    d + ' hozzáadva.' + (r && r.injected ? ' ' + r.injected + ' megnyitott fülön azonnal aktív.' : ' A már megnyitott fülekhez töltsd újra az oldalt.'),
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
    ul.innerHTML = '<li class="empty">Még nincs kijelölt feliratelem. A bővítmény a videó saját feliratsávját próbálja olvasni.</li>';
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
    btn.textContent = 'Szabály törlése';
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
  out.push('# Élő fordítás — ' + (s.title || s.origin));
  out.push('# Forrás: ' + s.url);
  out.push('# Rögzítve: ' + clockOf(s.startedAt) + (s.endedAt ? ' – ' + clockOf(s.endedAt) : ''));
  out.push('# Sorok: ' + lines.length);
  out.push('');
  for (const l of lines) {
    const time = (l.videoTime != null) ? hhmmss(l.videoTime) : hhmmss((l.t - first) / 1000);
    out.push('[' + time + ']');
    out.push('EN: ' + l.src);
    out.push('HU: ' + (l.hu || '(nincs fordítás)'));
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
    ? rows.length + ' felvétel · ' + (bytes >= 0 ? (bytes / 1024 / 1024).toFixed(2) + ' MB tárhely' : '')
    : 'Még nincs felvétel.';

  if (!rows.length) {
    tbody.innerHTML = '<tr class="none"><td colspan="5">Itt jelennek meg a rögzített átiratok.</td></tr>';
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
    td3.textContent = r.endedAt ? duration(r.endedAt - r.startedAt) : 'folyamatban';

    const td4 = document.createElement('td');
    td4.textContent = r.lineCount || 0;

    const td5 = document.createElement('td');
    td5.className = 'actions';
    const dl = document.createElement('button');
    dl.className = 'small primary';
    dl.textContent = 'Letöltés';
    dl.addEventListener('click', () => downloadSession(r.id, r.title, r.startedAt));
    const del = document.createElement('button');
    del.className = 'small danger';
    del.textContent = 'Törlés';
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
  if (!confirm('Biztosan törlöd az összes rögzített átiratot? Ez nem vonható vissza.')) return;
  await chrome.runtime.sendMessage({ type: 'session:clear' });
  renderSessions();
});

/* ---------------- indulás ---------------- */

async function init() {
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

  await renderDomains();
  await renderTargets();
  await renderSessions();
}

init();
