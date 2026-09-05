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
    $('stateText').textContent = 'Nem fut ezen az oldalon';
    $('enable').hidden = !host;
    setControls(false);
    return;
  }

  $('enable').hidden = true;
  setControls(true);
  $('dot').className = 'dot ' + (state.recording ? 'on' : '');
  $('stateText').textContent = state.recording
    ? 'Rögzít — ' + state.lines + ' sor'
    : (state.lines ? 'Áll — ' + state.lines + ' sor' : 'Készenlétben');
  $('rec').textContent = state.recording ? 'Rögzítés leállítása' : 'Rögzítés indítása';
  $('rec').className = state.recording ? 'danger' : 'primary';
  $('save').disabled = !state.lines;
}

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url && /^https?:/i.test(tab.url)) {
    try { host = new URL(tab.url).hostname; } catch (e) { host = ''; }
  }
  $('host').textContent = host || 'Ezen az oldaltípuson nem futhat bővítmény.';

  const settings = await LFT.store.getSettings();
  if (!settings.deeplKey) {
    note('Még nincs DeepL API kulcs. A rögzítés működik, de fordítás nélkül. Állítsd be lent.');
  }

  await refresh();
}

$('enable').addEventListener('click', async () => {
  if (!host) return;
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [patternFor(host)] });
  } catch (e) {
    note('Nem sikerült engedélyt kérni erre a címre: ' + host);
    return;
  }
  if (!granted) { note('Az engedélyt elutasítottad, így itt nem tud futni.'); return; }

  const s = await LFT.store.getSettings();
  if (!s.domains.includes(host)) {
    s.domains.push(host);
    await LFT.store.saveSettings({ domains: s.domains });
  }
  await chrome.runtime.sendMessage({ type: 'domains:sync' });
  await new Promise(r => setTimeout(r, 300));
  await refresh();
  if (!injected) note('Engedélyezve. Töltsd újra az oldalt (F5), és megjelenik az ablak.');
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
  h.textContent = f.frame;
  div.appendChild(h);

  const stats = document.createElement('div');
  stats.className = 'k';
  stats.textContent = 'videó: ' + f.videos + ' · feliratsáv: ' + f.tracks + ' (aktív: ' + f.activeTracks + ')';
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
    line('good', '✓ A videó saját feliratsávjából olvasható a szöveg:');
    sample(f.trackText);
  }

  if (f.hasTarget) {
    if (f.targetFound && f.targetText) {
      line('good', '✓ A kijelölt elem megvan és van benne szöveg:');
      sample(f.targetText);
    } else if (f.targetFound) {
      line('bad', 'A kijelölt elem megvan, de most üres — be van kapcsolva a felirat?');
    } else {
      line('bad', 'A kijelölt elem nem található. Célozz újra.');
    }
    line('k', 'Mentett szabály: ' + f.targetSelector);
    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = 'Szabály törlése (vissza a feliratsávra)';
    del.addEventListener('click', async () => {
      await LFT.store.removeTarget(f.origin);
      del.textContent = 'Törölve — töltsd újra az oldalt';
      del.disabled = true;
    });
    div.appendChild(del);
  }

  if (f.guess) {
    line('good', 'Találtam egy valószínű feliratelemet:');
    sample(f.guess.sample);
    const b = document.createElement('button');
    b.className = 'primary';
    b.textContent = 'Beállítom ezt feliratforrásnak';
    b.addEventListener('click', async () => {
      await LFT.store.setTarget(f.origin, f.guess.selector, 'diagnosztika');
      b.textContent = 'Beállítva — nyomd meg a Start-ot';
      b.disabled = true;
    });
    div.appendChild(b);
  }

  if (!f.trackText && !f.guess && !f.hasTarget) {
    if (!f.videos) {
      line('bad', 'Ebben a keretben nincs videó és feliratra utaló elem sem — a lejátszó valószínűleg beágyazott keretben van.');
    } else {
      line('bad', 'Van videó, de feliratszöveget nem találok. Kapcsold be a feliratot, majd futtasd újra — ha így sem, a felirat a videóképre lehet égetve.');
    }
  }

  const ifr = f.iframes || { list: [], unknown: 0 };
  if (ifr.list.length) {
    line('bad', 'Beágyazott keretek ezen az oldalon — a lejátszó szinte biztosan az elsőben van. Engedélyezd, hogy belelássak:');
    ifr.list.forEach(it => {
      const b = document.createElement('button');
      b.className = 'primary';
      b.textContent = 'Engedélyezem: ' + it.host;
      b.addEventListener('click', () => enableDomain(it.host, b));
      div.appendChild(b);
    });
  }
  if (ifr.unknown) {
    line('k', 'Van még ' + ifr.unknown + ' keret ismeretlen forrással — ezeket nem tudom azonosítani.');
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
    btn.textContent = 'Nem sikerült: ' + e.message;
    return;
  }
  if (!granted) {
    btn.disabled = false;
    btn.textContent = 'Elutasítottad — Engedélyezem: ' + h;
    return;
  }
  const s = await LFT.store.getSettings();
  if (!s.domains.includes(h)) {
    s.domains.push(h);
    await LFT.store.saveSettings({ domains: s.domains });
  }
  await chrome.runtime.sendMessage({ type: 'domains:sync' });
  btn.textContent = '✓ ' + h + ' engedélyezve — töltsd újra az oldalt (F5)';
}

$('diag').addEventListener('click', async () => {
  const box = $('report');
  box.textContent = 'Vizsgálat…';
  const res = await chrome.runtime.sendMessage({ type: 'diagnose', tabId: tab.id });
  box.textContent = '';
  if (!res || !res.ok) {
    note((res && res.error) || 'A vizsgálat nem futott le.');
    return;
  }
  if (!res.frames.length) {
    note('Egyetlen keretből sem jött válasz. Töltsd újra az oldalt (F5).');
    return;
  }
  res.frames.forEach(f => box.appendChild(frameCard(f)));
});

$('opts').addEventListener('click', () => { chrome.runtime.openOptionsPage(); window.close(); });

init();
