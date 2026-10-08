// MIDI de Fivo: grabar a archivo .mid y salida en vivo (Web MIDI) a una DAW.
//
// No toca el sonido: escucha los mismos mensajes que AudioEngine le manda al
// worklet de Surge (SurgeWasmHost.send en audio.ts) y los traduce a MIDI. Las
// notas son las que suenan (con la octava elegida, E-Bass -12, Canadians +12).

/** El panel MIDI esta en prueba: solo aparece con ?midi=1 en la URL. */
export const midiPanelEnabled = () => {
    try {
        return new URLSearchParams(window.location.search).get('midi') === '1';
    } catch {
        return false;
    }
};

export type MidiNoteEvent = { type: 'on' | 'off'; note: number; velocity: number; time: number };
type Listener = (event: MidiNoteEvent) => void;

type WorkletMessage = { type?: unknown; notes?: unknown; velocity?: unknown };

const clampByte = (v: number) => Math.max(0, Math.min(127, Math.round(v)));

/** Replica en MIDI los mensajes al worklet. Como el motor, una altura suena
 *  o no suena: un noteOn sobre una nota que ya suena la re-ataca (noteOff +
 *  noteOn) y el primer noteOff la apaga. Un "panic" apaga todo lo que suena. */
export class MidiBus {
    private listeners = new Set<Listener>();
    private active = new Set<number>();

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    get activeNotes(): number[] {
        return [...this.active];
    }

    handleWorkletMessage(message: WorkletMessage, time = performance.now()) {
        if (this.listeners.size === 0 && this.active.size === 0) return;
        const notes = Array.isArray(message.notes)
            ? message.notes.filter((n): n is number => typeof n === 'number').map(clampByte)
            : [];
        if (message.type === 'noteOn') {
            const velocity = Math.max(1, clampByte(Number(message.velocity ?? 100)));
            for (const note of notes) {
                if (this.active.has(note)) this.emit({ type: 'off', note, velocity: 64, time });
                this.active.add(note);
                this.emit({ type: 'on', note, velocity, time });
            }
        } else if (message.type === 'noteOff') {
            for (const note of notes) {
                if (!this.active.delete(note)) continue;
                this.emit({ type: 'off', note, velocity: 64, time });
            }
        } else if (message.type === 'panic') {
            for (const note of this.active) this.emit({ type: 'off', note, velocity: 64, time });
            this.active.clear();
        }
    }

    // Un error del MIDI (por ejemplo, un puerto que se desconecto) nunca puede
    // cortar el sonido: este bus corre dentro del envio de notas al worklet.
    private emit(event: MidiNoteEvent) {
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch (error) {
                console.warn('MIDI', error);
            }
        }
    }
}

export const midiBus = new MidiBus();

// ---------------------------------------------------------------------------
// Archivo MIDI estandar (SMF formato 0, un track, canal 1)

export const PPQ = 480;

const vlq = (value: number): number[] => {
    let v = Math.max(0, Math.round(value));
    const bytes = [v & 0x7f];
    while ((v >>= 7) > 0) bytes.unshift((v & 0x7f) | 0x80);
    return bytes;
};

