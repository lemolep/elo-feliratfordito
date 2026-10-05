/* A diagnosztika tesztje: ne ajánljon fel engedélyt arra, amire már van,
   és a láthatatlan segédkereteket (fizetés, analitika) ne listázza.
   Futtatás: node tests/diag-test.js */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..') + '/';

function extract(file, name) {
  const src = fs.readFileSync(ROOT + file, 'utf8');
  let start = src.indexOf('async function ' + name + '(');
  if (start < 0) start = src.indexOf('function ' + name + '(');
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

/* ---------- alreadyAllowed ---------- */
const patternFor = h => (h === '*' ? '*://*/*' : '*://*.' + h.toLowerCase() + '/*');
const granted = new Set([patternFor('js.stripe.com'), patternFor('home.academy.unyte.com')]);
const chromeMock = { permissions: { contains: async o => granted.has(o.origins[0]) } };
let allSitesOn = false;
const alreadyAllowed = new Function('patternFor', 'chrome', 'hasAllSites',
  extract('popup/popup.js', 'alreadyAllowed') + '\nreturn alreadyAllowed;')(
  patternFor, chromeMock, async () => allSitesOn);

/* A felhasználó képernyőképén látott állapot (2026-09-10) */
const frames = [
  { frame: '', iframes: { list: [
      { host: 'home.academy.unyte.com', area: 400000 },
      { host: 'js.stripe.com', area: 0 },
      { host: 'valami.uj.hu', area: 60000 }
    ], unknown: 3 } },
  { frame: 'js.stripe.com', iframes: { list: [], unknown: 0 } },
  { frame: 'home.academy.unyte.com', iframes: { list: [], unknown: 0 } }
];
const offerOf = (skip, list) => (skip.has('*') ? [] : list.filter(it => !skip.has(it.host.toLowerCase())));

(async () => {
  const skip = await alreadyAllowed(frames);
  is('a már engedélyezett hostok kimaradnak', [...skip].sort(), ['home.academy.unyte.com', 'js.stripe.com']);
  is('csak az új host marad felajánlva', offerOf(skip, frames[0].iframes.list).map(o => o.host), ['valami.uj.hu']);

  const two = frames[0].iframes.list.slice(0, 2);
  const skip2 = await alreadyAllowed([{ frame: '', iframes: { list: two, unknown: 3 } }, frames[1], frames[2]]);
  is('ha minden engedélyezve: 0 gomb', offerOf(skip2, two).length, 0);

  allSitesOn = true;
  const skip3 = await alreadyAllowed(frames);
  is('ha mindenre van engedély: 0 gomb', offerOf(skip3, frames[0].iframes.list).length, 0);
  allSitesOn = false;

  /* ---------- listIframes ---------- */
  const capSrc = fs.readFileSync(ROOT + 'content/capture.js', 'utf8');
  const minArea = Number(/MIN_FRAME_AREA\s*=\s*(\d+)/.exec(capSrc)[1]);
  const mkList = iframes => new Function('document', 'location', 'URL', 'MIN_FRAME_AREA',
    extract('content/capture.js', 'listIframes') + '\nreturn listIframes;')(
    { querySelectorAll: () => iframes.map(f => ({
        getAttribute: () => f.src,
        getBoundingClientRect: () => ({ width: f.w, height: f.h })
      })) },
    { href: 'https://academy.unyte.com/' }, URL, minArea)();

  const r = mkList([
    { src: 'https://js.stripe.com/x', w: 0, h: 0 },
    { src: 'https://home.academy.unyte.com/p', w: 20, h: 20 },
    { src: 'https://home.academy.unyte.com/p', w: 800, h: 450 },
    { src: '', w: 100, h: 100 },
    { src: 'https://ads.example.com/a', w: 1, h: 1 }
  ]);
  is('csak a nagy keret marad, hostonként a legnagyobb', r.list, [{ host: 'home.academy.unyte.com', area: 360000 }]);
  is('az ismeretlen forrású keret számolva', r.unknown, 1);

  /* A my.unyte.com Resources oldal valódi keretei (2026-10-05, mérve) */
  const u = mkList([
    { src: 'https://player.vimeo.com/video/460353308', w: 1657, h: 686 },
    { src: '//player.vimeo.com/video/649132437', w: 812, h: 360 },
    { src: 'https://js.stripe.com/v3/m-outer-3437.html', w: 1920, h: 1 }
  ]);
  is('my.unyte.com: a 1920×1-es Stripe-keret kiesik', u.list.map(x => x.host), ['player.vimeo.com']);

  console.log(fail ? '\n' + fail + ' teszt bukott' : '\nMinden teszt átment');
  process.exit(fail ? 1 : 0);
})();
