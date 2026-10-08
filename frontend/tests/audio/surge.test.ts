// Congela el sonido aprobado. Renderiza el WASM de Surge + el AudioWorklet de
// la app con guiones fijos y compara una huella de los samples. Si falla,
// cambiaste lo que escucha el usuario (motor, presets, processor o ganancias).
// Actualizar el snapshot (`npx vitest -u`) solo con una decision explicita.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error modulo JS sin tipos
import { createProcessor, render } from '../../scripts/surge-render.mjs';

type Msg = Record<string, unknown>;
type Event = { at: number; msg: Msg };

const on = (at: number, instrument: string, notes: number[], velocity = 127): Event =>
  ({ at, msg: { type: 'noteOn', instrument, notes, velocity } });
const off = (at: number, instrument: string, notes: number[]): Event =>
  ({ at, msg: { type: 'noteOff', instrument, notes, velocity: 64 } });
const msg = (at: number, m: Msg): Event => ({ at, msg: m });

// Notas tal como llegan al worklet (audio.ts ya aplico +12 a Canadians y -12 a E-Bass).
const SCENARIOS: Record<string, { events: Event[]; seconds: number }> = {
  'EP2 acorde C': { events: [on(0, 'EP2', [48, 52, 55]), off(1, 'EP2', [48, 52, 55])], seconds: 2 },
  'EP2 strum (velocity 102)': {
    events: [on(0, 'EP2', [48], 102), on(0.04, 'EP2', [52], 102), on(0.08, 'EP2', [55], 102), off(1, 'EP2', [48, 52, 55])],
    seconds: 1.6,
  },
  'Messy acorde Am': {
    events: [msg(0, { type: 'instrument', instrument: 'Messy' }), on(0, 'Messy', [57, 60, 64]), off(1, 'Messy', [57, 60, 64])],
    seconds: 2,
  },
  'Canadians acorde G': {
    events: [msg(0, { type: 'instrument', instrument: 'Canadians' }), on(0, 'Canadians', [67, 71, 74]), off(1.2, 'Canadians', [67, 71, 74])],
    seconds: 2.4,
  },
  'E-Bass raiz sostenida (sustain sintetico)': {
    events: [msg(0, { type: 'instrument', instrument: 'E-Bass' }), on(0, 'E-Bass', [36]), off(2.5, 'E-Bass', [36])],
    seconds: 3.2,
  },
  'E-Bass dos notas': {
    events: [msg(0, { type: 'instrument', instrument: 'E-Bass' }), on(0, 'E-Bass', [36]), on(0.5, 'E-Bass', [43]), off(1.5, 'E-Bass', [36, 43])],
    seconds: 2,
  },
  'EP2 hold (auto-ganancia)': {
    events: [msg(0, { type: 'hold', instrument: 'EP2', enabled: true }), on(0, 'EP2', [48, 52, 55]), off(3, 'EP2', [48, 52, 55])],
    seconds: 3.5,
  },
  'cambio de instrumento con cola': {
    events: [on(0, 'EP2', [48, 52, 55]), msg(0.5, { type: 'instrument', instrument: 'Messy' }), off(0.5, 'EP2', [48, 52, 55]),
      on(0.6, 'Messy', [53, 57, 60]), off(1.2, 'Messy', [53, 57, 60])],
    seconds: 1.8,
  },
  'arpegio corto (80% del paso)': {
    events: [0, 0.25, 0.5, 0.75].flatMap((t, i) => [on(t, 'EP2', [[48, 52, 55, 60][i]]), off(t + 0.2, 'EP2', [[48, 52, 55, 60][i]])]),
    seconds: 1.5,
  },
};

const fingerprint = ([left, right]: [Float32Array, Float32Array]) => {
  let peak = 0;
  let sum = 0;
  for (const ch of [left, right]) for (const v of ch) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
  return {
    sha256: createHash('sha256').update(Buffer.from(left.buffer)).update(Buffer.from(right.buffer)).digest('hex'),
    peak: Number(peak.toFixed(4)),
    rms: Number(Math.sqrt(sum / (left.length * 2)).toFixed(5)),
  };
};

describe('sonido Surge (worklet real)', () => {
  for (const [name, { events, seconds }] of Object.entries(SCENARIOS)) {
    for (const mobile of [false, true]) {
      it(`${name}${mobile ? ' [mobile]' : ''}`, async () => {
        const processor = await createProcessor({ mobile });
        if (mobile) {
          // En mobile los presets que no son EP2 llegan por mensaje, como en audio.ts.
          const presets = processor.presets;
          for (const name of ['Messy', 'Canadians', 'E-Bass']) processor.port.onmessage({ data: { type: 'preset', instrument: name, preset: presets[name] } });
        }
        const result = fingerprint(render(processor, events, seconds));
        expect(result.peak).toBeGreaterThan(0.001);
        expect(result).toMatchSnapshot();
      }, 30000);
    }
  }

  it('mobile y escritorio suenan igual', async () => {
    const results = [];
    for (const mobile of [false, true]) {
      const processor = await createProcessor({ mobile });
      if (mobile) processor.port.onmessage({ data: { type: 'preset', instrument: 'E-Bass', preset: processor.presets['E-Bass'] } });
      const events = [msg(0, { type: 'instrument', instrument: 'E-Bass' }), on(0, 'E-Bass', [36, 40, 43, 48]), off(1, 'E-Bass', [36, 40, 43, 48])];
      results.push(fingerprint(render(processor, events, 1.5)).sha256);
    }
    expect(results[0]).toBe(results[1]);
  }, 30000);
});

describe('archivos y constantes del sonido aprobado', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const md5 = (p: string) => createHash('md5').update(readFileSync(root + p)).digest('hex');

  it('motor y presets sin cambios', () => {
    expect({
      wasm: md5('public/surge/fivo-surge-wasm.js'),
      prelude: md5('public/surge/fivo-surge-prelude.js'),
      ep2: md5('public/surge/presets/ep2.fxp'),
      messy: md5('public/surge/presets/messy.fxp'),
      canadians: md5('public/surge/presets/canadians.fxp'),
      ebass: md5('public/surge/presets/ebass.fxp'),
    }).toEqual({
      wasm: '0773a9da419d5f0b3576d15ea5f0b626',
      prelude: 'f27705855966ed7d734cf980df1815d8',
      ep2: '3e343532cdfac0acc53d6d77dfd85d51',
      messy: '7d9bb073c4e7b89dfe6f76a4e76b95db',
      canadians: 'ed6b12ae0ca257595a183389c49f9715',
      ebass: 'a25e4b777caa154bddf7d47df5843d0e',
    });
  });

  it('ganancias de la cadena del host', () => {
    const audio = readFileSync(root + 'src/api/audio.ts', 'utf8');
    expect(audio).toMatch(/const SURGE_ENGINE_GAIN = 0\.78;/);
    expect(audio).toMatch(/const SURGE_OUTPUT_GAIN = 1\.85;/);
  });
});
