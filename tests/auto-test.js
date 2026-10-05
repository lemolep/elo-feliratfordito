/* Az automatikus mód tesztje: "minden oldal" engedélyminta, sávválasztás,
   kényszerített bekapcsolás és visszaállítás, ismert lejátszók felismerése.
   Futtatás: node tests/auto-test.js */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..') + '/';

function extract(file, name) {
  const src = fs.readFileSync(ROOT + file, 'utf8');
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('nincs meg: ' + name + ' (' + file + ')');
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

/* ---------- 1. patternFor / hostMatches a "*"-ra ---------- */
const swFns = new Function('ALL_SITES',
  extract('background/service-worker.js', 'patternFor') + '\n' +
  extract('background/service-worker.js', 'hostMatches') + '\n' +
  'return { patternFor, hostMatches };')('*');

is('patternFor("*")', swFns.patternFor('*'), '*://*/*');
is('patternFor("youtube.com")', swFns.patternFor('youtube.com'), '*://*.youtube.com/*');
is('hostMatches bármire "*"-gal', swFns.hostMatches('barmi.example.org', '*'), true);
is('hostMatches pontos', swFns.hostMatches('www.youtube.com', 'youtube.com'), true);
is('hostMatches idegen', swFns.hostMatches('example.com', 'youtube.com'), false);

for (const f of ['popup/popup.js', 'options/options.js']) {
  const pf = new Function(extract(f, 'patternFor') + '\nreturn patternFor;')();
  is(f + ' patternFor("*")', pf('*'), '*://*/*');
  is(f + ' patternFor(host)', pf('Example.COM'), '*://*.example.com/*');
}

/* ---------- 2. sávválasztás és kényszerített bekapcsolás ---------- */
function track(kind, mode, id) { return { kind: kind, mode: mode, id: id, addEventListener() {} }; }
function videoWith(tracks) {
  const list = tracks.slice();
  list.addEventListener = () => {};
  return { textTracks: list };
}
const TRACK_FNS =
  extract('content/capture.js', 'isCaptionTrack') + '\n' +
  extract('content/capture.js', 'pickTrack') + '\n' +
  extract('content/capture.js', 'scanTextTracks') + '\n' +
  extract('content/capture.js', 'restoreTracks') + '\n';

function makeCapture(videos, autoTrackOn, onBind) {
  const forcedTracks = new Set();
  const doc = { querySelectorAll: sel => (sel === 'video' ? videos : []) };
  return new Function('document', 'forcedTracks', 'bindTrack', 'autoTrack',
    TRACK_FNS + 'return { pickTrack, scanTextTracks, restoreTracks, forcedTracks };')(
    doc, forcedTracks, onBind || (() => {}), autoTrackOn);
}

{
  const v = videoWith([track('subtitles', 'disabled', 'a'), track('captions', 'showing', 'b'), track('subtitles', 'hidden', 'c')]);
  is('showing sávot választ', makeCapture([v], true).pickTrack(v.textTracks).id, 'b');
}
{
  const v = videoWith([track('subtitles', 'disabled', 'a'), track('subtitles', 'hidden', 'c')]);
  is('hidden sávot választ', makeCapture([v], true).pickTrack(v.textTracks).id, 'c');
}
{
  const v = videoWith([track('descriptions', 'showing', 'd'), track('metadata', 'showing', 'm'), track('subtitles', 'disabled', 's')]);
  is('csak felirat-sávot vesz figyelembe', makeCapture([v], true).pickTrack(v.textTracks).id, 's');
}
{
  const t = track('subtitles', 'disabled', 'x');
  const c = makeCapture([videoWith([t])], true);
  const active = c.scanTextTracks(true);
  is('bekapcsolta a kikapcsolt sávot', t.mode, 'hidden');
  is('aktívnak számolja', active, 1);
  c.restoreTracks();
  is('leállításkor visszakapcsolja', t.mode, 'disabled');
  is('a visszaállítás után üres a nyilvántartás', c.forcedTracks.size, 0);
}
{
  const t = track('subtitles', 'disabled', 'x');
  const c = makeCapture([videoWith([t])], false);
  const active = c.scanTextTracks(false);
  is('autoTrack kikapcsolva: nem nyúl a sávhoz', t.mode, 'disabled');
  is('autoTrack kikapcsolva: nincs aktív sáv', active, 0);
}
{
  const t = track('subtitles', 'showing', 'x');
  const c = makeCapture([videoWith([t])], true);
  c.scanTextTracks(true);
  is('a látszó sávhoz nem nyúl', t.mode, 'showing');
  c.restoreTracks();
  is('nem kapcsolja ki, amit nem mi kapcsoltunk be', t.mode, 'showing');
}
{
  const bound = [];
  const t1 = track('subtitles', 'showing', 'v1a');
  const t2 = track('subtitles', 'showing', 'v1b');
  const t3 = track('subtitles', 'showing', 'v2a');
  const c = makeCapture([videoWith([t1, t2]), videoWith([t3])], true, tr => bound.push(tr.id));
  c.scanTextTracks(true);
  is('videónként pontosan egy sávot köt be', bound, ['v1a', 'v2a']);
}

/* ---------- 3. ismert lejátszók felismerése ---------- */
{
  const src = fs.readFileSync(ROOT + 'content/capture.js', 'utf8');
  const known = /const KNOWN_SELECTORS = \[([\s\S]*?)\];/.exec(src)[0];
  const mk = doc => new Function('document', known + '\n' +
    extract('content/capture.js', 'findKnownCaptionEl') + '\nreturn findKnownCaptionEl;')(doc);
  const yt = mk({ querySelector: sel => (sel === '.ytp-caption-window-container' ? { tag: 'yt' } : null) });
  is('megtalálja a YouTube felirat-konténerét', yt().selector, '.ytp-caption-window-container');
  is('ismeretlen oldalon nem talál semmit', mk({ querySelector: () => null })(), null);
}

console.log(fail ? '\n' + fail + ' teszt bukott' : '\nMinden teszt átment');
process.exit(fail ? 1 : 0);
