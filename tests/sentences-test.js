/* A mondatgyűjtő (lib/sentences.js) tesztje — a my.unyte.com valódi
   átiratának (2026-10-05) töréseivel.
   Futtatás: node tests/sentences-test.js */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'sentences.js'), 'utf8');
const g = { LFT: {} };
new Function('globalThis', 'LFT', src)(g, g.LFT);
const { SentenceJoiner, sentenceEnds } = g.LFT;

let fail = 0;
function is(nev, kapott, vart) {
  const ok = JSON.stringify(kapott) === JSON.stringify(vart);
  if (!ok) fail++;
  console.log((ok ? 'OK   ' : 'HIBA ') + nev);
  if (!ok) console.log('       kapott: ' + JSON.stringify(kapott) + '\n       várt:   ' + JSON.stringify(vart));
}

function run(pieces, opts) {
  const out = [];
  const j = new SentenceJoiner(Object.assign({ waitMs: 60000, onSentence: (t, m) => out.push({ t, at: m.at }) }, opts || {}));
  pieces.forEach((p, i) => j.push(p, { at: 1000 * (i + 1) }));
  return { out, j };
}

(async () => {
  /* ---------- a valódi átirat törései ---------- */
  {
    const { out, j } = run([
      'Hello, and welcome. We\'ve created this short intro video to help',
      'you get started offering the safe and sound protocol to your clients.'
    ]);
    is('a mondat közepén tört szakasz egy mondattá áll össze', out.map(o => o.t), [
      'Hello, and welcome.',
      'We\'ve created this short intro video to help you get started offering the safe and sound protocol to your clients.'
    ]);
    is('nincs maradék', j.buf, '');
  }
  {
    const { out, j } = run([
      'By using MyUnite, you can track your clients\' listening sessions, giving you more confidence',
      'in their progress and compliance. To add and manage clients,',
      'simply click on the clients link in the MyUnite menu.'
    ]);
    is('a szakaszon belüli mondatvégnél vág, a maradékot továbbviszi', out.map(o => o.t), [
      'By using MyUnite, you can track your clients\' listening sessions, giving you more confidence in their progress and compliance.',
      'To add and manage clients, simply click on the clients link in the MyUnite menu.'
    ]);
    is('az első mondat ideje az első szakasz kezdete', out[0].at, 1000);
    is('a második mondat ideje a szakaszé, amelyikben elkezdődött', out[1].at, 2000);
    is('nincs maradék', j.buf, '');
  }

  /* ---------- várakozás és ürítés ---------- */
  {
    const { out, j } = run(['as a provider, can create and manage your client accounts,']);
    is('mondatvég nélkül még nem megy tovább', out.length, 0);
    j.flush();
    is('ürítéskor (leállítás) a félkész is továbbmegy', out.map(o => o.t), ['as a provider, can create and manage your client accounts,']);
  }
  {
    const out = [];
    const j = new SentenceJoiner({ waitMs: 30, onSentence: t => out.push(t) });
    j.push('and assign specific SSP programs', { at: 1 });
    await new Promise(r => setTimeout(r, 15));
    j.push('to remote clients', { at: 2 });
    await new Promise(r => setTimeout(r, 15));
    is('új szakasz újraindítja a várakozást', out.length, 0);
    await new Promise(r => setTimeout(r, 40));
    is('ha nem jön mondatvég, a várakozás után magától továbbmegy',
      out, ['and assign specific SSP programs to remote clients']);
  }
  {
    const { out } = run(['word '.repeat(100).trim()], { maxLen: 400 });
    is('túl hosszú mondatvég nélkül: azonnal továbbmegy', out.length, 1);
  }

  /* ---------- rövidítések ---------- */
  is('Dr. nem mondatvég', sentenceEnds('Developed by Dr. Porges in the lab. Then more'), ['Developed by Dr. Porges in the lab.'.length]);
  is('monogram nem mondatvég', sentenceEnds('Stephen W. Porges created it. Next'), ['Stephen W. Porges created it.'.length]);
  is('e.g. és i.e. nem mondatvég', sentenceEnds('Use headphones, e.g. closed ones, i.e. over ear. Done'), ['Use headphones, e.g. closed ones, i.e. over ear.'.length]);
  is('tizedes szám nem mondatvég', sentenceEnds('It costs 3.5 dollars'), []);
  is('kérdőjel, felkiáltójel', sentenceEnds('Ready? Go! Now'), ['Ready?'.length, 'Ready? Go!'.length]);
  is('idézőjeles mondatvég', sentenceEnds('He said "stop." Then left'), ['He said "stop."'.length]);
  is('a Deepgram kihagyás-jele (…) is vág', sentenceEnds('you and your clients can... The volume'), ['you and your clients can...'.length]);

  /* ---------- a nagy blokk (2:04) mondatokra bomlik ---------- */
  {
    const { out } = run(['The Unite ILS app is the delivery mechanism for the SSP playlists and can be thought of as the player. Through this same app, you and your clients can... The volume to an appropriate level. You will be prompted to set the volume level in the app.']);
    is('egy hosszú blokk is mondatonként megy tovább', out.length, 4);
  }

  /* ---------- hibatűrés ---------- */
  {
    const j = new SentenceJoiner({ waitMs: 60000, onSentence: () => { throw new Error('hívó hibája'); } });
    let threw = false;
    try { j.push('One. Two.', { at: 1 }); } catch (e) { threw = true; }
    is('a hívó hibája nem dönti el a gyűjtőt', threw, false);
    j.push('', { at: 2 });
    is('üres szakasz: semmi', j.buf, '');
    j.reset();
  }

  console.log(fail ? '\n' + fail + ' teszt bukott' : '\nMinden teszt átment');
  process.exit(fail ? 1 : 0);
})();
