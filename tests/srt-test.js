/* Az .srt készítő (lib/srt.js) tesztje — a 2026-10-05-i my.unyte.com átirat
   soraival. Futtatás: node tests/srt-test.js */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'srt.js'), 'utf8');
const g = { LFT: {} };
new Function('globalThis', 'LFT', src)(g, g.LFT);
const S = g.LFT.srt;

let fail = 0;
function is(nev, kapott, vart) {
  const ok = JSON.stringify(kapott) === JSON.stringify(vart);
  if (!ok) fail++;
  console.log((ok ? 'OK   ' : 'HIBA ') + nev);
  if (!ok) console.log('       kapott: ' + JSON.stringify(kapott) + '\n       várt:   ' + JSON.stringify(vart));
}

/* SRT visszaolvasása, hogy a szerkezetet ellenőrizni tudjuk */
function parse(text) {
  return text.split(/\r\n\r\n/).filter(b => b.trim()).map(b => {
    const ls = b.split('\r\n').filter(x => x !== '');
    const [a, z] = ls[1].split(' --> ');
    const sec = s => { const m = /^(\d\d):(\d\d):(\d\d),(\d\d\d)$/.exec(s); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000 : NaN; };
    return { n: +ls[0], start: sec(a), end: sec(z), text: ls.slice(2) };
  });
}

const T = 1759684380000;   // falióra, mindegy mennyi
const real = [
  { t: T, videoTime: 11, src: 'Hello, and welcome.', hu: 'Helló, és üdvözlünk!' },
  { t: T + 2000, videoTime: 13, src: "We've created this short intro video to help you get started offering the Safe and Sound Protocol to your clients.",
    hu: 'Ezt a rövid bemutatóvideót azért készítettük, hogy segítsünk elkezdeni a Safe and Sound Protocol nyújtását az ügyfeleinek.' },
  { t: T + 8000, videoTime: 19, src: 'Digital delivery of SSP consists of two parts.', hu: 'Az SSP digitális szállítása két részből áll.' },
  { t: T + 13000, videoTime: 24, src: 'The Unyte ILS app and MyUnyte.', hu: 'Az Unyte ILS alkalmazás és a MyUnyte.' }
];

/* ---------- időformátum ---------- */
is('időbélyeg formátum', S.ts(83.4), '00:01:23,400');
is('óra is', S.ts(3723.007), '01:02:03,007');
is('negatív helyett nulla', S.ts(-5), '00:00:00,000');

/* ---------- szerkezet ---------- */
{
  const out = S.build(real, { mode: 'target' });
  const cues = parse(out);
  is('sorszámozás 1-től folyamatos', cues.map(c => c.n), cues.map((_, i) => i + 1));
  is('CRLF sorvégek, üres sorral elválasztva', /^1\r\n\d\d:\d\d:\d\d,\d{3} --> \d\d:\d\d:\d\d,\d{3}\r\n/.test(out), true);
  is('az első felirat a videó 11. másodpercénél indul', cues[0].start, 11);
  is('az első felirat a következő előtt véget ér', cues[0].end <= 13, true);
  is('rövid szöveg is legalább 1,2 mp-ig látszik', cues[0].end - cues[0].start >= 1.2 - 1e-9 || cues[0].end === 13 - 0.05, true);
  is('fordítás mód: a magyar szöveg', cues[0].text, ['Helló, és üdvözlünk!']);
  is('egy sor sem hosszabb 42 karakternél', cues.every(c => c.text.every(l => l.length <= 42)), true);
  is('egy kocka legfeljebb 2 sor', cues.every(c => c.text.length <= 2), true);
  is('a feliratok nem fedik egymást', cues.every((c, i) => i === 0 || cues[i - 1].end <= c.start + 1e-9), true);
  is('minden felirat vége a kezdete után van', cues.every(c => c.end > c.start), true);
  const long = cues.filter(c => c.start >= 13 && c.start < 19);
  is('a hosszú mondat több kockára bomlik', long.length >= 2, true);
  is('… és együtt kiadják a teljes mondatot', long.map(c => c.text.join(' ')).join(' '), real[1].hu);
  is('… és a kockák egymást követik', long.every((c, i) => i === 0 || Math.abs(long[i - 1].end - c.start) < 1e-6), true);
}

