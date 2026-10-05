/* A fogyasztásmérő tesztje: az összesítő (lib/store.js mergeUsage) és az
   offscreen dokumentum időjelentése. Futtatás: node tests/usage-test.js */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..') + '/';

let fail = 0;
function is(nev, kapott, vart) {
  const ok = JSON.stringify(kapott) === JSON.stringify(vart);
  if (!ok) fail++;
  console.log((ok ? 'OK   ' : 'HIBA ') + nev);
  if (!ok) console.log('       kapott: ' + JSON.stringify(kapott) + '  várt: ' + JSON.stringify(vart));
}

/* ---------- összesítő ---------- */
const g = { LFT: {} };
new Function('globalThis', 'LFT', fs.readFileSync(ROOT + 'lib/store.js', 'utf8'))(g, g.LFT);
const { mergeUsage, monthKey } = g.LFT.store;

const OCT5 = new Date(2026, 9, 5, 19, 0).getTime();
const NOV2 = new Date(2026, 10, 2, 9, 0).getTime();

{
  let u = mergeUsage(null, 30, OCT5);
  is('első jelentés: kezdet, összeg, hónap', u, { since: OCT5, total: 30, months: { '2026-10': 30 } });
  u = mergeUsage(u, 90, OCT5 + 1000);
  is('összeadódik', [u.total, u.months['2026-10']], [120, 120]);
  is('a kezdet nem változik', u.since, OCT5);
  u = mergeUsage(u, 60, NOV2);
  is('új hónap külön számol, az összesen tovább nő', [u.total, u.months], [180, { '2026-10': 120, '2026-11': 60 }]);
}
{
  const u0 = mergeUsage(null, 10, OCT5);
  is('nulla jelentés: nem változik', mergeUsage(u0, 0, OCT5).total, 10);
  is('negatív jelentés: nem változik', mergeUsage(u0, -50, OCT5).total, 10);
  is('értelmetlen jelentés: nem változik', mergeUsage(u0, 'abc', OCT5).total, 10);
  is('egy jelentés legfeljebb 1 óra (hibás óra elleni védelem)', mergeUsage(u0, 999999, OCT5).total, 10 + 3600);
  is('nem módosítja a bemenetet', u0.total, 10);
}
is('hónapkulcs a helyi naptár szerint', monthKey(new Date(2026, 0, 31, 23, 59).getTime()), '2026-01');

/* ---------- hátralévő kredit ---------- */
{
  const { withBalance, remainingUsd, parseUsd } = g.LFT.store;
  const P = 0.0077;
  let u = mergeUsage(null, 600, OCT5);                          // 10 perc még az egyenleg megadása ELŐTT
  is('egyenleg nélkül nincs hátralévő', remainingUsd(u, P), null);
  u = withBalance(u, 199.87, OCT5 + 1000);
  is('a megadott egyenleg', remainingUsd(u, P), 199.87);
  is('a korábbi mérés nem vonódik le kétszer (benne van a konzol számában)', u.balance.used, 0);
  is('az egyenleg megadása nem nullázza a mérőt', u.total, 600);
  u = mergeUsage(u, 3600, OCT5 + 2000);                        // utána 60 perc
  is('az azóta mért idő levonódik (60 perc ≈ 0,462 $)', Math.round(remainingUsd(u, P) * 1000) / 1000, 199.408);
  is('… a mérő közben tovább számol', u.total, 4200);
  is('nem megy nulla alá', remainingUsd(withBalance(null, 0.01, OCT5) && mergeUsage(withBalance(null, 0.01, OCT5), 3600, OCT5), P), 0);
  is('új egyenleg beírása újrakezdi a levonást', withBalance(u, 150, OCT5).balance, { usd: 150, at: OCT5, used: 0 });
  is('üres/érvénytelen egyenleg törli', withBalance(u, NaN, OCT5).balance, undefined);

  is('szám: 199,87', parseUsd('199,87'), 199.87);
  is('szám: $199.87', parseUsd('$199.87'), 199.87);
  is('szám: 199.87 $', parseUsd('199.87 $'), 199.87);
  is('szám: 200', parseUsd('200'), 200);
  is('szám: 1.234,56', parseUsd('1.234,56'), 1234.56);
  is('szám: 200 USD', parseUsd('200 USD'), 200);
  is('értelmetlen: NaN', isNaN(parseUsd('kétszáz')), true);
  is('negatív: NaN', isNaN(parseUsd('-5')), true);
}
is('sérült tárolt érték: újrakezdi', mergeUsage('szemét', 5, OCT5).total, 5);

