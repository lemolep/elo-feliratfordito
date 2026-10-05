/* Az összes teszt egy paranccsal. Nincs npm, nincs függőség — csak Node.
   Futtatás a projekt gyökeréből: node tests/run-all.js */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('-test.js')).sort();
let failed = 0;

for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const passed = (out.match(/^OK /gm) || []).length;
  if (r.status === 0) {
    console.log('OK     ' + f + '  (' + passed + ' teszt)');
  } else {
    failed++;
    console.log('BUKOTT ' + f);
    console.log(out.split('\n').filter(l => /HIBA|kapott|várt|Error/.test(l)).map(l => '       ' + l).join('\n'));
  }
}

console.log(failed ? '\n' + failed + ' tesztfájl bukott' : '\nMinden tesztfájl átment');
process.exit(failed ? 1 : 0);
