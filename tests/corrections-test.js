/* A hallásjavító lista (lib/corrections.js) tesztje — a 2026-10-05-i
   my.unyte.com átirat hibáival. Futtatás: node tests/corrections-test.js */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'corrections.js'), 'utf8');
const g = { LFT: {} };
new Function('globalThis', 'LFT', src)(g, g.LFT);
const C = g.LFT.corrections;

let fail = 0;
function is(nev, kapott, vart) {
  const ok = JSON.stringify(kapott) === JSON.stringify(vart);
  if (!ok) fail++;
  console.log((ok ? 'OK   ' : 'HIBA ') + nev);
  if (!ok) console.log('       kapott: ' + JSON.stringify(kapott) + '\n       várt:   ' + JSON.stringify(vart));
}

const LIST = [
  'Unite → Unyte',
  'MyUnite -> MyUnyte',
  'safe and sound protocol = Safe and Sound Protocol',
  '# megjegyzés',
  '',
  'ILS\tiLs',
  'hibás sor elválasztó nélkül',
  'üres jobb oldal =',
  'unite => valami más'          // ismétlődő bal oldal: az első nyer
].join('\n');

/* ---------- feldolgozás ---------- */
{
  const r = C.parse(LIST);
  is('szabályok, minden elválasztóval', r.rules.map(x => x.from + '|' + x.to), [
    'Unite|Unyte', 'MyUnite|MyUnyte', 'safe and sound protocol|Safe and Sound Protocol', 'ILS|iLs'
  ]);
  is('hibás sorok számmal', r.bad, [7, 8]);
  is('üres lista', C.parse('').rules, []);
}

const fix = C.fixer(LIST);

/* ---------- a valódi átirat hibái ---------- */
is('Unite → Unyte', fix('The Unite ILS app and MyUnite.'), 'The Unyte iLs app and MyUnyte.');
is('kisbetűs előfordulás is', fix('download the unite app'), 'download the Unyte app');
is('kifejezés, kis- és nagybetűtől függetlenül',
  fix('offering the safe and sound protocol to your clients'), 'offering the Safe and Sound Protocol to your clients');
is('kifejezés két szóköz vagy sortörés között is', fix('the safe  and\nsound protocol'), 'the Safe and Sound Protocol');

/* ---------- amit NEM szabad bántani ---------- */
is('szó közepén nem cserél (United)', fix('the United States'), 'the United States');
is('szóösszetétel elején sem (Unites)', fix('it unites people'), 'it unites people');
is('összetett szónak saját szabálya van (MyUnite → MyUnyte)', fix('MyUnite'), 'MyUnyte');
is('írásjelek mellett is illeszt', fix('(Unite), "Unite"!'), '(Unyte), "Unyte"!');
is('ékezetes szóhatár: nem cserél ékezetes betű mellett', C.compile([{ from: 'ok', to: 'X' }])('jók ok'), 'jók X');
is('szabály nélkül változatlan', C.fixer('')('Unite'), 'Unite');
is('üres szöveg', fix(''), '');
is('null szöveg', fix(null), '');

/* ---------- regex-speciális karakterek a szabályban ---------- */
is('a pont nem joker', C.compile([{ from: 'e.g', to: 'például' }])('e.g. and eXg'), 'például. and eXg');
is('zárójel a szabályban', C.compile([{ from: 'C++', to: 'C plus plus' }])('I like C++ a lot'), 'I like C plus plus a lot');

/* ---------- gyorsítótár ---------- */
{
  // a lebegő ablak minden mondatnál ugyanazzal a beállítással hív
  const a = C.fixer(LIST), b = C.fixer(LIST);
  is('ugyanarra a listára ugyanaz a (már lefordított) függvény', a === b, true);
  is('változott listára új függvény', C.fixer(LIST + '\nfoo = bar') !== a, true);
}

console.log(fail ? '\n' + fail + ' teszt bukott' : '\nMinden teszt átment');
process.exit(fail ? 1 : 0);