/* ---------- hosszú sor (a 2026-10-05-i átirat 2:04-es, egyperces sora) ---------- */
{
  const huge = 'Az Unyte ILS alkalmazás az SSP-lejátszási listák lejátszási felülete, és leegyszerűsítve lejátszónak tekinthető. ' +
    'Ugyanezen alkalmazáson keresztül Ön és ügyfelei állítsák be a hangerőt megfelelő szintre. Az alkalmazás felkéri Önt a hangerő beállítására. ' +
    'A munkamenet megkezdése előtt állítsa be a hangerőt úgy, hogy a zene a legkisebb kényelmes szinten szóljon, és tartsa ezen a szinten a munkamenet teljes ideje alatt. ' +
    'A munkamenet közben ne állítsa át a hangerőt.';
  const cues = parse(S.build([{ t: T, videoTime: 124, src: 'x', hu: huge }]));
  is('nagyon hosszú utolsó sor: minden kocka legalább 1,2 mp', cues.every(c => c.end - c.start >= 1.2 - 1e-6), true);
  is('… és egyik sem tovább 7 mp-nél', cues.every(c => c.end - c.start <= 7 + 1e-6), true);
  is('… és együtt kiadják a teljes szöveget', cues.map(c => c.text.join(' ')).join(' '), huge);

  const squeezed = parse(S.build([
    { t: T, videoTime: 124, src: 'x', hu: huge },
    { t: T, videoTime: 130, src: 'y', hu: 'Következő.' }
  ]));
  const first = squeezed.filter(c => c.start < 130);
  is('ha a következő felirat közel van, ott véget ér (nem lóg rá)', first[first.length - 1].end <= 130 - 0.05 + 1e-6, true);
}

/* ---------- módok ---------- */
{
  const cues = parse(S.build(real.slice(0, 1), { mode: 'source' }));
  is('eredeti mód', cues[0].text, ['Hello, and welcome.']);
  const both = parse(S.build(real.slice(0, 1), { mode: 'both' }));
  is('kétnyelvű: fordítás, alatta dőlten az eredeti', both[0].text, ['Helló, és üdvözlünk!', '<i>Hello, and welcome.</i>']);
  const missing = parse(S.build([{ t: T, videoTime: 5, src: 'Untranslated line.', hu: null }], { mode: 'target' }));
  is('ha nincs fordítás, az eredeti kerül bele (ne legyen lyuk)', missing[0].text, ['Untranslated line.']);
}

/* ---------- tekerés és hiányzó idő ---------- */
{
  const seeked = [
    { t: T, videoTime: 120, src: 'Later part.', hu: 'Későbbi rész.' },
    { t: T + 5000, videoTime: 10, src: 'Rewound.', hu: 'Visszatekerve.' }
  ];
  is('visszatekerés után videóidő szerint rendez', parse(S.build(seeked)).map(c => c.text[0]), ['Visszatekerve.', 'Későbbi rész.']);

  const noVideo = [
    { t: T, videoTime: null, src: 'A.', hu: 'A.' },
    { t: T + 4000, videoTime: null, src: 'B.', hu: 'B.' }
  ];
  is('videóidő nélkül a felvétel kezdetétől', parse(S.build(noVideo)).map(c => c.start), [0, 4]);

  const mixed = [
    { t: T, videoTime: 50, src: 'A.', hu: 'A.' },
    { t: T + 3000, videoTime: null, src: 'B.', hu: 'B.' }
  ];
  is('hiányzó idő a legközelebbi ismert sorból', parse(S.build(mixed)).map(c => c.start), [50, 53]);
  is('startTimes: az első ismert előtti sor visszafelé', S.startTimes([
    { t: T, videoTime: null }, { t: T + 2000, videoTime: 30 }]), [28, 30]);
}

/* ---------- tördelés ---------- */
is('a középhez legközelebbi szóközön tör (két sor ~egyforma)',
  S.wrap('Az SSP digitális szállítása két részből áll, és ez fontos.', 42),
  ['Az SSP digitális szállítása', 'két részből áll, és ez fontos.']);
is('ha a középső törés túl hosszú sort adna, olyat választ, ahol mindkét sor kifér',
  S.wrap('Egy nagyon hosszú első szakasz ami jóval túlnyúlik a középen és utána rövid', 42)
    .every(l => l.length <= 42), true);
is('rövid szöveg egy sor', S.wrap('Rövid.', 42), ['Rövid.']);
is('a "-->" nem rontja el a fájlt', S.build([{ t: T, videoTime: 1, src: 'a --> b', hu: 'a --> b' }]).split('-->').length - 1, 1);
is('üres sorok kimaradnak', S.build([{ t: T, videoTime: 1, src: '  ', hu: '' }]), '');
is('üres bemenet', S.build([]), '');

console.log(fail ? '\n' + fail + ' teszt bukott' : '\nMinden teszt átment');
process.exit(fail ? 1 : 0);
