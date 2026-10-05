/* A beszédfelismerő réteg (lib/stt.js) tesztje hamis WebSockettel és fetch-csel.
   Futtatás: node tests/stt-test.js */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'stt.js'), 'utf8');

let fail = 0;
function is(nev, kapott, vart) {
  const ok = JSON.stringify(kapott) === JSON.stringify(vart);
  if (!ok) fail++;
  console.log((ok ? 'OK   ' : 'HIBA ') + nev);
  if (!ok) console.log('       kapott: ' + JSON.stringify(kapott) + '  várt: ' + JSON.stringify(vart));
}

/* ---------- hamis WebSocket ---------- */
let sockets = [];
class FakeWS {
  constructor(url, protocols) {
    this.url = url; this.protocols = protocols; this.readyState = 0; this.sent = [];
    sockets.push(this);
  }
  send(d) { this.sent.push(d); }
  close(code) { if (this.readyState === 3) return; this.readyState = 3; this.onclose && this.onclose({ code: code || 1000, reason: '' }); }
  _open() { this.readyState = 1; this.onopen && this.onopen(); }
  _msg(obj) { this.onmessage && this.onmessage({ data: JSON.stringify(obj) }); }
  _drop(code) { this.readyState = 3; this.onclose && this.onclose({ code: code, reason: '' }); }
}
let fetchImpl = null;
const g = { LFT: {}, navigator: { onLine: true } };
new Function('globalThis', 'LFT', 'WebSocket', 'fetch', 'navigator', src)(
  g, g.LFT, FakeWS, (...a) => fetchImpl(...a), g.navigator);
const stt = g.LFT.stt;
const dg = stt.PROVIDERS.deepgram;
const KEY = 'abc123def456abc123def456abc123def456abcd';
const blob = n => ({ size: n });

