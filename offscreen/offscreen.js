/* Offscreen dokumentum: a lap hangfolyama itt él.

   A tabCapture a rögzítés idejére ELNÉMÍTJA a lapot — a hang onnantól a mi
   folyamunkon megy. Ezért az első dolgunk visszakötni a hangszóróra
   (ctx.destination), különben a felhasználó semmit nem hallana.

   Mostani állapot (2. lépés): a hangot visszavezetjük, és másodpercenként
   visszajelezzük a hangszintet — ebből látszik, hogy tényleg jön adat.
   A Deepgram felé küldés a következő lépésekben kerül ide. */
'use strict';

let stream = null;
let ctx = null;
let levelTimer = null;
let tabId = null;

function send(msg) {
  try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch (e) { /* nincs fogadó */ }
}

async function start(streamId, forTab) {
  await stop(false);
  tabId = forTab;

  stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false
  });

  ctx = new AudioContext();
  if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) { /* jelentjük lent */ } }

  const src = ctx.createMediaStreamSource(stream);
  src.connect(ctx.destination);               // vissza a hangszóróra — enélkül néma a lap

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

  return { ok: true, state: ctx.state };
}

async function stop(notify) {
  clearInterval(levelTimer);
  levelTimer = null;
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  if (ctx) { try { await ctx.close(); } catch (e) {} }
  ctx = null;
  if (notify && tabId != null) send({ type: 'tabaudio:ended', tabId: tabId });
  tabId = null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return;
  if (msg.type === 'start') {
    start(msg.streamId, msg.tabId)
      .then(sendResponse)
      .catch(e => sendResponse({ ok: false, error: (e && e.message) || String(e) }));
    return true;
  }
  if (msg.type === 'stop') {
    stop(false).then(() => sendResponse({ ok: true }));
    return true;
  }
});
