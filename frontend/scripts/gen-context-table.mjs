// Genera src/api/contextTable.ts a partir del motor C++ (demos/cli_main.cpp).
// La tabla es la fuente de los colores del circulo en el front; el C++ sigue
// siendo la referencia. Si cambia style_manager.cpp, recompilar y regenerar:
//   node scripts/gen-context-table.mjs <ruta/a/fivo_demo>
// Con --check no escribe: falla si la tabla commiteada difiere del motor.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const KEYS = [
  'C', 'G', 'D', 'A', 'E', 'B', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F',
  'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm',
];
const STYLES = ['pop', 'rock', 'jazz', 'bossa'];

const [cli, flag] = process.argv.slice(2);
if (!cli) {
  console.error('uso: node scripts/gen-context-table.mjs <fivo_demo> [--check]');
  process.exit(2);
}

const toArray = (m) => Array.from({ length: 12 }, (_, i) => m[String(i)]);
const table = { lite: {}, full: {} };
for (const [mode, extra] of [['lite', ['--lite']], ['full', []]]) {
  for (const style of STYLES) {
    table[mode][style] = {};
    for (const key of KEYS) {
      const out = JSON.parse(execFileSync(cli, ['--context', key, '--style', style, ...extra]).toString());
      table[mode][style][key] = [toArray(out.map), toArray(out.minorMap)];
    }
  }
}

const rows = (mode) => STYLES.map((style) => {
  const keys = KEYS.map((k) => `      '${k}': [${JSON.stringify(table[mode][style][k][0])}, ${JSON.stringify(table[mode][style][k][1])}],`).join('\n');
  return `    ${style}: {\n${keys}\n    },`;
}).join('\n');

const source = `// GENERADO por scripts/gen-context-table.mjs a partir del motor C++. No editar a mano.
// Colores por semitono de la raiz (0..11): 0 = rojo, 1 = naranja, 2 = verde.
// [acordes mayores, acordes menores] por tonalidad, estilo y modo (lite / completo).
export const CONTEXT_TABLE = {
  lite: {
${rows('lite')}
  },
  full: {
${rows('full')}
  },
} as const;
`;

const target = fileURLToPath(new URL('../src/api/contextTable.ts', import.meta.url));
if (flag === '--check') {
  if (readFileSync(target, 'utf8') !== source) {
    console.error('contextTable.ts no coincide con el motor C++. Regenerar.');
    process.exit(1);
  }
  console.log('contextTable.ts coincide con el motor C++.');
} else {
  writeFileSync(target, source);
  console.log(`escrito ${target}`);
}