const u32 = (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
const ascii = (s: string) => [...s].map(c => c.charCodeAt(0) & 0x7f);

/**
 * Arma un .mid a partir de eventos con tiempo en ms. El tempo (bpm) solo
 * define la grilla de la DAW: los tiempos reales se respetan.
 */
export function writeMidiFile(events: MidiNoteEvent[], bpm: number, name = 'Fivo'): Uint8Array {
    // Los eventos llegan en orden; sort es estable, asi que a igual tiempo se
    // respeta el orden en que ocurrieron (un off+on de re-ataque queda bien).
    const sorted = [...events].sort((a, b) => a.time - b.time);
    const start = sorted.length > 0 ? sorted[0].time : 0;
    const msPerTick = 60000 / (bpm * PPQ);
    const usPerQuarter = Math.round(60_000_000 / bpm);

    const track: number[] = [];
    const nameBytes = ascii(name);
    track.push(0x00, 0xff, 0x03, ...vlq(nameBytes.length), ...nameBytes);
    track.push(0x00, 0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff);
    track.push(0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08); // 4/4

    let lastTick = 0;
    for (const e of sorted) {
        const tick = Math.round((e.time - start) / msPerTick);
        track.push(...vlq(tick - lastTick));
        lastTick = tick;
        track.push(e.type === 'on' ? 0x90 : 0x80, clampByte(e.note), e.type === 'on' ? Math.max(1, clampByte(e.velocity)) : 64);
    }
    track.push(0x00, 0xff, 0x2f, 0x00);

    const header = [...ascii('MThd'), ...u32(6), 0x00, 0x00, 0x00, 0x01, (PPQ >> 8) & 0xff, PPQ & 0xff];
    return new Uint8Array([...header, ...ascii('MTrk'), ...u32(track.length), ...track]);
}

/** Graba lo que se toca entre start() y stop(). Las notas que siguen sonando
 *  al parar se cierran en ese momento. El archivo arranca en la primera nota. */
export class MidiRecorder {
    private events: MidiNoteEvent[] = [];
    private open = new Map<number, number>();
    private unsubscribe: (() => void) | null = null;
    private bus: MidiBus;

    constructor(bus: MidiBus) {
        this.bus = bus;
    }

    get recording() {
        return this.unsubscribe !== null;
    }

    get noteCount() {
        return this.events.filter(e => e.type === 'on').length;
    }

    start() {
        this.stop();
        this.events = [];
        this.open.clear();
        this.unsubscribe = this.bus.subscribe((e) => {
            if (e.type === 'on') {
                this.open.set(e.note, (this.open.get(e.note) ?? 0) + 1);
                this.events.push(e);
            } else if ((this.open.get(e.note) ?? 0) > 0) {
                // Un noteOff de una nota que empezo antes de grabar no entra.
                this.open.set(e.note, this.open.get(e.note)! - 1);
                this.events.push(e);
            }
        });
    }

    stop(time = performance.now()): MidiNoteEvent[] {
        if (!this.unsubscribe) return this.events;
        this.unsubscribe();
        this.unsubscribe = null;
        for (const [note, count] of this.open) {
            for (let i = 0; i < count; i++) this.events.push({ type: 'off', note, velocity: 64, time });
        }
        this.open.clear();
        return this.events;
    }
}

// ---------------------------------------------------------------------------
// Salida en vivo (Web MIDI): Chrome y Edge de escritorio, Chrome en Android.
// Safari (Mac, iPhone, iPad) no implementa Web MIDI.

export type MidiPort = { id: string; name: string };

type WebMidiAccess = {
    outputs: Map<string, { id: string; name?: string | null; send(data: number[]): void }>;
    onstatechange: ((e: unknown) => void) | null;
};

export const webMidiSupported = () =>
    typeof navigator !== 'undefined' && typeof (navigator as { requestMIDIAccess?: unknown }).requestMIDIAccess === 'function';

export class MidiLiveOutput {
    private access: WebMidiAccess | null = null;
    private portId: string | null = null;
    private sounding = new Map<number, number>();
    private unsubscribe: (() => void) | null = null;
    onPortsChange: ((ports: MidiPort[]) => void) | null = null;
    /** Se llama si el puerto rechaza un mensaje (se desconecto, se cerro). */
    onSendError: ((error: unknown) => void) | null = null;
    private bus: MidiBus;
    private channel: number;

    constructor(bus: MidiBus, channel = 0) {
        this.bus = bus;
        this.channel = channel;
    }

    /** Pide permiso al navegador. Devuelve las salidas disponibles. */
    async connect(): Promise<MidiPort[]> {
        if (!webMidiSupported()) throw new Error('Este navegador no tiene MIDI (usá Chrome o Edge)');
        const nav = navigator as unknown as { requestMIDIAccess(o: { sysex: boolean }): Promise<WebMidiAccess> };
        this.access = await nav.requestMIDIAccess({ sysex: false });
        this.access.onstatechange = () => this.onPortsChange?.(this.ports());
        return this.ports();
    }

    ports(): MidiPort[] {
        if (!this.access) return [];
        return [...this.access.outputs.values()].map(o => ({ id: o.id, name: o.name || o.id }));
    }

    select(portId: string | null) {
        this.allNotesOff();
        this.portId = portId;
        this.unsubscribe?.();
        this.unsubscribe = portId ? this.bus.subscribe(e => this.forward(e)) : null;
    }

    private output() {
        return this.portId ? this.access?.outputs.get(this.portId) ?? null : null;
    }

    private send(data: number[]) {
        try {
            this.output()?.send(data);
        } catch (error) {
            // El puerto murio: se suelta sin volver a escribirle (apagar notas
            // en un puerto roto vuelve a fallar) y se avisa una sola vez.
            this.portId = null;
            this.unsubscribe?.();
            this.unsubscribe = null;
            this.sounding.clear();
            this.onSendError?.(error);
        }
    }

    private forward(e: MidiNoteEvent) {
        const out = this.output();
        if (!out) return;
        if (e.type === 'on') {
            this.sounding.set(e.note, (this.sounding.get(e.note) ?? 0) + 1);
            this.send([0x90 | this.channel, e.note, e.velocity]);
        } else {
            // Solo se apagan notas que esta salida prendio.
            const count = this.sounding.get(e.note) ?? 0;
            if (count === 0) return;
            if (count === 1) this.sounding.delete(e.note); else this.sounding.set(e.note, count - 1);
            this.send([0x80 | this.channel, e.note, 64]);
        }
    }

    /** Apaga lo que haya quedado sonando en la DAW (al cambiar de puerto o salir). */
    allNotesOff() {
        if (this.output()) {
            for (const note of this.sounding.keys()) this.send([0x80 | this.channel, note, 64]);
            this.send([0xb0 | this.channel, 123, 0]);
        }
        this.sounding.clear();
    }
}
