// Renderiza el sonido real de Fivo fuera del navegador: carga el mismo
// prelude + WASM de Surge + AudioWorkletProcessor que usa la app, dentro de un
// contexto aislado que imita el AudioWorkletGlobalScope, y lo hace sonar
// bloque a bloque. Lo usa tests/audio/surge.test.ts para congelar el sonido.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SURGE_DIR = fileURLToPath(new URL('../public/surge/', import.meta.url));
const read = (name) => readFileSync(SURGE_DIR + name, 'utf8');
const SOURCES = ['fivo-surge-prelude.js', 'fivo-surge-wasm.js', 'fivo-surge-processor.js'].map(read);

export const PRESET_FILES = { EP2: 'ep2.fxp', Messy: 'messy.fxp', Canadians: 'canadians.fxp', 'E-Bass': 'ebass.fxp' };
export const FRAMES = 128;

const loadPresets = () => Object.fromEntries(Object.entries(PRESET_FILES).map(([name, file]) => {
  const bytes = readFileSync(SURGE_DIR + 'presets/' + file);
  return [name, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)];
}));

// Reloj y azar fijos: Surge siembra su azar con el reloj y con
// crypto.getRandomValues (que el prelude arma sobre Math.random). Sin esto,
// dos renders del mismo guion no dan los mismos samples.
const FIXED_TIME = Date.UTC(2026, 0, 1);
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [FIXED_TIME])); }
  static now() { return FIXED_TIME; }
}

const seededRandom = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

// Crea un processor listo para sonar. `options` = processorOptions de la app.
export async function createProcessor({ sampleRate = 48000, mobile = false, gain = 0.78 } = {}) {
  let ProcessorClass = null;
  const math = Object.create(Math);
  math.random = seededRandom(1);
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    WebAssembly, TextDecoder, TextEncoder, Math: math,
    Date: FixedDate,
    performance: { now: () => 0 },
    sampleRate,
    setTimeout, clearTimeout,
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { onmessage: null, posted: [], postMessage(m) { this.posted.push(m); } };
      }
    },
    registerProcessor: (_name, cls) => { ProcessorClass = cls; },
  });
  for (const source of SOURCES) vm.runInContext(source, context);

  const processor = new ProcessorClass({ processorOptions: { mobile, presets: loadPresets() } });
  for (let i = 0; i < 2000 && !processor.ready; i++) {
    if (processor.error) throw new Error(processor.error);
    await new Promise((r) => setTimeout(r, 5));
  }
  if (!processor.ready) throw new Error('Surge no quedo listo');
  // El host (audio.ts) manda la ganancia del motor apenas crea el nodo.
  processor.port.onmessage({ data: { type: 'gain', value: gain } });
  return processor;
}

// Ejecuta un guion de eventos { at: segundos, msg } y devuelve [L, R].
export function render(processor, events, seconds, sampleRate = 48000) {
  const blocks = Math.ceil((seconds * sampleRate) / FRAMES);
  const left = new Float32Array(blocks * FRAMES);
  const right = new Float32Array(blocks * FRAMES);
  const queue = [...events].sort((a, b) => a.at - b.at);
  for (let b = 0; b < blocks; b++) {
    const t = (b * FRAMES) / sampleRate;
    while (queue.length && queue[0].at <= t) processor.port.onmessage({ data: queue.shift().msg });
    const out = [new Float32Array(FRAMES), new Float32Array(FRAMES)];
    processor.process([], [out], {});
    left.set(out[0], b * FRAMES);
    right.set(out[1], b * FRAMES);
  }
  return [left, right];
}
