/* A Vimeo-figyelő (content/vimeo.js) tesztje hamis ablakkal és keretekkel.
   Futtatás: node tests/vimeo-test.js */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'content', 'vimeo.js'), 'utf8');

let fail = 0;
function is(nev, kapott, vart) {
  const ok = JSON.stringify(kapott) === JSON.stringify(vart);
  if (!ok) fail++;
  console.log((ok ? 'OK   ' : 'HIBA ') + nev);
  if (!ok) console.log('       kapott: ' + JSON.stringify(kapott) + '  várt: ' + JSON.stringify(vart));
}

/* ---------- hamis környezet ---------- */
function mkWin(name) { return { name: name, posted: [], postMessage(m, o) { this.posted.push({ m: JSON.parse(m), o: o }); } }; }
const big = mkWin('nagy'), small = mkWin('kicsi'), stranger = mkWin('idegen');
const frames = [
  { src: 'https://player.vimeo.com/video/460353308', contentWindow: big },
  { src: '//player.vimeo.com/video/649132437', contentWindow: small },
  { src: 'https://js.stripe.com/v3/x', contentWindow: mkWin('stripe') }
];
const doc = { querySelectorAll: () => frames.map(f => ({ getAttribute: () => f.src, contentWindow: f.contentWindow })) };
const listeners = [];
const win = { addEventListener: (t, fn) => listeners.push(fn) };
win.top = win;
const g = { LFT: {} };
new Function('globalThis', 'LFT', 'window', 'document', src)(g, g.LFT, win, doc);
const V = g.LFT.vimeo;

const msg = (source, data, origin) => V._onMessage({ origin: origin || 'https://player.vimeo.com', source: source, data: JSON.stringify(data) });

(async () => {
  is('feliratkozás előtt nincs idő', V.now(), null);

  V.watch(true);
  is('bekapcsoláskor feliratkozik mindkét Vimeo-keret eseményeire',
    [big, small].map(w => w.posted.filter(p => p.m.method === 'addEventListener').map(p => p.m.value)),
    [['timeupdate', 'play', 'pause', 'ended'], ['timeupdate', 'play', 'pause', 'ended']]);
  is('csak a Vimeo eredetnek küld', big.posted.every(p => p.o === 'https://player.vimeo.com'), true);
  is('a nem Vimeo keretnek nem küld', frames[2].contentWindow.posted.length, 0);
  is('egy üzenetkezelőt regisztrál', listeners.length, 1);
  V.watch(true);
  is('ismételt bekapcsolás: nem regisztrál újat', listeners.length, 1);

  /* ---------- biztonság ---------- */
  msg(big, { event: 'timeupdate', data: { seconds: 999 } }, 'https://evil.example');
  is('idegen eredetű üzenetet eldob', V.now(), null);
  msg(stranger, { event: 'timeupdate', data: { seconds: 999 } });
  is('Vimeo eredet, de nem a lap kerete: eldobja', V.now(), null);
  V._onMessage({ origin: 'https://player.vimeo.com', source: big, data: '{rossz json' });
  is('hibás JSON: nem dől el', V.now(), null);

  /* ---------- idő ---------- */
  msg(big, { method: 'getCurrentTime', value: 12 });
  msg(big, { method: 'getPaused', value: true });
  is('megállított videó: a jelentett idő', V.now(), { time: 12, playing: false });

  msg(big, { event: 'timeupdate', data: { seconds: 20, percent: 0.1, duration: 211 } });
  const t1 = V.now();
  is('timeupdate után játszik', t1.playing, true);
  is('timeupdate ideje', Math.round(t1.time), 20);
  await new Promise(r => setTimeout(r, 300));
  const t2 = V.now();
  is('játszás közben előreszámol a legutóbbi jelentéstől', t2.time > t1.time && t2.time < t1.time + 1, true);

  msg(big, { event: 'pause', data: { seconds: 21.5 } });
  is('pause: megáll, a pause-ban jelentett időnél', V.now(), { time: 21.5, playing: false });

  /* ---------- több lejátszó ---------- */
  msg(small, { event: 'timeupdate', data: { seconds: 5 } });
  is('a játszó lejátszót választja a megállított helyett', Math.round(V.now().time), 5);
  msg(small, { event: 'ended', data: { seconds: 100 } });
  msg(big, { event: 'play' });
  is('ha a másik játszik, azt választja', V.now().playing, true);
  is('… és annak az idejét', Math.round(V.now().time) >= 21, true);

  /* ---------- ready esemény ---------- */
  const before = small.posted.length;
  msg(small, { event: 'ready' });
  is('ready után újra feliratkozik (későn betöltött lejátszó)', small.posted.length > before, true);

  /* ---------- rákérdezés (biztonsági háló) ---------- */
  const polledBefore = big.posted.filter(p => p.m.method === 'getCurrentTime').length;
  await new Promise(r => setTimeout(r, 1100));
  is('másodpercenként rákérdez az időre (ha az események nem jönnének)',
    big.posted.filter(p => p.m.method === 'getCurrentTime').length > polledBefore, true);

  /* ---------- nem felső keretben ---------- */
  const g2 = { LFT: {} };
  const iwin = { addEventListener: () => { throw new Error('nem szabadna'); } };
  iwin.top = {};
  new Function('globalThis', 'LFT', 'window', 'document', src)(g2, g2.LFT, iwin, doc);
  let threw = false;
  try { g2.LFT.vimeo.watch(true); } catch (e) { threw = true; }
  is('beágyazott keretben nem csinál semmit', threw, false);

  V.watch(false);
  console.log(fail ? '\n' + fail + ' teszt bukott' : '\nMinden teszt átment');
  process.exit(fail ? 1 : 0);
})();
