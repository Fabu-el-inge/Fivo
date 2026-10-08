import { describe, expect, it } from 'vitest';
import { CONTEXT_TABLE } from '../../src/api/contextTable';

describe('CONTEXT_TABLE', () => {
  it('cubre 24 tonalidades x 4 estilos x 2 modos con 12 colores validos', () => {
    for (const mode of ['lite', 'full'] as const) {
      for (const style of ['pop', 'rock', 'jazz', 'bossa'] as const) {
        const keys = Object.keys(CONTEXT_TABLE[mode][style]);
        expect(keys).toHaveLength(24);
        for (const key of keys) {
          const [major, minor] = CONTEXT_TABLE[mode][style][key as keyof (typeof CONTEXT_TABLE)['lite']['pop']];
          for (const colors of [major, minor]) {
            expect(colors).toHaveLength(12);
            colors.forEach((c) => expect([0, 1, 2]).toContain(c));
          }
        }
      }
    }
  });

  // Decisiones de producto que la tabla tiene que conservar.
  it('LITE: Eb (bIII) sin color en pop de C; completo: naranja', () => {
    expect(CONTEXT_TABLE.lite.pop.C[0][3]).toBe(0);
    expect(CONTEXT_TABLE.full.pop.C[0][3]).toBe(1);
  });

  it('POPPY en Am: F (bVI) verde, A y D naranja', () => {
    const [major] = CONTEXT_TABLE.lite.pop.Am;
    expect(major[5]).toBe(2);
    expect(major[9]).toBe(1);
    expect(major[2]).toBe(1);
  });
});
