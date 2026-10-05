/* A kulcstisztítás tesztje: az igazi lib/deepl.js és lib/tts.js függvényeit
   emeljük ki, így a teszt nem tud elcsúszni a forrástól.
   Futtatás: node tests/key-test.js */
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
function junkLine(file) {
  return /const JUNK = .*/.exec(fs.readFileSync(ROOT + file, 'utf8'))[0];
}

let fail = 0;
function is(nev, kapott, vart) {
  const ok = JSON.stringify(kapott) === JSON.stringify(vart);
  if (!ok) fail++;
  console.log((ok ? 'OK   ' : 'HIBA ') + nev);
  if (!ok) console.log('       kapott: ' + JSON.stringify(kapott) + '  várt: ' + JSON.stringify(vart));
}

const dl = new Function(
  junkLine('lib/deepl.js') + '\n' +
  extract('lib/deepl.js', 'cleanKey') + '\n' +
  extract('lib/deepl.js', 'keyCharProblem') + '\n' +
  extract('lib/deepl.js', 'endpointFor') + '\n' +
  'return { cleanKey, keyCharProblem, endpointFor };')();

const JO = '12345678-1234-1234-1234-123456789abc:fx';

/* --- tisztítás --- */
is('tiszta kulcs változatlan', dl.cleanKey(JO), JO);
is('zero-width space kiesik', dl.cleanKey('12345678-1234-1234​-1234-123456789abc:fx'), JO);
is('sortörés kiesik', dl.cleanKey('12345678-1234-1234-1234-123456789abc:fx\n'), JO);
is('belső sortörés kiesik', dl.cleanKey('12345678-1234\n-1234-1234-123456789abc:fx'), JO);
is('nem törhető szóköz kiesik', dl.cleanKey('12345678-1234-1234-1234-123456789abc :fx'), JO);
is('BOM kiesik', dl.cleanKey('﻿' + JO), JO);
is('soft hyphen kiesik', dl.cleanKey('12345678-1234-1234-1234-123456789abc­:fx'), JO);
is('szóköz mindkét oldalon kiesik', dl.cleanKey('   ' + JO + '  '), JO);
is('üres bemenet', dl.cleanKey(null), '');

/* --- az endpoint a tisztított kulcsból dől el --- */
is('láthatatlan karakter után is a Free végpont',
  dl.endpointFor(JO + '​'), 'https://api-free.deepl.com');
is('sortörés után is a Free végpont',
  dl.endpointFor(JO + '\n'), 'https://api-free.deepl.com');
is('Pro kulcs a fizetős végpontra megy',
  dl.endpointFor('12345678-1234-1234-1234-123456789abc'), 'https://api.deepl.com');

/* --- ami tisztítás után is rossz, arra konkrét hibát adunk --- */
is('tisztított kulcs rendben', dl.keyCharProblem(dl.cleanKey(JO)), false);
is('ékezetes karakter hibát ad', dl.keyCharProblem(dl.cleanKey('kulcs-á-123:fx')), true);
is('cirill karakter hibát ad', dl.keyCharProblem(dl.cleanKey('1234-абв-5678:fx')), true);

/* --- a lényeg: a tisztított kulcs már elmegy fejlécben --- */
const esetek = {
  'zero-width space': '12345678-1234-1234​-1234-123456789abc:fx',
  'sortörés':         '12345678-1234\n-1234-1234-123456789abc:fx',
  'BOM':              '﻿' + JO,
  'NBSP':             '12345678-1234-1234-1234-123456789abc :fx'
};
for (const [nev, k] of Object.entries(esetek)) {
  let ok = false;
  try { new Headers({ Authorization: 'DeepL-Auth-Key ' + dl.cleanKey(k) }); ok = true; }
  catch (e) { ok = false; }
  is('tisztítás után elmegy fejlécben — ' + nev, ok, true);
  if (nev === 'zero-width space' || nev === 'sortörés') {
    let elbukott = false;
    try { new Headers({ Authorization: 'DeepL-Auth-Key ' + String(k).trim() }); }
    catch (e) { elbukott = true; }
    is('  tisztítás nélkül elbukott volna — ' + nev, elbukott, true);
  }
}

/* --- ugyanez a TTS oldalon --- */
const tts = new Function(
  junkLine('lib/tts.js') + '\n' +
  extract('lib/tts.js', 'cleanKey') + '\n' +
  extract('lib/tts.js', 'keyCharProblem') + '\n' +
  'return { cleanKey, keyCharProblem };')();
is('TTS: zero-width space kiesik', tts.cleanKey('AIza​SyABC-123_xyz'), 'AIzaSyABC-123_xyz');
is('TTS: tiszta kulcs rendben', tts.keyCharProblem(tts.cleanKey('AIzaSyABC-123_xyz')), false);

console.log(fail ? '\n' + fail + ' teszt bukott' : '\nMinden teszt átment');
process.exit(fail ? 1 : 0);