(async () => {
  /* ---------- URL ---------- */
  const url = dg.url({ model: 'nova-3', language: 'en', keyterms: ['Unyte', 'polyvagal', '  ', 'x'.repeat(80)] });
  const q = new URL(url).searchParams;
  is('wss végpont', url.startsWith('wss://api.deepgram.com/v1/listen?'), true);
  is('modell', q.get('model'), 'nova-3');
  is('nyelv', q.get('language'), 'en');
  is('írásjelek bekapcsolva (smart_format)', q.get('smart_format'), 'true');
  is('köztes találatok bekapcsolva', q.get('interim_results'), 'true');
  is('kulcskifejezések: üres és túl hosszú kiesik', q.getAll('keyterm'), ['Unyte', 'polyvagal']);
  is('legfeljebb 50 kulcskifejezés',
    new URL(dg.url({ keyterms: Array.from({ length: 80 }, (_, i) => 't' + i) })).searchParams.getAll('keyterm').length, 50);

  /* ---------- a kulcs csak az alprotokollban ---------- */
  sockets = [];
  stt.open('deepgram', { key: '  ' + KEY + '​\n' }, {});
  const ws = sockets[0];
  is('a kulcs az alprotokollban megy, tisztítva', ws.protocols, ['token', KEY]);
  is('a kulcs NINCS az URL-ben', ws.url.includes(KEY), false);

  /* ---------- üzenetek feldolgozása ---------- */
  is('végleges találat', dg.parse(JSON.stringify({
    type: 'Results', is_final: true, speech_final: true, start: 1.5, duration: 2,
    channel: { alternatives: [{ transcript: ' Welcome to Unyte. ' }] }
  })), { text: 'Welcome to Unyte.', final: true, speechFinal: true, start: 1.5, duration: 2 });
  is('köztes találat', dg.parse(JSON.stringify({
    type: 'Results', is_final: false, channel: { alternatives: [{ transcript: 'Welcome to' }] }
  })).final, false);
  is('nem Results üzenet: kimarad', dg.parse(JSON.stringify({ type: 'Metadata' })), null);
  is('hibás JSON: kimarad', dg.parse('{nem json'), null);

  /* ---------- élő kapcsolat ---------- */
  sockets = [];
  const got = [], closes = [];
  let opened = false;
  const s = stt.open('deepgram', { key: KEY }, {
    onOpen: () => { opened = true; },
    onResult: r => got.push(r),
    onClose: e => closes.push(e)
  });
  const w = sockets[0];
  s.send(blob(10)); s.send(blob(20)); s.send(blob(0));
  is('megnyitás előtt a hang várakozik, nem vész el', w.sent.length, 0);
  w._open();
  is('megnyitáskor a várakozó darabok elmennek (üres nem)', w.sent.map(b => b.size), [10, 20]);
  is('onOpen jelez', opened, true);
  s.send(blob(30));
  is('nyitott kapcsolaton azonnal megy', w.sent[w.sent.length - 1].size, 30);
  w._msg({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript: 'Hello there.' }] } });
  is('a találat eljut a hívóhoz', got.map(r => r.text), ['Hello there.']);

  const closing = s.close();
  is('lezáráskor CloseStream megy, hogy az utolsó mondat se vesszen el',
    w.sent.some(d => typeof d === 'string' && JSON.parse(d).type === 'CloseStream'), true);
  w._msg({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript: 'Last words.' }] } });
  is('a CloseStream utáni utolsó találat még megérkezik', got[got.length - 1].text, 'Last words.');
  w._drop(1000);
  await closing;
  is('a lezárás megvárja a kapcsolat végét', closes.length, 1);
  is('rendes lezárás: nincs hibakód', stt.closeToCode(closes[0]), null);

  /* ---------- kényszerített lezárás (háttérzene) ---------- */
  {
    sockets = [];
    const s2 = stt.open('deepgram', { key: KEY, forceFinalizeMs: 40 }, {});
    const w2 = sockets[0];
    w2._open();
    const finals = () => w2.sent.filter(d => typeof d === 'string' && JSON.parse(d).type === 'Finalize').length;
    await new Promise(r => setTimeout(r, 80));
    is('köztes szöveg nélkül nem kér lezárást', finals(), 0);
    w2._msg({ type: 'Results', is_final: false, channel: { alternatives: [{ transcript: 'music and talking' }] } });
    await new Promise(r => setTimeout(r, 120));
    is('ha sokáig nem jön lezárás, de hall valamit: Finalize', finals() >= 1, true);
    w2._msg({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript: 'music and talking.' }] } });
    const after = finals();
    await new Promise(r => setTimeout(r, 120));
    is('a lezárt szakasz után nem kér újra', finals(), after);
    w2._msg({ type: 'Results', is_final: false, channel: { alternatives: [{ transcript: 'next one' }] } });
    w2._msg({ type: 'UtteranceEnd', last_word_end: 3.1 });
    is('UtteranceEnd-re azonnal kér lezárást', finals(), after + 1);
    w2._msg({ type: 'UtteranceEnd', last_word_end: 3.2 });
    is('… de csak ha van lezáratlan szöveg', finals(), after + 1);
    w2._drop(1000);
    await s2.close();
  }

  /* ---------- bezárási kódok ---------- */
  is('fel sem épült → kulcs', stt.closeToCode({ code: 1006, wasOpen: false }), 'key');
  is('1011 → nem kapott hangot', stt.closeToCode({ code: 1011, wasOpen: true }), 'noaudio');
  is('menet közbeni szakadás', stt.closeToCode({ code: 1006, wasOpen: true }), 'closed');

  /* ---------- rossz kulcs nem nyit kapcsolatot ---------- */
  sockets = [];
  const errs = [];
  stt.open('deepgram', { key: '' }, { onError: c => errs.push(c) });
  stt.open('deepgram', { key: 'kulcs-ő-123' }, { onError: c => errs.push(c) });
  await new Promise(r => setTimeout(r, 5));
  is('üres és érvénytelen kulcsnál nem nyílik kapcsolat', sockets.length, 0);
  is('a hibakódok', errs, ['nokey', 'keychars']);

  /* ---------- kulcsteszt ---------- */
  let req = null;
  fetchImpl = async (u, o) => { req = { u, o }; return { ok: true, status: 200 }; };
  is('jó kulcs', await dg.test(KEY), { ok: true });
  is('a teszt Token fejlécet küld', req.o.headers.Authorization, 'Token ' + KEY);
  is('a tesztben sincs kulcs az URL-ben', req.u.includes(KEY), false);
  const wav = new Uint8Array(req.o.body);
  is('érvényes WAV fejléc', String.fromCharCode(...wav.slice(0, 4)) + String.fromCharCode(...wav.slice(8, 12)), 'RIFFWAVE');
  is('1 mp csend 8 kHz-en', wav.length, 44 + 8000 * 2);

  fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({ err_msg: 'Invalid credentials.' }) });
  is('rossz kulcs → key', (await dg.test(KEY)).code, 'key');
  fetchImpl = async () => ({ ok: false, status: 402, json: async () => ({}) });
  is('elfogyott kredit → credit', (await dg.test(KEY)).code, 'credit');
  fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
  is('hálózati hiba → blocked', (await dg.test(KEY)).code, 'blocked');

  console.log(fail ? '\n' + fail + ' teszt bukott' : '\nMinden teszt átment');
  process.exit(fail ? 1 : 0);
})();