/* ---------- az offscreen jelenti az időt ---------- */
(async () => {
  /* ---------- a tárolón át: nullázás, egyenleg ---------- */
  {
    const mem = {};
    const chromeMock = {
      runtime: { id: 'x' },
      storage: { local: {
        get: async k => ({ [k]: mem[k] }),
        set: async o => { Object.assign(mem, o); },
        remove: async ks => { [].concat(ks).forEach(k => delete mem[k]); }
      } }
    };
    const g2 = { LFT: {} };
    new Function('globalThis', 'LFT', 'chrome', fs.readFileSync(ROOT + 'lib/store.js', 'utf8'))(g2, g2.LFT, chromeMock);
    const st = g2.LFT.store;
    await st.addUsage(120, OCT5);
    await st.setBalance(200, OCT5);
    await st.addUsage(60, OCT5);
    is('tárolón át: 1 perc levonva', Math.round(st.remainingUsd(await st.getUsage(), 0.0077) * 10000) / 10000, 199.9923);
    await st.resetUsage();
    const after = await st.getUsage();
    is('a mérő nullázása nem törli az egyenleget', [after.total, after.balance.usd, after.balance.used], [0, 200, 60]);
    await st.setBalance(NaN);
    await st.resetUsage();
    is('egyenleg nélkül a nullázás mindent töröl', await st.getUsage(), null);
  }

  let handlers = null;
  const sent = [];
  class FakeCtx {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    createMediaStreamSource() { return { connect() {} }; }
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    createAnalyser() { return { getFloatTimeDomainData: b => b.fill(0) }; }
    async resume() {}
    async close() {}
  }
  class FakeRecorder { constructor() {} start() {} stop() {} }
  let listener = null;
  const LFTmock = {
    stt: {
      open: (p, cfg, h) => { handlers = h; return { send() {}, close: async () => { h.onClose({ code: 1000, wasOpen: true }); } }; },
      closeToCode: () => null
    }
  };
  new Function('navigator', 'chrome', 'AudioContext', 'MediaRecorder', 'LFT', 'atob',
    fs.readFileSync(ROOT + 'offscreen/offscreen.js', 'utf8'))(
    { mediaDevices: { getUserMedia: async () => ({ getAudioTracks: () => [{ addEventListener() {} }], getTracks: () => [{ stop() {} }] }) } },
    { runtime: { onMessage: { addListener: fn => { listener = fn; } }, sendMessage: m => { sent.push(m); return Promise.resolve(); } } },
    FakeCtx, FakeRecorder, LFTmock, atob);
  const call = msg => new Promise(res => { const r = listener(Object.assign({ target: 'offscreen' }, msg), {}, res); if (r !== true && r !== undefined) res(r); });

  await call({ type: 'start', streamId: 'x', tabId: 3, stt: { provider: 'deepgram', key: 'k' } });
  handlers.onOpen();
  await new Promise(r => setTimeout(r, 250));
  await call({ type: 'stop' });

  const usage = sent.filter(m => m.type === 'stt:usage');
  const secs = usage.reduce((a, m) => a + m.seconds, 0);
  is('lezáráskor jelenti a nyitott kapcsolat idejét', usage.length >= 1, true);
  is('… nagyjából a valódi időt (0,2–1 mp)', secs >= 0.2 && secs < 1, true);
  is('… és csak egyszer (nem duplán a lezárás két útján)', usage.length, 1);

  console.log(fail ? '\n' + fail + ' teszt bukott' : '\nMinden teszt átment');
  process.exit(fail ? 1 : 0);
})();
