/* Az offscreen hanglánc tesztje. Az igazi offscreen/offscreen.js-t futtatjuk
   egy hamis AudioContexttel, ami feljegyzi, mi mihez kapcsolódik.
   Három tulajdonságot ellenőrzünk:
     1. a felismerés (elemző) a halkítás ELŐTTI hangot kapja,
     2. a felolvasás NEM megy át a halkításon,
     3. a lap hangja a halkításon át jut a hangszóróra, nem mellette.
   Futtatás: node tests/offscreen-test.js */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'offscreen', 'offscreen.js'), 'utf8');

let fail = 0;
function is(nev, kapott, vart) {
  const ok = JSON.stringify(kapott) === JSON.stringify(vart);
  if (!ok) fail++;
  console.log((ok ? 'OK   ' : 'HIBA ') + nev);
  if (!ok) console.log('       kapott: ' + JSON.stringify(kapott) + '  várt: ' + JSON.stringify(vart));
}

/* ---------- hamis Web Audio ---------- */
class Node {
  constructor(name) { this.name = name; this.out = []; }
  connect(n) { this.out.push(n); return n; }
}
class Param {
  constructor(v) { this.value = v; }
  cancelScheduledValues() {}
  setValueAtTime(v) { this.value = v; }
  linearRampToValueAtTime(v) { this.value = v; }
}
let ctxs = [];
class FakeCtx {
  constructor() { this.state = 'running'; this.currentTime = 0; this.destination = new Node('hangszóró'); ctxs.push(this); }
  createMediaStreamSource() { return (this.src = new Node('lap hangja')); }
  createGain() { const g = new Node('halkítás'); g.gain = new Param(1); return (this.gain = g); }
  createAnalyser() {
    const a = new Node('elemző');
    a.getFloatTimeDomainData = b => b.fill(0.1);
    return (this.an = a);
  }
  createBufferSource() {
    const s = new Node('felolvasás');
    s.start = () => { setTimeout(() => s.onended && s.onended(), 5); };
    s.stop = () => {};
    this.tts = s;
    return s;
  }
  async decodeAudioData(buf) { return { bytes: buf.byteLength }; }
  async resume() {}
  async close() { this.state = 'closed'; }
}

let listener = null;
const sent = [];
const chromeMock = {
  runtime: {
    onMessage: { addListener: fn => { listener = fn; } },
    sendMessage: m => { sent.push(m); return Promise.resolve(); }
  }
};
const navigatorMock = {
  mediaDevices: {
    getUserMedia: async () => ({
      getAudioTracks: () => [{ addEventListener() {} }],
      getTracks: () => [{ stop() {} }]
    })
  }
};

new Function('navigator', 'chrome', 'AudioContext', 'atob', src)(navigatorMock, chromeMock, FakeCtx, atob);

const call = msg => new Promise(res => {
  const r = listener(Object.assign({ target: 'offscreen' }, msg), {}, res);
  if (r !== true && r !== undefined) res(r);
});
const names = list => list.map(n => n.name);

(async () => {
  is('nincs hang mód: a felolvasás "off"-ot ad', (await call({ type: 'play', audio: 'AAAA' })).reason, 'off');

  const r = await call({ type: 'start', streamId: 'x', tabId: 7 });
  is('elindul', r.ok, true);
  const c = ctxs[ctxs.length - 1];

  /* 3. tulajdonság */
  is('a lap hangja a halkításba és az elemzőbe megy', names(c.src.out), ['halkítás', 'elemző']);
  is('a lap hangja NEM megy közvetlenül a hangszóróra', c.src.out.includes(c.destination), false);
  is('a halkítás a hangszóróra megy', names(c.gain.out), ['hangszóró']);

  /* 1. tulajdonság */
  is('az elemző a halkítás előtti ágon van', c.src.out.includes(c.an) && !c.gain.out.includes(c.an), true);

  /* halkítás */
  await call({ type: 'duck', level: 20 });
  is('halkítás 20%-ra', c.gain.gain.value, 0.2);
  await call({ type: 'duck', level: 0 });
  is('halkítás 0%-ra (néma)', c.gain.gain.value, 0);
  await call({ type: 'unduck' });
  is('visszaállítás 100%-ra', c.gain.gain.value, 1);

  /* 2. tulajdonság */
  const p = await call({ type: 'play', audio: Buffer.from('mp3-adat').toString('base64') });
  is('a felolvasás lejátszódik és megvárja a végét', p.ok, true);
  is('a felolvasás közvetlenül a hangszóróra megy', names(c.tts.out), ['hangszóró']);
  is('a felolvasás NEM megy át a halkításon', c.tts.out.includes(c.gain), false);

  /* félbeszakítás */
  const pending = call({ type: 'play', audio: Buffer.from('hosszú').toString('base64') });
  await new Promise(r2 => setTimeout(r2, 1));
  await call({ type: 'hush' });
  is('a félbeszakított felolvasás is válaszol (nem akad el a sor)', (await pending).ok, true);

  await call({ type: 'stop' });
  is('leállításkor az AudioContext lezárul', c.state, 'closed');
  is('leállítás után a felolvasás újra "off"', (await call({ type: 'play', audio: 'AAAA' })).reason, 'off');

  console.log(fail ? '\n' + fail + ' teszt bukott' : '\nMinden teszt átment');
  process.exit(fail ? 1 : 0);
})();
