// Congela las notas que suenan hoy (aprobadas por el cliente). Si este test
// falla, cambiaste lo que escucha el usuario: revertir o actualizar el
// snapshot solo con una decision explicita (`npx vitest -u`).
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { calcChordNotes } from '../../src/api/chordCalc';
import { CONTEXT_TABLE } from '../../src/api/contextTable';
import type { FivoStyle, PowerMode } from '../../src/api/fivo';

const KEYS = Object.keys(CONTEXT_TABLE.lite.pop) as (keyof typeof CONTEXT_TABLE.lite.pop)[];
// Raices tal como las manda App.tsx (las menores sin la "m").
const MAJOR_ROOTS = ['C', 'G', 'D', 'A', 'E', 'B', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
const MINOR_ROOTS = ['A', 'E', 'B', 'F#', 'C#', 'G#', 'Eb', 'Bb', 'F', 'C', 'G', 'D'];
const CHORDS = [
  ...MAJOR_ROOTS.map((root) => ({ root, minor: false })),
  ...MINOR_ROOTS.map((root) => ({ root, minor: true })),
];

const toMap = (colors: readonly number[]) =>
  Object.fromEntries(colors.map((c, i) => [String(i), c]));

const line = (mode: 'lite' | 'full', key: (typeof KEYS)[number], style: FivoStyle, inversion: number, fingers: number, power: PowerMode) => {
  const map = toMap(CONTEXT_TABLE[mode][style][key][0]);
  const chords = CHORDS.map(({ root, minor }) =>
    `${root}${minor ? 'm' : ''}=${calcChordNotes(key, root, minor, style, inversion, fingers, power, map).join('.')}`);
  return `${key} ${chords.join(' ')}`;
};

describe('calcChordNotes', () => {
  // Lo que se puede tocar en la version LITE publicada: pop y Jazzy, voicing
  // automatico (inversion 0), 3 dedos (1 en el arpegio de E-Bass), power auto
  // u off (arpegio y glide).
  for (const style of ['pop', 'jazz'] as const) {
    for (const power of ['auto', 'off'] as const) {
      for (const fingers of [3, 1]) {
        it(`LITE ${style} power=${power} dedos=${fingers}`, () => {
          const lines = KEYS.map((key) => line('lite', key, style, 0, fingers, power));
          expect(lines.join('\n')).toMatchSnapshot();
        });
      }
    }
  }

  it('espacio completo (4 estilos, inversiones, dedos, power, lite y completo)', () => {
    const hash = createHash('sha256');
    for (const mode of ['lite', 'full'] as const)
      for (const style of ['pop', 'rock', 'jazz', 'bossa'] as const)
        for (const power of ['auto', 'on', 'off'] as const)
          for (const fingers of [1, 2, 3])
            for (const inversion of [0, 1, 2])
              for (const key of KEYS) hash.update(line(mode, key, style, inversion, fingers, power) + '\n');
    expect(hash.digest('hex')).toMatchSnapshot();
  });

  it('sin mapa de colores todo es verde: nunca power chord automatico', () => {
    expect(calcChordNotes('C', 'E', false, 'pop', 0, 3, 'auto')).toEqual([52, 56, 59]);
  });
});
