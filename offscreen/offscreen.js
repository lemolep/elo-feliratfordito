/* Offscreen dokumentum: a lap hangfolyama itt él.

   A tabCapture a rögzítés idejére ELNÉMÍTJA a lapot — a hang onnantól a mi
   folyamunkon megy. Ezért az első dolgunk visszakötni a hangszóróra,
   különben a felhasználó semmit nem hallana.

   A hanglánc:

     lap hangja ─┬─ duckGain ──────────────┐
                 └─ elemző (később: STT)   ├─→ hangszóró
     felolvasás ───────────────────────────┘

   - A halkítás (duckGain) CSAK a hangszóróra menő ágon van. A felismerés a
     halkítás előtti ágról kapja a hangot, különben felolvasás közben egy
     elhalkított angolt kellene felismernie.
   - A felolvasás itt szól, NEM a lapon. Az offscreen dokumentum hangja nem
     része a lapnak, tehát a tabCapture nem veszi fel — így a saját magyar
     hangunk nem kerül vissza a felismerésbe. A felolvasás nem megy át a
     halkításon sem. */
'use strict';

let stream = null;
let ctx = null;
let duckGain = null;
let levelTimer = null;
let tabId = null;
let speaking = null;          // { src, done } — épp szóló felolvasás
let rec = null;               // MediaRecorder — a lap hangja webm/opus darabokban
let stt = null;               // élő beszédfelismerő kapcsolat (lib/stt.js)

const CHUNK_MS = 250;         // ilyen darabokban megy a hang a felismerőnek

const DUCK_FADE_S = 0.12;     // rövid átmenet, hogy ne kattanjon

function send(msg) {
  try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch (e) { /* nincs fogadó */ }
}

async function start(streamId, forTab, sttCfg) {
  await stop(false);
  tabId = forTab;

  stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false
  });

  ctx = new AudioContext();
  if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) { /* jelentjük lent */ } }

  const src = ctx.createMediaStreamSource(stream);

  // 1. ág: vissza a hangszóróra, a halkításon át — enélkül néma a lap
  duckGain = ctx.createGain();
  duckGain.gain.value = 1;
  src.connect(duckGain);
  duckGain.connect(ctx.destination);

  // 2. ág: a halkítás ELŐTTI hang — hangszint most, felismerés később
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  src.connect(an);
  const buf = new Float32Array(an.fftSize);

  levelTimer = setInterval(() => {
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    // durva 0–100-as skála: beszédnél jellemzően 10–60 között mozog
    send({ type: 'tabaudio:level', tabId: tabId, level: Math.min(100, Math.round(rms * 300)), state: ctx.state });
  }, 1000);

  // ha a lap újratölt vagy bezárul, a sáv véget ér — ilyenkor mi is leállunk
  stream.getAudioTracks().forEach(t => t.addEventListener('ended', () => stop(true)));

  const sttOn = startStt(sttCfg);
  return { ok: true, state: ctx.state, stt: sttOn };
}

/* ---------------- beszédfelismerés ---------------- */

/* A felvétel a NYERS lap-hangból megy (a MediaRecorder magát a streamet
   kapja, nem a mi hangláncunkat), tehát a halkítás nem érinti, és a
   felolvasás sincs benne — az offscreenben szól, nem a lapon. */
function startStt(cfg) {
  if (!cfg || !cfg.key) {
    send({ type: 'stt:status', tabId: tabId, state: 'off', code: 'nokey' });
    return false;
  }
  const forTab = tabId;
  stt = LFT.stt.open(cfg.provider, cfg, {
    onOpen: () => send({ type: 'stt:status', tabId: forTab, state: 'open' }),
    onResult: r => {
      if (!r.text) return;
      send({ type: 'stt:result', tabId: forTab, text: r.text, final: r.final,
             speechFinal: r.speechFinal, start: r.start, duration: r.duration });
    },
    onClose: ev => {
      const code = LFT.stt.closeToCode(ev);
      send({ type: 'stt:status', tabId: forTab, state: 'closed', code: code, wsCode: ev.code });
      stt = null;
    },
    onError: code => {
      send({ type: 'stt:status', tabId: forTab, state: 'error', code: code });
      stt = null;
    }
  });
  if (!stt) return false;

  rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
  rec.ondataavailable = e => { if (stt) stt.send(e.data); };
  rec.start(CHUNK_MS);
  return true;
}

async function stopStt() {
  if (rec) { try { rec.stop(); } catch (e) {} }
  rec = null;
  if (stt) {
    const s = stt;
    await s.close();          // megvárja a függőben lévő utolsó végleges találatot
  }
  stt = null;
}

async function stop(notify) {
  hush();
  await stopStt();
  clearInterval(levelTimer);
  levelTimer = null;
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  if (ctx) { try { await ctx.close(); } catch (e) {} }
  ctx = null;
  duckGain = null;
  if (notify && tabId != null) send({ type: 'tabaudio:ended', tabId: tabId });
  tabId = null;
}

/* ---------------- halkítás ---------------- */

function rampTo(value) {
  if (!ctx || !duckGain) return;
  const g = duckGain.gain;
  const now = ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(value, now + DUCK_FADE_S);
}

function duck(level) {
  const v = Math.max(0, Math.min(100, level == null ? 20 : Number(level))) / 100;
  rampTo(v);
}

function unduck() { rampTo(1); }

/* ---------------- felolvasás ---------------- */

function b64ToBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/* Lejátssza a felolvasott darabot, és akkor válaszol, amikor véget ért —
   a lebegő ablak sorrendkezelése erre vár, mielőtt a következőt indítaná. */
async function play(b64) {
  if (!ctx) return { ok: false, reason: 'off' };
  hush();
  const audio = await ctx.decodeAudioData(b64ToBuffer(b64));
  return new Promise(resolve => {
    const src = ctx.createBufferSource();
    src.buffer = audio;
    src.connect(ctx.destination);         // közvetlenül, a halkítás nélkül
    const done = () => {
      if (speaking && speaking.src === src) speaking = null;
      resolve({ ok: true });
    };
    speaking = { src: src, done: done };
    src.onended = done;
    src.start();
  });
}

/* Félbeszakítja az épp szóló felolvasást (leállításkor). */
function hush() {
  if (!speaking) return;
  const s = speaking;
  speaking = null;
  try { s.src.onended = null; s.src.stop(); } catch (e) { /* már leállt */ }
  s.done();
}

/* ---------------- üzenetek ---------------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return;
  switch (msg.type) {
    case 'start':
      start(msg.streamId, msg.tabId, msg.stt)
        .then(sendResponse)
        .catch(e => sendResponse({ ok: false, error: (e && e.message) || String(e) }));
      return true;
    case 'stop':
      stop(false).then(() => sendResponse({ ok: true }));
      return true;
    case 'duck':
      duck(msg.level);
      sendResponse({ ok: true });
      return;
    case 'unduck':
      unduck();
      sendResponse({ ok: true });
      return;
    case 'play':
      play(msg.audio)
        .then(sendResponse)
        .catch(e => sendResponse({ ok: false, error: (e && e.message) || String(e) }));
      return true;
    case 'hush':
      hush();
      sendResponse({ ok: true });
      return;
  }
});
