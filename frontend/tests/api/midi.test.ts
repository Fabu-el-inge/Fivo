import { describe, expect, it, vi } from 'vitest';
import { MidiBus, MidiLiveOutput, MidiRecorder, PPQ, writeMidiFile } from '../../src/api/midi';
import type { MidiNoteEvent } from '../../src/api/midi';

// Lector minimo de SMF, independiente del escritor.
function readMidi(bytes: Uint8Array) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (o: number, n: number) => String.fromCharCode(...bytes.slice(o, o + n));
  expect(str(0, 4)).toBe('MThd');
  const format = dv.getUint16(8);
  const tracks = dv.getUint16(10);
  const ppq = dv.getUint16(12);
  expect(str(14, 4)).toBe('MTrk');
  const len = dv.getUint32(18);
  let p = 22;
  const end = p + len;
  const vlq = () => { let v = 0; let b; do { b = bytes[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
  let tick = 0;
  let tempo = 0;
  const notes: { type: 'on' | 'off'; note: number; velocity: number; tick: number }[] = [];
  let ended = false;
  while (p < end) {
    tick += vlq();
    const status = bytes[p++];
    if (status === 0xff) {
      const metaType = bytes[p++];
      const l = vlq();
      if (metaType === 0x51) tempo = (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2];
      if (metaType === 0x2f) ended = true;
      p += l;
    } else {
      const kind = status & 0xf0;
      notes.push({ type: kind === 0x90 ? 'on' : 'off', note: bytes[p], velocity: bytes[p + 1], tick });
      p += 2;
    }
  }
  expect(p).toBe(end);
  return { format, tracks, ppq, tempo, notes, ended, length: bytes.length };
}

const ev = (type: 'on' | 'off', note: number, time: number, velocity = 100): MidiNoteEvent => ({ type, note, velocity, time });

describe('writeMidiFile', () => {
  it('SMF formato 0 con tempo y tiempos en ticks desde la primera nota', () => {
    // 120 bpm: una negra = 500 ms = 480 ticks.
    const file = readMidi(writeMidiFile([ev('on', 60, 1000, 127), ev('off', 60, 1500), ev('on', 64, 1500, 89), ev('off', 64, 2250)], 120));
    expect(file).toMatchObject({ format: 0, tracks: 1, ppq: PPQ, tempo: 500000, ended: true });
    expect(file.notes).toEqual([
      { type: 'on', note: 60, velocity: 127, tick: 0 },
      { type: 'off', note: 60, velocity: 64, tick: 480 },
      { type: 'on', note: 64, velocity: 89, tick: 480 },
      { type: 'off', note: 64, velocity: 64, tick: 1200 },
    ]);
  });

  it('a igual tiempo respeta el orden en que ocurrieron', () => {
    // Re-ataque (off + on) y una nota que empieza y termina en el mismo instante.
    const file = readMidi(writeMidiFile([ev('on', 60, 0), ev('off', 60, 500), ev('on', 60, 500), ev('off', 60, 900), ev('on', 62, 900), ev('off', 62, 900)], 120));
    expect(file.notes.map(n => `${n.type}${n.note}`)).toEqual(['on60', 'off60', 'on60', 'off60', 'on62', 'off62']);
  });

  it('deltas largos (VLQ de varios bytes) y archivo vacio valido', () => {
    const file = readMidi(writeMidiFile([ev('on', 48, 0), ev('off', 48, 120000)], 90));
    expect(file.notes[1].tick).toBe(Math.round(120000 / (60000 / (90 * PPQ))));
    expect(readMidi(writeMidiFile([], 120)).notes).toEqual([]);
  });
});

describe('MidiBus', () => {
  it('traduce noteOn/noteOff y el panic apaga lo que suena', () => {
    const bus = new MidiBus();
    const got: string[] = [];
    bus.subscribe(e => got.push(`${e.type}${e.note}`));
    bus.handleWorkletMessage({ type: 'noteOn', notes: [60, 64, 67], velocity: 127 }, 0);
    bus.handleWorkletMessage({ type: 'noteOff', notes: [64], velocity: 64 }, 1);
    bus.handleWorkletMessage({ type: 'noteOff', notes: [99] }, 1); // no estaba sonando
    bus.handleWorkletMessage({ type: 'hold', enabled: true } as never, 1);
    bus.handleWorkletMessage({ type: 'panic' }, 2);
    bus.handleWorkletMessage({ type: 'panic' }, 3); // los 4 panic seguidos de audio.ts
    expect(got).toEqual(['on60', 'on64', 'on67', 'off64', 'off60', 'off67']);
    expect(bus.activeNotes).toEqual([]);
  });

  it('como el motor: una altura suena o no; re-atacar es off + on', () => {
    const bus = new MidiBus();
    const got: string[] = [];
    bus.subscribe(e => got.push(`${e.type}${e.note}`));
    bus.handleWorkletMessage({ type: 'noteOn', notes: [60], velocity: 127 }, 0);
    bus.handleWorkletMessage({ type: 'noteOn', notes: [60], velocity: 127 }, 1);
    bus.handleWorkletMessage({ type: 'noteOff', notes: [60] }, 2);
    bus.handleWorkletMessage({ type: 'noteOff', notes: [60] }, 3);
    expect(got).toEqual(['on60', 'off60', 'on60', 'off60']);
    expect(bus.activeNotes).toEqual([]);
  });
});

describe('MidiRecorder', () => {
  it('graba solo lo tocado mientras graba y cierra lo que sigue sonando', () => {
    const bus = new MidiBus();
    bus.subscribe(() => {});
    const rec = new MidiRecorder(bus);
    bus.handleWorkletMessage({ type: 'noteOn', notes: [50], velocity: 100 }, 0); // antes de grabar
    rec.start();
    bus.handleWorkletMessage({ type: 'noteOff', notes: [50] }, 10); // no entra: empezo antes
    bus.handleWorkletMessage({ type: 'noteOn', notes: [60, 64], velocity: 127 }, 100);
    bus.handleWorkletMessage({ type: 'noteOff', notes: [60] }, 300);
    const events = rec.stop(400);
    expect(events.map(e => `${e.type}${e.note}@${e.time}`)).toEqual(['on60@100', 'on64@100', 'off60@300', 'off64@400']);
    expect(rec.noteCount).toBe(2);
    expect(rec.recording).toBe(false);
  });
});

describe('MidiLiveOutput', () => {
  it('manda los bytes al puerto elegido y apaga todo al cambiar de puerto', async () => {
    const sent: number[][] = [];
    const port = { id: 'iac', name: 'IAC Bus 1', send: (d: number[]) => sent.push(d) };
    vi.stubGlobal('navigator', {
      requestMIDIAccess: async () => ({ outputs: new Map([['iac', port]]), onstatechange: null }),
    });
    const bus = new MidiBus();
    const out = new MidiLiveOutput(bus);
    expect(await out.connect()).toEqual([{ id: 'iac', name: 'IAC Bus 1' }]);
    bus.handleWorkletMessage({ type: 'noteOn', notes: [60], velocity: 127 }, 0); // sin puerto: nada
    out.select('iac');
    bus.handleWorkletMessage({ type: 'noteOn', notes: [62], velocity: 100 }, 1);
    bus.handleWorkletMessage({ type: 'noteOff', notes: [60] }, 2); // la DAW no la recibio: no se apaga
    bus.handleWorkletMessage({ type: 'noteOn', notes: [67], velocity: 90 }, 3);
    out.select(null);
    expect(sent).toEqual([[0x90, 62, 100], [0x90, 67, 90], [0x80, 62, 64], [0x80, 67, 64], [0xb0, 123, 0]]);
    vi.unstubAllGlobals();
  });
});
