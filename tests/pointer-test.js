/* A húzás/átméretezés követésének tesztje (content/overlay.js trackPointer).
   A hiba, amit véd: ha az egér a Vimeo-keret fölött engedik fel, a lap nem
   látja a felengedést, és az ablak gomb nélkül is tovább méreteződik.
   Futtatás: node tests/pointer-test.js */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'content', 'overlay.js'), 'utf8');

function extract(name) {
  const start = src.indexOf('function ' + name + '(');
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

function emitter() {
  const ls = {};
  return {
    ls,
    addEventListener(t, fn) { (ls[t] = ls[t] || []).push(fn); },
    removeEventListener(t, fn) { ls[t] = (ls[t] || []).filter(f => f !== fn); },
    fire(t, ev) { (ls[t] || []).slice().forEach(f => f(ev || {})); },
    count() { return Object.values(ls).reduce((n, a) => n + a.length, 0); }
  };
}

function setup() {
  const win = emitter();
  const target = Object.assign(emitter(), {
    captured: null,
    setPointerCapture(id) { this.captured = id; },
    releasePointerCapture() { this.captured = null; }
  });
  const shields = [];
  const doc = {
    createElement: () => { const d = { style: {}, removed: false, remove() { this.removed = true; } }; shields.push(d); return d; },
    documentElement: { appendChild: () => {} }
  };
  const track = new Function('window', 'document', 'getComputedStyle',
    extract('trackPointer') + '\nreturn trackPointer;')(win, doc, () => ({ cursor: 'nwse-resize' }));
  const moves = [];
  let ends = 0;
  track({ currentTarget: target, pointerId: 7 }, ev => moves.push(ev.clientX), () => ends++);
  return { win, target, shields, moves, end: () => ends };
}

/* rendes húzás */
{
  const t = setup();
  is('elkapja az egeret', t.target.captured, 7);
  is('a takaró kirakva, a fogantyú kurzorával', [t.shields.length, t.shields[0].style.cssText.includes('nwse-resize')], [1, true]);
  t.win.fire('pointermove', { pointerId: 7, buttons: 1, clientX: 10 });
  t.win.fire('pointermove', { pointerId: 8, buttons: 1, clientX: 99 });
  is('csak a saját mutatót követi', t.moves, [10]);
  t.win.fire('pointerup', { pointerId: 7 });
  is('felengedéskor vége', t.end(), 1);
  is('a takaró eltűnik', t.shields[0].removed, true);
  is('az egérfogás elengedve', t.target.captured, null);
  is('minden figyelő leszedve', t.win.count() + t.target.count(), 0);
  t.win.fire('pointermove', { pointerId: 7, buttons: 1, clientX: 50 });
  is('vége után nem mozdít', t.moves, [10]);
}

/* a beragadás: a felengedés a Vimeo-keret fölött elveszett */
{
  const t = setup();
  t.win.fire('pointermove', { pointerId: 7, buttons: 1, clientX: 10 });
  t.win.fire('pointermove', { pointerId: 7, buttons: 0, clientX: 300 });   // visszaér, gomb már nincs lenyomva
  is('gomb nélküli mozgásnál azonnal vége, nem méretez tovább', [t.moves, t.end()], [[10], 1]);
  is('a takaró eltűnik', t.shields[0].removed, true);
}

/* egyéb kilépések */
for (const [nev, fire] of [
  ['pointercancel', t => t.win.fire('pointercancel')],
  ['ablakváltás (blur)', t => t.win.fire('blur')],
  ['elvesztett egérfogás', t => t.target.fire('lostpointercapture')]
]) {
  const t = setup();
  fire(t);
  is(nev + ': vége, takaró eltűnik', [t.end(), t.shields[0].removed], [1, true]);
  t.win.fire('pointerup', { pointerId: 7 });
  is(nev + ': a befejezés csak egyszer fut', t.end(), 1);
}

console.log(fail ? '\n' + fail + ' teszt bukott' : '\nMinden teszt átment');
process.exit(fail ? 1 : 0);
