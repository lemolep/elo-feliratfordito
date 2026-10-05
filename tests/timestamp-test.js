/* Az időkód-szűrés tesztje: az igazi lib/segmenter.js-t töltjük be, és a
   valódi LFT.normalizeText-et hívjuk.
   Futtatás: node tests/timestamp-test.js */
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'lib', 'segmenter.js');
new Function(fs.readFileSync(file, 'utf8'))();
const n = globalThis.LFT.normalizeText;

let fail = 0;
function is(nev, kapott, vart) {
  const ok = kapott === vart;
  if (!ok) fail++;
  console.log((ok ? 'OK   ' : 'HIBA ') + nev);
  if (!ok) console.log('       kapott: ' + JSON.stringify(kapott) +
                       '\n       várt:   ' + JSON.stringify(vart));
}

/* --- amit ki KELL szedni --- */
is('YouTube átirat-panel (időkód külön sorban)',
  n('0:12\nHello everyone, welcome back\n0:15\nToday we are talking about'),
  'Hello everyone, welcome back Today we are talking about');
is('időkód a sor elején, szóközzel', n('0:12  Hello everyone'), 'Hello everyone');
is('hosszú videó, óra is van', n('1:02:33\tWelcome back'), 'Welcome back');
is('szögletes zárójel bárhol', n('Intro [00:01:23] and then we begin'), 'Intro and then we begin');
is('kerek zárójel', n('(0:45) Second chapter'), 'Second chapter');
is('.srt tartomány', n('00:00:12,340 --> 00:00:15,000\nHello there'), 'Hello there');
is('csak időkód -> üres', n('0:12\n0:15\n'), '');
is('több soros átirat egyben', n('00:00\nOne.\n00:04\nTwo.\n00:09\nThree.'), 'One. Two. Three.');

/* --- amit NEM szabad kiszedni --- */
is('beszédben elhangzó óraidő (AM/PM)', n('3:30 PM is when we meet'), '3:30 PM is when we meet');
is('időpont a mondat közepén', n('We meet at 3:30 tomorrow'), 'We meet at 3:30 tomorrow');
is('arány/eredmény a mondat közepén', n('The score was 2:1 at half time'), 'The score was 2:1 at half time');
is('sima felirat változatlan', n('Hello everyone, welcome back.'), 'Hello everyone, welcome back.');
is('AMD nem AM', n('12:30 AMD processors'), 'AMD processors');

/* --- a gördülésfelismerés is javul tőle --- */
const a = n('0:12\nHello everyone');
const b = n('0:12\nHello everyone\n0:15\nwelcome back');
is('az időkód nélkül a növekedés látszik', String(b.startsWith(a)), 'true');

console.log(fail ? '\n' + fail + ' teszt bukott' : '\nMinden teszt átment');
process.exit(fail ? 1 : 0);
