// La lectura del acorde (engine.ts) tiene que dar exactamente lo mismo que el
// motor C++ (fivo_demo --json, lo que servia /api/chord) en todo el dominio
// que usa la app.
//   - Con FIVO_CLI=<ruta a fivo_demo>: compara caso por caso contra el binario
//     y regenera la huella (UPDATE_ENGINE_FIXTURE=1 para escribirla).
//   - Sin binario: compara contra la huella guardada de las salidas del C++.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { engineChord } from '../../src/api/engine';
import { CONTEXT_TABLE } from '../../src/api/contextTable';
import type { FivoStyle, PowerMode } from '../../src/api/fivo';

const KEYS = Object.keys(CONTEXT_TABLE.lite.pop);
// Raices que manda App.tsx (mayores y menores, con su grafia).
const ROOTS = ['C', 'G', 'D', 'A', 'E', 'B', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'F#', 'C#', 'G#'];
const STYLES: FivoStyle[] = ['pop', 'rock', 'jazz', 'bossa'];
const POWERS: PowerMode[] = ['auto', 'on', 'off'];

type Case = { key: string; root: string; minor: boolean; style: FivoStyle; inv: number; fingers: number; power: PowerMode; lite: boolean };
function* domain(): Generator<Case> {
  for (const lite of [true, false]) for (const style of STYLES) for (const key of KEYS) for (const root of ROOTS)
    for (const minor of [false, true]) for (const inv of [0, 1, 2]) for (const fingers of [1, 2, 3]) for (const power of POWERS)
      yield { key, root, minor, style, inv, fingers, power, lite };
}

// Mismos argumentos que arma bff/server.js.
const cliArgs = (c: Case) => {
  const args = ['--json', c.key, c.root, '--inversion', String(c.inv), '--style', c.style, '--fingers', String(c.fingers)];
  if (c.minor) args.push('--minor');
  if (c.power === 'auto' || c.power === 'on') args.push('--power', c.power);
  if (c.lite) args.push('--lite');
  return args;
};

const canonical = (r: object) => JSON.stringify(r, Object.keys(r).sort());
const FIXTURE = new URL('./__fixtures__/engine-cli.sha256', import.meta.url);

describe('engine.ts = motor C++', () => {
  it('en todo el dominio de la app', async () => {
    const cases = [...domain()];
    expect(cases.length).toBe(155520);
    const ts = cases.map((c) => canonical(engineChord(c.key, c.root, c.inv, c.style, c.minor, c.power, c.fingers, c.lite)!));

    const cli = process.env.FIVO_CLI;
    if (!cli) {
      const hash = createHash('sha256').update(ts.join('\n')).digest('hex');
      expect(hash).toBe(readFileSync(FIXTURE, 'utf8').trim());
      return;
    }

    const run = promisify(execFile);
    const out: string[] = new Array(cases.length);
    let next = 0;
    await Promise.all(Array.from({ length: 16 }, async () => {
      while (next < cases.length) {
        const i = next++;
        const { stdout } = await run(cli, cliArgs(cases[i]));
        out[i] = canonical(JSON.parse(stdout));
      }
    }));
    const diffs = cases.flatMap((c, i) => (out[i] === ts[i] ? [] : [{ args: cliArgs(c).join(' '), cli: out[i], ts: ts[i] }]));
    expect(diffs.slice(0, 5)).toEqual([]);
    if (process.env.UPDATE_ENGINE_FIXTURE) {
      writeFileSync(FIXTURE, createHash('sha256').update(out.join('\n')).digest('hex') + '\n');
    }
  }, 900_000);
});
