/* A hang mód bekötésének tesztje: az igazi content/overlay.js függvényeit
   futtatjuk hamis környezetben. Amit ellenőrzünk:
     - csak a VÉGLEGES találat megy fordításra, a köztes nem (DeepL keret);
     - bekapcsoláskor elindul a rögzítés, ha még nem fut;
     - hang módban a feliratkeresés szünetel (különben dupla mondatok jönnének),
       kikapcsoláskor folytatódik.
   Futtatás: node tests/audio-mode-test.js */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'content', 'overlay.js'), 'utf8');
const sentencesSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'sentences.js'), 'utf8');

function extract(name) {
  let start = src.indexOf('async function ' + name + '(');
  if (start < 0) start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('nincs meg: ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}

let fail = 0;
function is(nev, kapott, vart) {
  const ok = JSON.stringify(kapott) === JSON.stringify(vart);
  if (!ok) fail++;
  console.log((ok ? 'OK   ' : 'HIBA ') + nev);
  if (!ok) console.log('       kapott: ' + JSON.stringify(kapott) + '  várt: ' + JSON.stringify(vart));
}

/* video: null (nincs a felső keretben) vagy { time, paused }; vimeo: amit a Vimeo-figyelő ad */
function world(recordingAtStart, video, vimeo) {
  const code = `
    let tabAudioOn = false, sttLive = false, stopping = false, recording = ${recordingAtStart};
    const calls = [], segs = [];
    function setTabAudioUi(on) { tabAudioOn = on; if (!on) sttLive = false; }
    function setVisible() {}
    async function startRec() { calls.push('startRec'); recording = true; }
    function bg(m) { calls.push(m.type + (m.payload ? ':' + m.payload.type : '')); return Promise.resolve({ ok: true }); }
    const settings = { flushDelay: 1200 };
    const el = { interim: { textContent: '', hidden: true } };
    function scrollIfStuck() {}
    function onSegment(p) { segs.push(p); }
    const document = { querySelector: () => (${video ? '{ currentTime: ' + video.time + ', paused: ' + !!video.paused + ' }' : 'null'}) };
    const watched = [];
    const LFT = { vimeo: { now: () => (${JSON.stringify(vimeo || null)}), watch: on => watched.push(on) } };
    ${sentencesSrc}
    let joiner = null;
    ${extract('sttJoiner')}
    ${extract('sttFlush')}
    ${extract('onTabAudioChanged')}
    ${extract('onSttResult')}
    ${extract('showInterim')}
    ${extract('currentVideo')}
    ${extract('speechVideoTime')}
    return { onTabAudioChanged, onSttResult, sttFlush, calls, segs, el, watched, st: () => ({ tabAudioOn, recording }) };`;
  return new Function(code)();
}

(async () => {
  /* ---------- csak a végleges megy fordításra ---------- */
  {
    const w = world(true, null);
    w.onSttResult({ text: 'Welcome to', final: false });
    w.onSttResult({ text: 'Welcome to the Safe', final: false });
    is('köztes találat: nem megy fordításra', w.segs.length, 0);
    is('köztes találat: a halvány sorban látszik', [w.el.interim.textContent, w.el.interim.hidden], ['Welcome to the Safe', false]);

    w.onSttResult({ text: 'Welcome to the Safe and Sound Protocol.', final: true });
    is('végleges találat: pontosan egyszer megy fordításra', w.segs.map(s => s.text), ['Welcome to the Safe and Sound Protocol.']);
    is('végleges után a halvány sor eltűnik', [w.el.interim.textContent, w.el.interim.hidden], ['', true]);
    is('a lejátszó keretben van: nincs videóidő', w.segs[0].videoTime, null);

    w.onSttResult({ text: '', final: true });
    is('üres végleges: nem megy fordításra', w.segs.length, 1);
  }
  {
    const w = world(true, { time: 83.4 });
    w.onSttResult({ text: 'Hello.', final: true });
    is('ha a videó a felső keretben van, az ideje bekerül', w.segs[0].videoTime, 83.4);
  }

  /* ---------- visszaszámolás a mondat kezdetére ---------- */
  {
    const w = world(true, { time: 100, paused: false });
    const at = Date.now() - 3000;
    w.onSttResult({ text: 'Hello.', final: true, at: at, duration: 2 });
    is('játszás közben a mondat kezdetére számol vissza (≈97 mp)', Math.round(w.segs[0].videoTime), 97);
    is('a sor ideje a mondat kezdete', w.segs[0].t, at);
  }
  {
    const w = world(true, { time: 100, paused: true });
    w.onSttResult({ text: 'Hello.', final: true, at: Date.now() - 9000, duration: 2 });
    is('megállított videónál a mondat hosszával számol vissza', w.segs[0].videoTime, 98);
  }
  {
    const w = world(true, { time: 100, paused: false });
    w.onSttResult({ text: 'Hello.', final: true, at: Date.now() - 120000 });
    is('legfeljebb 30 mp-et számol vissza', Math.round(w.segs[0].videoTime), 70);
  }
  {
    const w = world(true, { time: 1, paused: false });
    w.onSttResult({ text: 'Hello.', final: true, at: Date.now() - 5000 });
    is('nem megy nulla alá', w.segs[0].videoTime, 0);
  }
  {
    const w = world(true, null, { time: 42, playing: false });
    w.onSttResult({ text: 'Hello.', final: true, duration: 2 });
    is('Vimeo-keretes lejátszónál a Vimeo idejét használja', w.segs[0].videoTime, 40);
  }

  /* ---------- mondatgyűjtés ---------- */
  {
    const w = world(true, null);
    w.onSttResult({ text: "We've created this short intro video to help", final: true, at: 1000 });
    is('fél mondat: még nem megy fordításra', w.segs.length, 0);
    is('fél mondat: a halvány sorban látszik', w.el.interim.textContent, "We've created this short intro video to help");
    w.onSttResult({ text: 'you get started', final: false });
    is('köztes: a gyűjtött rész mögé kerül a halvány sorban', w.el.interim.textContent, "We've created this short intro video to help you get started");
    w.onSttResult({ text: 'you get started offering the protocol.', final: true, at: 4000 });
    is('mondatvégnél egy mondatként megy fordításra',
      w.segs.map(x => x.text), ["We've created this short intro video to help you get started offering the protocol."]);
    is('a sor ideje az első szakasz kezdete', w.segs[0].t, 1000);
  }
  {
    const w = world(false, null);
    await w.onTabAudioChanged(true);
    w.onSttResult({ text: 'and assign programs to remote clients', final: true, at: 1 });
    await w.onTabAudioChanged(false);
    is('kikapcsoláskor a félkész mondat sem vész el', w.segs.map(x => x.text), ['and assign programs to remote clients']);
  }

  /* ---------- be- és kikapcsolás ---------- */
  {
    const w = world(false, null);
    await w.onTabAudioChanged(true);
    is('bekapcsolás rögzítés nélkül: elindul a rögzítés', w.calls, ['startRec']);
    is('állapot', w.st(), { tabAudioOn: true, recording: true });

    await w.onTabAudioChanged(true);
    is('második bekapcsolás: nem indít újra semmit', w.calls, ['startRec']);
    is('bekapcsoláskor a Vimeo-figyelő is indul', w.watched, [true]);

    w.calls.length = 0;
    await w.onTabAudioChanged(false);
    is('kikapcsolás futó rögzítésnél: a feliratkeresés folytatódik', w.calls, ['relay:frames:capture:start']);
  }
  {
    const w = world(true, null);
    await w.onTabAudioChanged(true);
    is('bekapcsolás futó rögzítésnél: a feliratkeresés szünetel, új rögzítés nincs', w.calls, ['relay:frames:capture:stop']);
  }
  {
    const w = world(false, null);
    await w.onTabAudioChanged(true);
    w.onSttResult({ text: 'félkész', final: false });
    await w.onTabAudioChanged(false);
    is('kikapcsoláskor a félkész halvány sor eltűnik', w.el.interim.hidden, true);
  }

  /* ---------- a startRec hang módban nem indít feliratkeresést ---------- */
  {
    const startRecSrc = extract('startRec');
    is('a startRec csak hang módon KÍVÜL küld capture:start-ot',
      /if\s*\(\s*!tabAudioOn\s*\)\s*\{\s*await bg\(\{ type: 'relay:frames', payload: \{ type: 'capture:start'/.test(startRecSrc), true);
    const stopRecSrc = extract('stopRec');
    is('a stopRec leállítja a hang módot is (percdíj)', /if \(tabAudioOn\)[\s\S]*tabaudio:stop/.test(stopRecSrc), true);
  }

  console.log(fail ? '\n' + fail + ' teszt bukott' : '\nMinden teszt átment');
  process.exit(fail ? 1 : 0);
})();
