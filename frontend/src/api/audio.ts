import * as Tone from 'tone';

export type InstrumentName = 'EP2' | 'Messy' | 'Canadians' | 'E-Bass';

export type MetronomeBeatCallback = (beat: number, isAccent: boolean) => void;

type SampleUrls = Record<string, string>;
type SurgeInstrumentName = Extract<InstrumentName, 'EP2' | 'Messy' | 'Canadians' | 'E-Bass'>;
const SURGE_ASSET_VERSION = "instrument-tail-20260801-1";
const SURGE_ENGINE_GAIN = 0.78;
const SURGE_OUTPUT_GAIN = 1.85;

let nativeToneContextReady = false;

function ensureNativeToneContext() {
    if (nativeToneContextReady || typeof window === 'undefined') return;

    const NativeAudioContext = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!NativeAudioContext) return;

    const rawContext = Tone.getContext().rawContext as unknown;
    if (typeof BaseAudioContext !== 'undefined' && rawContext instanceof BaseAudioContext) {
        nativeToneContextReady = true;
        return;
    }

    Tone.setContext(new NativeAudioContext({ latencyHint: 'interactive' }) as unknown as AudioContext);
    nativeToneContextReady = true;
}

// En iOS la Web Audio API sale por el canal de timbre: con la palanca de silencio puesta
// no se escucha nada, sin ningun error. Pedir 'playback' la manda al canal de multimedia,
// que es como suena cualquier reproductor. En el resto de los navegadores no existe y no pasa nada.
function ensureIosAudioSession() {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (!session) return;
    try {
        session.type = 'playback';
    } catch (error) {
        console.warn('No se pudo fijar audioSession', error);
    }
}

class SurgeWasmHost {
    private node: AudioWorkletNode | null = null;
    private nodePromise: Promise<AudioWorkletNode> | null = null;
    private ready = false;
    private messageQueue: Record<string, unknown>[] = [];
    private destinations = new Set<any>();
    private lastDebug: Record<string, unknown> | null = null;
    private debugResolvers: Array<(message: Record<string, unknown> | null) => void> = [];
    onError: ((message: string) => void) | null = null;

    private report(message: string) {
        console.error('[Fivo audio]', message);
        try { this.onError?.(message); } catch { /* el aviso no puede romper el audio */ }
    }

    get isLoaded() {
        return this.ready;
    }

    whenLoaded(): Promise<void> {
        return this.ensureNode().then(() => undefined);
    }

    connect(destination: any) {
        this.destinations.add(destination);
        if (this.node) this.connectNode(this.node, destination);
        this.ensureNode().catch(error => this.report(String(error?.message ?? error)));
    }

    send(message: Record<string, unknown>) {
        if (this.node) {
            this.node.port.postMessage(message);
            return;
        }

        this.messageQueue.push(message);
        this.ensureNode().catch(error => this.report(String(error?.message ?? error)));
    }

    private async ensureNode(): Promise<AudioWorkletNode> {
        if (this.nodePromise) return this.nodePromise;

        this.nodePromise = this.createNode();
        return this.nodePromise;
    }

    private async createNode(): Promise<AudioWorkletNode> {
        const toneContext = Tone.getContext();
        const context = toneContext.rawContext as AudioContext;
        if (!context.audioWorklet) {
            throw new Error("AudioWorklet is not available in this browser");
        }

        const presetsPromise = Promise.all([
            this.fetchPreset("/surge/presets/ep2.fxp"),
            this.fetchPreset("/surge/presets/messy.fxp"),
            this.fetchPreset("/surge/presets/canadians.fxp"),
            this.fetchPreset("/surge/presets/ebass.fxp"),
        ]);

        await context.audioWorklet.addModule(`/surge/fivo-surge-prelude.js?v=${SURGE_ASSET_VERSION}`);
        await context.audioWorklet.addModule(`/surge/fivo-surge-wasm.js?v=${SURGE_ASSET_VERSION}`);
        await context.audioWorklet.addModule(`/surge/fivo-surge-processor.js?v=${SURGE_ASSET_VERSION}`);

        const [ep2, messy, canadians, ebass] = await presetsPromise;
        const node = toneContext.createAudioWorkletNode("fivo-surge", {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            processorOptions: {
                presets: {
                    EP2: ep2,
                    Messy: messy,
                    Canadians: canadians,
                    "E-Bass": ebass,
                },
            },
        });

        this.node = node;
        for (const destination of this.destinations) this.connectNode(node, destination);
        node.port.postMessage({ type: "gain", value: SURGE_ENGINE_GAIN });
        for (const message of this.messageQueue.splice(0)) node.port.postMessage(message);

        await new Promise<void>((resolve, reject) => {
            // 10 s alcanzaba en escritorio (arranca en ~0,5 s) pero no en un celular con mala
            // senal: son 7,1 MB de glue para bajar, parsear y compilar antes del primer sonido.
            const timeout = window.setTimeout(
                () => reject(new Error("El motor de sonido tardo demasiado en arrancar (45 s)")),
                45000,
            );
            const handleMessage = (event: MessageEvent) => {
                const message = event.data;
                if (message?.type === "debug") {
                    this.lastDebug = message;
                    const resolver = this.debugResolvers.shift();
                    if (resolver) resolver(message);
                }
                if (message?.type === "ready") {
                    window.clearTimeout(timeout);
                    this.ready = true;
                    resolve();
                }
                if (message?.type === "error") {
                    window.clearTimeout(timeout);
                    const detail = message.error || "Surge WASM init failed";
                    if (message.stack) console.error('[Fivo audio] stack del worklet:', message.stack);
                    reject(new Error(String(detail)));
                }
                if (message?.type === "instrumentError") {
                    this.report(`No se pudo cargar ${message.instrument}: ${message.error}`);
                }
                if (message?.type === "processError") {
                    console.warn("Surge WASM process error", message.error);
                }
            };
            node.port.addEventListener("message", handleMessage);
            node.port.start?.();
        });

        return node;
    }

    async debug(): Promise<Record<string, unknown> | null> {
        const node = await this.ensureNode();
        return new Promise(resolve => {
            const timeout = window.setTimeout(() => resolve(this.lastDebug), 500);
            this.debugResolvers.push(message => {
                window.clearTimeout(timeout);
                resolve(message);
            });
            node.port.postMessage({ type: "debug" });
        });
    }

    private async fetchPreset(url: string): Promise<ArrayBuffer> {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load ${url}`);
        return response.arrayBuffer();
    }

    private connectNode(node: AudioWorkletNode, destination: any) {
        const source = this.unwrapAudioSource(node);
        const target = this.unwrapAudioTarget(destination?.input ?? destination);
        if (!target) return;

        try {
            source.connect(target);
        } catch (error) {
            console.warn("Could not connect Surge WASM node", error);
        }
    }

    private unwrapAudioSource(source: any) {
        return this.unwrapAudioEndpoint(source, "output");
    }

    private unwrapAudioTarget(target: any) {
        return this.unwrapAudioEndpoint(target, "input");
    }

    private unwrapAudioEndpoint(endpoint: any, direction: "input" | "output") {
        const seen = new Set<any>();
        let current = endpoint;

        while (current && !seen.has(current)) {
            seen.add(current);

            if (typeof AudioNode !== "undefined" && current instanceof AudioNode) return current;
            if (typeof AudioParam !== "undefined" && current instanceof AudioParam) return current;

            if (current._nativeAudioWorkletNode) {
                current = current._nativeAudioWorkletNode;
                continue;
            }
            if (current._nativeAudioNode) {
                current = current._nativeAudioNode;
                continue;
            }
            if (current._nativeAudioParam) {
                current = current._nativeAudioParam;
                continue;
            }

            const next = current[direction];
            if (next && next !== current) {
                current = next;
                continue;
            }

            return current;
        }

        return current;
    }
}

const surgeWasmHost = new SurgeWasmHost();

class SurgeWasmInstrument {
    private currentNotes = new Set<number>();
    private instrument: SurgeInstrumentName;

    constructor(instrument: SurgeInstrumentName) {
        this.instrument = instrument;
    }

    get isLoaded(): boolean {
        return surgeWasmHost.isLoaded;
    }

    whenLoaded(): Promise<void> {
        return surgeWasmHost.whenLoaded();
    }

    connect(destination: any) {
        surgeWasmHost.connect(destination);
        return this;
    }

    set(_options: { attack?: number; release?: number; volume?: number }) {
        // The real Surge XT preset owns its envelope/timbre.
    }

    setHoldMode(enabled: boolean) {
        surgeWasmHost.send({
            type: "hold",
            instrument: this.instrument,
            enabled: enabled && this.instrument !== 'E-Bass',
        });
    }

    activate() {
        surgeWasmHost.send({ type: "instrument", instrument: this.instrument });
    }

    debug() {
        return surgeWasmHost.debug();
    }

    triggerAttack(notes: number | number[], _time?: Tone.Unit.Time, velocity: number = 1) {
        const midiNotes = this.toMidiList(notes);
        midiNotes.forEach(note => this.currentNotes.add(note));
        surgeWasmHost.send({
            type: "noteOn",
            instrument: this.instrument,
            notes: midiNotes,
            velocity: Math.max(1, Math.min(127, Math.round(velocity * 127))),
        });
    }

    triggerRelease(notes: number | number[], _time?: Tone.Unit.Time) {
        const midiNotes = this.toMidiList(notes);
        midiNotes.forEach(note => this.currentNotes.delete(note));
        surgeWasmHost.send({
            type: "noteOff",
            instrument: this.instrument,
            notes: midiNotes,
            velocity: 64,
        });
    }

    triggerAttackRelease(notes: number | number[], duration: Tone.Unit.Time, time?: Tone.Unit.Time, velocity: number = 1) {
        const delayMs = time === undefined
            ? 0
            : Math.max(0, (Tone.Time(time).toSeconds() - Tone.now()) * 1000);
        const releaseMs = Math.max(1, Tone.Time(duration).toSeconds() * 1000);

        window.setTimeout(() => this.triggerAttack(notes, undefined, velocity), delayMs);
        window.setTimeout(() => this.triggerRelease(notes), delayMs + releaseMs);
    }

    releaseAll(_time?: Tone.Unit.Time, hard = false) {
        if (hard) {
            surgeWasmHost.send({ type: "panic", instrument: this.instrument });
        } else if (this.currentNotes.size > 0) {
            surgeWasmHost.send({
                type: "noteOff",
                instrument: this.instrument,
                notes: [...this.currentNotes],
                velocity: 64,
            });
        } else {
            return;
        }
        this.currentNotes.clear();
    }

    private toMidiList(notes: number | number[]) {
        const list = Array.isArray(notes) ? notes : [notes];
        return list
            .map(note => Tone.Frequency(note).toMidi())
            .map(note => this.instrument === 'E-Bass' ? note - 12 : note)
            .map(note => Math.max(0, Math.min(127, Math.round(note))));
    }
}

class LoopingSampler {
    private output: Tone.Volume;
    private buffers: any;
    private midiNotes: number[];
    private activeSources: Map<number, any> = new Map();
    private sustainVoices: Map<number, { osc: any; gain: Tone.Gain; voiceId: number }> = new Map();
    private releasedNotes: Set<number> = new Set();
    private voiceIds: Map<number, number> = new Map();
    private nextVoiceId = 1;
    private attack: number;
    private release: number;
    private holdMode = false;
    private sustainType: "sine" | "triangle";
    private sustainLevel: number;
    private sustainFadeIn: number;
    private loopStartRatio: number;
    private loopEndRatio: number;
    private loadedPromise: Promise<void>;

    constructor(options: { urls: SampleUrls; baseUrl: string; attack: number; release: number; volume: number; sustainType?: "sine" | "triangle"; sustainLevel?: number; sustainFadeIn?: number; loopStartRatio?: number; loopEndRatio?: number }) {
        this.attack = options.attack;
        this.release = options.release;
        this.sustainType = options.sustainType ?? "sine";
        this.sustainLevel = options.sustainLevel ?? 0.16;
        this.sustainFadeIn = options.sustainFadeIn ?? 0.8;
        this.loopStartRatio = options.loopStartRatio ?? 0.48;
        this.loopEndRatio = options.loopEndRatio ?? 0.88;
        this.output = new Tone.Volume(options.volume);

        const midiUrlMap: Record<number, string> = {};
        Object.entries(options.urls).forEach(([note, url]) => {
            midiUrlMap[Tone.Frequency(note).toMidi()] = url;
        });
        this.midiNotes = Object.keys(midiUrlMap).map(Number).sort((a, b) => a - b);
        this.loadedPromise = new Promise<void>((resolve) => {
            this.buffers = new (Tone as any).Buffers(midiUrlMap, () => resolve(), options.baseUrl);
        });
    }

    get isLoaded(): boolean {
        return !!this.buffers?.loaded;
    }

    whenLoaded(): Promise<void> {
        return this.loadedPromise;
    }

    connect(destination: any) {
        this.output.connect(destination);
        return this;
    }

    set(options: { attack?: number; release?: number; volume?: number }) {
        if (options.attack !== undefined) this.attack = options.attack;
        if (options.release !== undefined) this.release = options.release;
        if (options.volume !== undefined) this.output.volume.value = options.volume;
    }

    setHoldMode(enabled: boolean) {
        this.holdMode = enabled;
    }

    triggerAttack(notes: number | number[], time?: Tone.Unit.Time, velocity: number = 1) {
        const noteList = Array.isArray(notes) ? notes : [notes];
        if (noteList.length <= 1) {
            noteList.forEach(note => this.startOne(note, time, velocity));
            return;
        }

        const prepared = noteList.map(note => this.prepareNote(note));
        const groupDuration = this.holdMode
            ? undefined
            : Math.max(0.12, Math.min(...prepared.map(note => note.buffer.duration / note.playbackRate)) - 0.02);
        prepared.forEach(note => this.startPrepared(note, time, velocity, groupDuration));
    }

    triggerRelease(notes: number | number[], time?: Tone.Unit.Time) {
        const noteList = Array.isArray(notes) ? notes : [notes];
        noteList.forEach(note => this.stopOne(note, time, false));
    }

    triggerAttackRelease(notes: number | number[], duration: Tone.Unit.Time, time?: Tone.Unit.Time, velocity: number = 1) {
        this.triggerAttack(notes, time, velocity);
        const startTime = time === undefined ? Tone.now() : Tone.Time(time).toSeconds();
        const releaseTime = startTime + Tone.Time(duration).toSeconds();
        window.setTimeout(() => this.triggerRelease(notes), Math.max(0, (releaseTime - Tone.now()) * 1000));
    }

    releaseAll(time?: Tone.Unit.Time, hard = false) {
        const now = time ?? Tone.now();
        const allMidi = new Set<number>([
            ...this.activeSources.keys(),
            ...this.voiceIds.keys(),
        ]);
        allMidi.forEach(midi => {
            this.releasedNotes.add(midi);
            this.voiceIds.set(midi, this.nextVoiceId++);
        });
        this.activeSources.forEach(source => {
            try {
                if (hard) source.fadeOut = 0.015;
                source.stop(now);
            } catch {
                // Source may already be stopping; ignore duplicate stop calls.
            }
        });
        this.activeSources.clear();
        this.sustainVoices.forEach(voice => this.stopSustainVoice(voice, now, hard));
        this.sustainVoices.clear();
        this.voiceIds.clear();
    }

    private startOne(freq: number, time?: Tone.Unit.Time, velocity: number = 1) {
        this.startPrepared(this.prepareNote(freq), time, velocity);
    }

    private prepareNote(freq: number) {
        const midiFloat = Tone.Frequency(freq).toMidi();
        const midi = Math.round(midiFloat);
        const closest = this.findClosestMidi(midi);
        const buffer = this.buffers.get(closest);
        const playbackRate = Math.pow(2, (midiFloat - closest) / 12);
        return { freq, midi, closest, buffer, playbackRate };
    }

    private startPrepared(note: { freq: number; midi: number; closest: number; buffer: any; playbackRate: number }, time?: Tone.Unit.Time, velocity: number = 1, duration?: number) {
        const { freq, midi, closest, buffer, playbackRate } = note;
        this.stopOne(freq, undefined, true);
        this.releasedNotes.delete(midi);
        const voiceId = this.nextVoiceId++;
        this.voiceIds.set(midi, voiceId);
        this.startSampleSource(midi, voiceId, freq, buffer, playbackRate, velocity, time, duration);
    }

    private stopOne(freq: number, time?: Tone.Unit.Time, hard = false) {
        const midi = Math.round(Tone.Frequency(freq).toMidi());
        this.releasedNotes.add(midi);
        this.voiceIds.set(midi, this.nextVoiceId++);
        const stopTime = time ?? Tone.now();
        const source = this.activeSources.get(midi);
        if (source) {
            try {
                if (hard) source.fadeOut = 0.015;
                source.stop(stopTime);
            } catch {
                // Source may already be stopping; ignore duplicate stop calls.
            }
            this.activeSources.delete(midi);
        }
        const sustainVoice = this.sustainVoices.get(midi);
        if (sustainVoice) {
            this.stopSustainVoice(sustainVoice, stopTime, hard);
            this.sustainVoices.delete(midi);
        }
        this.voiceIds.delete(midi);
    }

    private findClosestMidi(midi: number) {
        return this.midiNotes.reduce((best, current) => (
            Math.abs(current - midi) < Math.abs(best - midi) ? current : best
        ), this.midiNotes[0]);
    }

    private startSampleSource(midi: number, voiceId: number, freq: number, buffer: any, playbackRate: number, velocity: number, time?: Tone.Unit.Time, duration?: number) {
        if (this.releasedNotes.has(midi)) return;
        if (this.voiceIds.get(midi) !== voiceId) return;
        if (!buffer || !buffer.loaded) return;

        const source = new (Tone as any).BufferSource({
            url: buffer,
            playbackRate,
            loop: false,
            fadeIn: this.attack,
            fadeOut: this.release,
        }).connect(this.output);

        source.start(time, 0, duration, velocity);

        this.activeSources.set(midi, source);
        source.onended = () => {
            if (this.voiceIds.get(midi) !== voiceId) return;
            if (this.activeSources.get(midi) === source) this.activeSources.delete(midi);
        };

        void freq;
        void velocity;
    }

    private startSustainVoice(midi: number, voiceId: number, freq: number, velocity: number, time?: Tone.Unit.Time) {
        const existing = this.sustainVoices.get(midi);
        if (existing) this.stopSustainVoice(existing, Tone.now(), true);

        const startTime = time === undefined ? Tone.now() : Tone.Time(time).toSeconds();
        const gain = new Tone.Gain(0).connect(this.output);
        const osc = new Tone.Oscillator({
            frequency: freq,
            type: this.sustainType,
        }).connect(gain);

        this.sustainVoices.set(midi, { osc, gain, voiceId });
        osc.start(startTime);
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(this.sustainLevel * velocity, startTime + this.sustainFadeIn);
    }

    private stopSustainVoice(voice: { osc: any; gain: Tone.Gain; voiceId: number }, time: Tone.Unit.Time, hard = false) {
        const stopTime = Tone.Time(time).toSeconds();
        const releaseTime = hard ? 0.02 : Math.max(0.08, Math.min(this.release, 0.35));
        try {
            voice.gain.gain.cancelScheduledValues(stopTime);
            voice.gain.gain.setValueAtTime(voice.gain.gain.value, stopTime);
            voice.gain.gain.linearRampToValueAtTime(0, stopTime + releaseTime);
            voice.osc.stop(stopTime + releaseTime + 0.01);
            window.setTimeout(() => {
                voice.osc.dispose?.();
                voice.gain.dispose();
            }, (releaseTime + 0.08) * 1000);
        } catch {
            // Voice may already be stopping.
        }
    }

    private getMicroLoopPoints(buffer: any, closestMidi: number) {
        const audioBuffer: AudioBuffer | null = typeof buffer.get === "function" ? buffer.get() : null;
        const duration = Math.max(0.2, buffer.duration);
        const fundamental = Tone.Frequency(closestMidi, "midi").toFrequency();
        const period = 1 / fundamental;
        const loopLength = Math.max(0.025, Math.min(0.09, period * 10));
        const targetStart = Math.max(0.16, Math.min(duration * 0.24, duration - loopLength - 0.05));

        if (!audioBuffer) {
            return { start: targetStart, end: Math.min(duration - 0.02, targetStart + loopLength) };
        }

        const start = this.findQuietPoint(audioBuffer, targetStart, Math.min(0.12, duration * 0.08));
        const safeStart = Math.max(0, Math.min(start, duration - loopLength - 0.03));
        const endTarget = Math.min(duration - 0.02, safeStart + loopLength);
        const end = this.findMatchingLoopEnd(audioBuffer, safeStart, endTarget, Math.min(0.015, loopLength * 0.35));
        return {
            start: safeStart,
            end: Math.max(safeStart + period * 4, Math.min(end, duration - 0.02)),
        };
    }

    private getLoopPoints(buffer: any) {
        const audioBuffer: AudioBuffer | null = typeof buffer.get === "function" ? buffer.get() : null;
        const duration = Math.max(0.5, buffer.duration);
        const rawStart = duration * this.loopStartRatio;
        const rawEnd = Math.max(rawStart + 0.25, duration * this.loopEndRatio);

        if (!audioBuffer) {
            return {
                start: Math.max(0, Math.min(rawStart, duration - 0.25)),
                end: Math.max(rawStart + 0.2, Math.min(rawEnd, duration - 0.02)),
            };
        }

        const start = this.findQuietPoint(audioBuffer, rawStart, duration * 0.16);
        const end = this.findMatchingLoopEnd(audioBuffer, start, rawEnd, duration * 0.06);
        return {
            start: Math.max(0, Math.min(start, duration - 0.3)),
            end: Math.max(start + 0.25, Math.min(end, duration - 0.02)),
        };
    }

    private findQuietPoint(buffer: AudioBuffer, targetSeconds: number, radiusSeconds: number) {
        const channel = buffer.getChannelData(0);
        const sampleRate = buffer.sampleRate;
        const center = Math.round(targetSeconds * sampleRate);
        const radius = Math.max(32, Math.round(radiusSeconds * sampleRate));
        const start = Math.max(1, center - radius);
        const end = Math.min(channel.length - 2, center + radius);

        let best = center;
        let bestScore = Number.POSITIVE_INFINITY;
        for (let i = start; i <= end; i++) {
            const crossesZero = channel[i - 1] <= 0 && channel[i] >= 0 || channel[i - 1] >= 0 && channel[i] <= 0;
            if (!crossesZero) continue;
            const slope = Math.abs(channel[i + 1] - channel[i - 1]);
            const score = Math.abs(channel[i]) + slope * 0.5 + Math.abs(i - center) / sampleRate * 0.02;
            if (score < bestScore) {
                bestScore = score;
                best = i;
            }
        }

        return best / sampleRate;
    }

    private findMatchingLoopEnd(buffer: AudioBuffer, startSeconds: number, targetSeconds: number, radiusSeconds: number) {
        const channel = buffer.getChannelData(0);
        const sampleRate = buffer.sampleRate;
        const startIndex = Math.max(1, Math.min(channel.length - 2, Math.round(startSeconds * sampleRate)));
        const center = Math.round(targetSeconds * sampleRate);
        const radius = Math.max(32, Math.round(radiusSeconds * sampleRate));
        const from = Math.max(startIndex + Math.round(0.25 * sampleRate), center - radius);
        const to = Math.min(channel.length - 2, center + radius);
        const startValue = channel[startIndex];
        const startSlope = channel[startIndex + 1] - channel[startIndex - 1];

        let best = Math.max(from, Math.min(to, center));
        let bestScore = Number.POSITIVE_INFINITY;
        for (let i = from; i <= to; i++) {
            const crossesZero = channel[i - 1] <= 0 && channel[i] >= 0 || channel[i - 1] >= 0 && channel[i] <= 0;
            if (!crossesZero) continue;
            const slope = channel[i + 1] - channel[i - 1];
            const score =
                Math.abs(channel[i] - startValue) +
                Math.abs(slope - startSlope) * 0.4 +
                Math.abs(i - center) / sampleRate * 0.01;
            if (score < bestScore) {
                bestScore = score;
                best = i;
            }
        }

        return best / sampleRate;
    }
}

export class AudioEngine {
    private synth: any = null;
    private polySynth: any = null;
    private ep2Sampler: any = null;
    private messySampler: any = null;
    private canadiansSampler: any = null;
    private ebassSampler: any = null;
    private filter: Tone.Filter | null = null;
    private expressionGain: Tone.Gain | null = null;
    private reverb: Tone.Reverb | null = null;
    private chorus: Tone.Chorus | null = null;
    private limiter: Tone.Limiter | null = null;
    private surgeOutput: Tone.Gain | null = null;
    private surgeFilter: Tone.Filter | null = null;
    private surgeExpressionGain: Tone.Gain | null = null;
    private initialized = false;
    private initPromise: Promise<void> | null = null;

    // Envelope Settings (0-100 knob values)
    private attackVal: number = 20;   // 0-100 → log 1ms..1500ms
    private sustainVal: number = 70;  // 0-100 → linear 0..100%
    private releaseVal: number = 50;  // 0-100 → log 50ms..5000ms

    // Expression = filtro pasa-bajos (0-100 → log 200Hz..20000Hz)
    private expressionVal: number = 80;

    // Strum timeout tracking (for cancellation)
    private strumTimeouts: number[] = [];

    // Cancel token: incremented on releaseAll/panic to abort pending async attacks
    private attackCancelToken = 0;

    // Metronome
    private metronomeClickHigh: Tone.MembraneSynth | null = null;
    private metronomeClickLow: Tone.MembraneSynth | null = null;
    private metronomeClickHardHigh: Tone.NoiseSynth | null = null;
    private metronomeClickHardLow: Tone.NoiseSynth | null = null;
    private metronomeGain: Tone.Gain | null = null;
    private metronomeEventId: number | null = null;
    private metronomeBpm: number = 120;
    private metronomeTimeSignature: number = 4;
    private metronomeBeatIndex: number = 0;
    private metronomeMuted: boolean = false;
    private metronomeClickSound: 'soft' | 'hard' = 'soft';
    private metronomeBeatCallback: MetronomeBeatCallback | null = null;

    // Current instrument
    private currentInstrument: InstrumentName = 'EP2';
    private holdMode = false;

    private async init() {
        if (this.initialized) return;
        if (this.initPromise) {
            await this.initPromise;
            return;
        }

        this.initPromise = this.buildAudioGraph();
        try {
            await this.initPromise;
        } finally {
            this.initPromise = null;
        }
    }

    private async buildAudioGraph() {
        if (this.initialized) return;

        ensureNativeToneContext();
        ensureIosAudioSession();
        await Tone.start();

        // Limiter to prevent clipping
        this.limiter = new Tone.Limiter(-1).toDestination();
        this.surgeExpressionGain = new Tone.Gain(this.expressionToGain(this.expressionVal)).connect(this.limiter);
        this.surgeFilter = new Tone.Filter({
            type: 'lowpass',
            frequency: this.expressionToHz(this.expressionVal),
            rolloff: -12,
        }).connect(this.surgeExpressionGain);
        this.surgeOutput = new Tone.Gain(SURGE_OUTPUT_GAIN).connect(this.surgeFilter);

        // Reverb for space
        this.reverb = new Tone.Reverb({
            decay: 2.5,
            preDelay: 0.1,
            wet: 0.3
        }).connect(this.limiter);

        // Chorus for richness
        this.chorus = new Tone.Chorus({
            frequency: 1.5,
            delayTime: 3.5,
            depth: 0.7,
            wet: 0.2
        }).connect(this.reverb);

        // Expression filter (low-pass): synth → filter → chorus
        this.expressionGain = new Tone.Gain(this.expressionToGain(this.expressionVal)).connect(this.chorus);
        this.filter = new Tone.Filter({
            type: 'lowpass',
            frequency: this.expressionToHz(this.expressionVal),
            rolloff: -12,
        }).connect(this.expressionGain);

        this.ep2Sampler = new SurgeWasmInstrument('EP2').connect(this.surgeOutput);
        this.polySynth = this.ep2Sampler;
        this.synth = this.ep2Sampler;

        this.messySampler = new SurgeWasmInstrument('Messy').connect(this.surgeOutput);

        this.canadiansSampler = new SurgeWasmInstrument('Canadians').connect(this.surgeOutput);

        this.ebassSampler = new SurgeWasmInstrument('E-Bass').connect(this.surgeOutput);

        this.applyHoldModeToSamplers();

        // NOTE: do NOT block on Tone.loaded() here. Sample buffers load in the
        // background; play methods await only the active sample instrument.

        // Metronome click synths - go directly to destination (bypass limiter/recording)
        this.metronomeGain = new Tone.Gain(0.7).toDestination();

        this.metronomeClickHigh = new Tone.MembraneSynth({
            pitchDecay: 0.008,
            octaves: 2,
            envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 },
            volume: -6,
        }).connect(this.metronomeGain);

        this.metronomeClickLow = new Tone.MembraneSynth({
            pitchDecay: 0.008,
            octaves: 2,
            envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.04 },
            volume: -12,
        }).connect(this.metronomeGain);

        // Hard click - NoiseSynth with tight envelope for a punchy, loud click
        this.metronomeClickHardHigh = new Tone.NoiseSynth({
            noise: { type: 'white' },
            envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.01 },
            volume: -4,
        }).connect(this.metronomeGain);

        this.metronomeClickHardLow = new Tone.NoiseSynth({
            noise: { type: 'pink' },
            envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 },
            volume: -10,
        }).connect(this.metronomeGain);

        this.initialized = true;
        // Apply instrument that was set before init (e.g. 'EP2' from React state)
        this.setInstrument(this.currentInstrument);
        console.log("Audio Engine Initialized with Tone.js");
    }

    public onAudioError: ((message: string) => void) | null = null;

    public async unlock() {
        surgeWasmHost.onError = (message) => this.onAudioError?.(message);
        await this.init();
        ensureIosAudioSession();
        const rawContext = Tone.getContext().rawContext;
        if (typeof AudioContext !== 'undefined' && rawContext instanceof AudioContext && rawContext.state !== 'running') {
            await rawContext.resume();
        }
    }

    // Attack: 0-100 → logarítmico 1ms..1500ms
    public async debugState() {
        const rawContext = Tone.getContext().rawContext;
        return {
            initialized: this.initialized,
            initInFlight: !!this.initPromise,
            currentInstrument: this.currentInstrument,
            holdMode: this.holdMode,
            activeMidiNotes: [...this.activeMidiNotes],
            activeFreqs: [...this.activeFreqs],
            synthInstrument: this.synth?.instrument,
            surgeLoaded: this.synth?.isLoaded,
            contextState: rawContext instanceof AudioContext ? rawContext.state : 'unknown',
            worklet: await this.synth?.debug?.(),
        };
    }

    public setAttack(val: number) {
        this.attackVal = Math.max(0, Math.min(100, val));
    }

    // Sustain: 0-100 → lineal 0%..100%
    public setSustain(val: number) {
        this.sustainVal = Math.max(0, Math.min(100, val));
    }

    // Release: 0-100 → logarítmico 50ms..5000ms
    public setRelease(val: number) {
        this.releaseVal = Math.max(0, Math.min(100, val));
    }

    // Expression: 0-100 → log 500Hz..20000Hz (low-pass filter brightness)
    // 0 = oscuro/apagado pero audible, 100 = brillo completo
    private expressionToHz(val: number): number {
        return 1200 * Math.pow(20000 / 1200, val / 100);
    }

    private expressionToGain(val: number): number {
        return 0.85 + (val / 100) * 0.15;
    }

    public setExpressionControls(val: number) {
        this.expressionVal = Math.max(0, Math.min(100, val));
        if (this.filter) {
            this.filter.frequency.rampTo(this.expressionToHz(this.expressionVal), 0.05);
        }
        if (this.expressionGain) {
            this.expressionGain.gain.rampTo(this.expressionToGain(this.expressionVal), 0.05);
        }
        if (this.surgeFilter) {
            this.surgeFilter.frequency.rampTo(this.expressionToHz(this.expressionVal), 0.05);
        }
        if (this.surgeExpressionGain) {
            this.surgeExpressionGain.gain.rampTo(this.expressionToGain(this.expressionVal), 0.05);
        }
        if (this.chorus) {
            const normalized = this.expressionVal / 100;
            this.chorus.set({
                depth: 0.1 + normalized * 0.75,
                wet: 0.02 + normalized * 0.38,
            });
        }
    }

    public setHoldMode(enabled: boolean) {
        this.holdMode = enabled;
        this.applyHoldModeToSamplers();
    }

    private applyHoldModeToSamplers() {
        this.ep2Sampler?.setHoldMode?.(this.holdMode);
        this.messySampler?.setHoldMode?.(this.holdMode);
        this.canadiansSampler?.setHoldMode?.(this.holdMode);
        this.ebassSampler?.setHoldMode?.(this.holdMode);
    }

    public setInstrument(name: InstrumentName) {
        this.currentInstrument = name;
        if (!this.polySynth || !this.ep2Sampler || !this.messySampler || !this.canadiansSampler || !this.ebassSampler || !this.chorus || !this.reverb) return;
        if (this.synth && this.synth !== this.getSamplerForInstrument(name)) {
            this.attackCancelToken++;
            this.cancelStrumTimeouts();
            this.touchStrumTimeouts.forEach(ids => ids.forEach(id => clearTimeout(id)));
            this.touchStrumTimeouts.clear();
            this.releaseEveryInstrument(false);
        }

        switch (name) {
            case 'EP2':
                this.synth = this.ep2Sampler;
                this.chorus.set({ frequency: 0.9, delayTime: 4.5, depth: 0.25, wet: 0.12 });
                this.reverb.set({ decay: 1.6, preDelay: 0.03, wet: 0.1 });
                break;

            case 'Messy':
                this.synth = this.messySampler;
                this.chorus.set({ frequency: 1.15, delayTime: 3.8, depth: 0.5, wet: 0.18 });
                this.reverb.set({ decay: 2.8, preDelay: 0.05, wet: 0.18 });
                break;

            case 'Canadians':
                this.synth = this.canadiansSampler;
                this.chorus.set({ frequency: 0.35, delayTime: 6.2, depth: 0.72, wet: 0.3 });
                this.reverb.set({ decay: 4.2, preDelay: 0.1, wet: 0.3 });
                break;

            case 'E-Bass':
                this.synth = this.ebassSampler;
                this.chorus.set({ frequency: 0.55, delayTime: 2.1, depth: 0.16, wet: 0.06 });
                this.reverb.set({ decay: 1.1, preDelay: 0.01, wet: 0.06 });
                break;
        }

        this.synth?.activate?.();
        this.setExpressionControls(this.expressionVal);
    }

    private getSamplerForInstrument(name: InstrumentName) {
        switch (name) {
            case 'EP2': return this.ep2Sampler;
            case 'Messy': return this.messySampler;
            case 'Canadians': return this.canadiansSampler;
            case 'E-Bass': return this.ebassSampler;
        }
    }

    private releaseEveryInstrument(hard = false) {
        const now = Tone.now();
        const instruments = new Set([this.ep2Sampler, this.messySampler, this.canadiansSampler, this.ebassSampler, this.polySynth]);
        instruments.forEach(instrument => {
            try {
                instrument?.releaseAll?.(now, hard);
            } catch {
                // Instruments can already be releasing during rapid switches.
            }
        });
        this.activeFreqs = [];
        this.activeMidiNotes = [];
        this.strumEndTime = 0;
        this.touchFreqs.clear();
        this.touchMidiNotes.clear();
    }

    private applyEnvelope(envelope: { attack: number; decay: number; sustain: number; release: number }) {
        this.synth?.set?.({ attack: envelope.attack, release: envelope.release });
    }

    private releaseAllVoices(hard = false) {
        if (!this.synth) return;
        if (this.synth.releaseAll) {
            this.synth.releaseAll(Tone.now(), hard);
            return;
        }
        const freqs = new Set<number>(this.activeFreqs);
        this.touchFreqs.forEach(values => values.forEach(freq => freqs.add(freq)));
        if (freqs.size > 0) {
            this.synth.triggerRelease([...freqs]);
        }
    }

    private getEnvelopeSettings() {
        // Attack: log scale  0→1ms, 50→~40ms, 100→1500ms
        const attack  = 0.001 * Math.pow(1500, this.attackVal  / 100);
        // Sustain: linear 0→0.0, 100→1.0
        const sustain = this.sustainVal / 100;
        // Release: log scale  0→50ms, 50→500ms, 100→5000ms
        const release = 0.05  * Math.pow(100,  this.releaseVal / 100);

        return { attack, decay: 0.05, sustain, release };
    }

    // Wait until the selected instrument's engine has finished loading.
    private async ensureActiveLoaded() {
        const sampler = this.getSamplerForInstrument(this.currentInstrument);
        if (sampler?.whenLoaded && !sampler.isLoaded) {
            await sampler.whenLoaded();
        }
    }

    private playableMidiNotes(midiNotes: number[]) {
        const notes = this.currentInstrument === 'E-Bass' && midiNotes.length > 1
            ? [midiNotes[0]]
            : midiNotes;
        const transpose = this.instrumentTransposeSemitones(this.currentInstrument);
        return transpose === 0
            ? notes
            : notes.map(note => Math.max(0, Math.min(127, note + transpose)));
    }

    private instrumentTransposeSemitones(instrument: InstrumentName) {
        return instrument === 'Canadians' ? 12 : 0;
    }

    public async playNotes(midiNotes: number[], duration: string = "2n") {
        await this.init();
        await this.ensureActiveLoaded();
        if (!this.synth) return;

        // Apply settings
        this.applyEnvelope(this.getEnvelopeSettings());

        const playableNotes = this.playableMidiNotes(midiNotes);
        const freqs = playableNotes.map(n => Tone.Frequency(n, "midi").toFrequency());

        // Trigger
        this.synth.triggerAttackRelease(freqs, duration);
    }

    public async playNotesStrum(midiNotes: number[], speedMs: number = 50) {
        await this.init();
        await this.ensureActiveLoaded();
        if (!this.synth) return;

        this.applyEnvelope(this.getEnvelopeSettings());
        const now = Tone.now();
        const playableNotes = this.playableMidiNotes(midiNotes);

        playableNotes.forEach((note, index) => {
            const freq = Tone.Frequency(note, "midi").toFrequency();
            const time = now + (index * (speedMs / 1000));
            this.synth?.triggerAttackRelease(freq, "2n", time);
        });
    }

    // Track currently playing frequencies for release
    private activeFreqs: number[] = [];
    // Track MIDI notes too, so hold can latch the current chord.
    private activeMidiNotes: number[] = [];
    // Track the end time of strum (when last note attack finishes)
    private strumEndTime: number = 0;

    // Multi-touch: per-touch frequency tracking
    private touchFreqs: Map<string, number[]> = new Map();
    private touchMidiNotes: Map<string, number[]> = new Map();
    // Multi-touch: per-touch strum timeout IDs (para poder cancelarlos en release)
    private touchStrumTimeouts: Map<string, number[]> = new Map();

    private syncActiveMidiFromTouches() {
        const notes = new Set<number>();
        this.touchMidiNotes.forEach(values => values.forEach(note => notes.add(note)));
        this.activeMidiNotes = [...notes].sort((a, b) => a - b);
    }

    // Arpeggiator: crisp note with auto-release, no overlap between steps
    // intervalMs = duration of this step (note will auto-release at 80% of interval)
    public async arpAttackNotes(midiNotes: number[], intervalMs: number) {
        const token = this.attackCancelToken;
        await this.init();
        await this.ensureActiveLoaded();
        if (this.attackCancelToken !== token) return;
        if (!this.synth) return;

        // Stop previous notes without all-sound-off; Surge can mute the next attack after panic.
        this.releaseAllVoices(false);
        this.activeFreqs = [];
        this.activeMidiNotes = [];
        this.touchFreqs.clear();
        this.touchMidiNotes.clear();

        const playableNotes = this.playableMidiNotes(midiNotes);
        const freqs = playableNotes.map(n => Tone.Frequency(n, "midi").toFrequency());
        this.activeFreqs = freqs;
        this.activeMidiNotes = [...playableNotes];

        const durationS = Math.max(0.04, (intervalMs / 1000) * 0.80);
        const releaseS  = Math.min(0.06, durationS * 0.15);

        this.applyEnvelope({
            attack:  0.004,
            decay:   0.04,
            sustain: 0.85,
            release: releaseS,
        });
        this.synth.triggerAttackRelease(freqs, durationS);
    }

    // Hold mode: Attack (start sound)
    public async attackNotes(midiNotes: number[]) {
        const token = this.attackCancelToken;
        await this.init();
        await this.ensureActiveLoaded();
        if (this.attackCancelToken !== token) return;
        if (!this.synth) return;

        // Replace the previous held chord without all-sound-off muting the next Surge attack.
        this.releaseAllVoices(false);
        this.activeFreqs = [];
        this.activeMidiNotes = [];
        this.touchFreqs.clear();
        this.touchMidiNotes.clear();

        this.applyEnvelope(this.getEnvelopeSettings());
        const playableNotes = this.playableMidiNotes(midiNotes);
        this.activeFreqs = playableNotes.map(n => Tone.Frequency(n, "midi").toFrequency());
        this.activeMidiNotes = [...playableNotes];
        this.strumEndTime = 0; // No strum delay
        this.synth.triggerAttack(this.activeFreqs);
    }

    // Multi-touch: attack notes for a specific touch without stopping other touches
    public async attackNotesForTouch(midiNotes: number[], touchId: string) {
        const token = this.attackCancelToken;
        await this.init();
        await this.ensureActiveLoaded();
        if (this.attackCancelToken !== token) return;
        if (!this.synth) return;

        const playableNotes = this.playableMidiNotes(midiNotes);
        const prev = this.touchFreqs.get(touchId);
        const newFreqs = playableNotes.map(n => Tone.Frequency(n, "midi").toFrequency());
        this.touchFreqs.set(touchId, newFreqs);
        this.touchMidiNotes.set(touchId, [...playableNotes]);
        this.syncActiveMidiFromTouches();

        // Release OLD freqs of this touch, but only if not held by another touch
        if (prev && prev.length > 0) {
            const allOtherFreqs = new Set<string>();
            this.touchFreqs.forEach((f, id) => { if (id !== touchId) f.forEach(freq => allOtherFreqs.add(freq.toFixed(2))); });
            const toRelease = prev.filter(f => !allOtherFreqs.has(f.toFixed(2)));
            if (toRelease.length > 0) this.synth.triggerRelease(toRelease);
        }

        // Only attack NEW freqs not already sounding from another touch
        const alreadySounding = new Set<string>();
        this.touchFreqs.forEach((f, id) => { if (id !== touchId) f.forEach(freq => alreadySounding.add(freq.toFixed(2))); });
        const toAttack = newFreqs.filter(f => !alreadySounding.has(f.toFixed(2)));

        this.applyEnvelope(this.getEnvelopeSettings());
        if (toAttack.length > 0) this.synth.triggerAttack(toAttack);
    }

    // Multi-touch: strum for a specific touch
    // totalMs = duración total del strum. Curva cuadrática: acelera hacia las notas finales.
    public async attackNotesStrumForTouch(midiNotes: number[], totalMs: number = 80, touchId: string) {
        const token = this.attackCancelToken;
        await this.init();
        await this.ensureActiveLoaded();
        if (this.attackCancelToken !== token) return;
        if (!this.synth) return;

        // Cancelar strum previo de este touch
        const prevTimeouts = this.touchStrumTimeouts.get(touchId);
        if (prevTimeouts) { prevTimeouts.forEach(id => clearTimeout(id)); }
        this.touchStrumTimeouts.set(touchId, []);

        const playableNotes = this.playableMidiNotes(midiNotes);
        const prev = this.touchFreqs.get(touchId);
        const newFreqs = playableNotes.map(n => Tone.Frequency(n, "midi").toFrequency());
        this.touchFreqs.set(touchId, newFreqs);
        this.touchMidiNotes.set(touchId, [...playableNotes]);
        this.syncActiveMidiFromTouches();

        if (prev && prev.length > 0) {
            const allOtherFreqs = new Set<string>();
            this.touchFreqs.forEach((f, id) => { if (id !== touchId) f.forEach(freq => allOtherFreqs.add(freq.toFixed(2))); });
            const toRelease = prev.filter(f => !allOtherFreqs.has(f.toFixed(2)));
            if (toRelease.length > 0) this.synth.triggerRelease(toRelease);
        }

        this.applyEnvelope(this.getEnvelopeSettings());
        const N = newFreqs.length;
        newFreqs.forEach((freq, index) => {
            // Curva cuadrática ease-in: slow start → fast end
            // t(i) = totalMs * (i / (N-1))^2   (para N=1: siempre 0)
            const t = N > 1 ? (index / (N - 1)) : 0;
            const delayMs = Math.round(totalMs * t * t);

            if (delayMs === 0) {
                this.synth?.triggerAttack(freq, undefined, 0.8);
            } else {
                const id = window.setTimeout(() => {
                    this.synth?.triggerAttack(freq, undefined, 0.8);
                }, delayMs);
                this.touchStrumTimeouts.get(touchId)?.push(id);
            }
        });
    }

    // Multi-touch: release notes for a specific touch
    public releaseNotesForTouch(touchId: string) {
        if (this.holdMode) return;
        if (!this.synth) return;

        // Cancelar strum timeouts pendientes de este touch (fix de notas trabadas)
        const pending = this.touchStrumTimeouts.get(touchId);
        if (pending) { pending.forEach(id => clearTimeout(id)); this.touchStrumTimeouts.delete(touchId); }

        const freqs = this.touchFreqs.get(touchId);
        if (!freqs || freqs.length === 0) {
            this.touchMidiNotes.delete(touchId);
            this.syncActiveMidiFromTouches();
            return;
        }
        this.touchFreqs.delete(touchId);
        this.touchMidiNotes.delete(touchId);
        this.syncActiveMidiFromTouches();

        // Only release freqs not still held by another touch
        const allOtherFreqs = new Set<string>();
        this.touchFreqs.forEach(f => f.forEach(freq => allOtherFreqs.add(freq.toFixed(2))));
        const toRelease = freqs.filter(f => !allOtherFreqs.has(f.toFixed(2)));
        if (toRelease.length > 0) this.synth.triggerRelease(toRelease);
    }

    // Hold mode: Release (stop sound)
    public releaseNotes() {
        if (this.holdMode) return;
        if (!this.synth || this.activeFreqs.length === 0) return;

        // Cancel any pending strum notes that haven't triggered yet
        this.cancelStrumTimeouts();

        // Release all currently sounding notes
        this.synth.triggerRelease(this.activeFreqs);

        this.activeFreqs = [];
        this.activeMidiNotes = [];
        this.strumEndTime = 0;
    }

    // Smooth stop for a latched Hold note/chord. Unlike panic/releaseAll, this sends noteOff
    // so the instrument's own release tail is allowed to ring.
    public releaseHeldNotes() {
        this.attackCancelToken++;
        if (!this.synth) return;

        this.cancelStrumTimeouts();
        this.touchStrumTimeouts.forEach(ids => ids.forEach(id => clearTimeout(id)));
        this.touchStrumTimeouts.clear();

        this.releaseEveryInstrument(false);

        this.activeFreqs = [];
        this.activeMidiNotes = [];
        this.strumEndTime = 0;
        this.touchFreqs.clear();
        this.touchMidiNotes.clear();
    }

    // Force release ALL notes (for glide transitions)
    public releaseAll() {
        this.attackCancelToken++;
        if (!this.synth) return;

        this.cancelStrumTimeouts();
        this.touchStrumTimeouts.forEach(ids => ids.forEach(id => clearTimeout(id)));
        this.touchStrumTimeouts.clear();

        this.releaseEveryInstrument(true);

        this.activeFreqs = [];
        this.activeMidiNotes = [];
        this.strumEndTime = 0;
        this.touchFreqs.clear();
        this.touchMidiNotes.clear();
    }

    // PANIC: Stop everything immediately
    public panic() {
        this.attackCancelToken++;
        if (!this.synth) return;

        this.cancelStrumTimeouts();
        this.touchStrumTimeouts.forEach(ids => ids.forEach(id => clearTimeout(id)));
        this.touchStrumTimeouts.clear();

        this.releaseEveryInstrument(true);

        this.activeFreqs = [];
        this.activeMidiNotes = [];
        this.strumEndTime = 0;
        this.touchFreqs.clear();
        this.touchMidiNotes.clear();
    }

    // Get MediaStream of audio output for recording
    private mediaStreamDest: MediaStreamAudioDestinationNode | null = null;

    public async getOutputStream(): Promise<MediaStream> {
        await this.init();

        // Create MediaStreamDestination if not exists
        if (!this.mediaStreamDest) {
            this.mediaStreamDest = Tone.getContext().createMediaStreamDestination();
            // Connect limiter (final output) to the stream destination
            this.limiter?.connect(this.mediaStreamDest);
        }

        return this.mediaStreamDest.stream;
    }

    // Get the raw AudioContext for loops (separate from recording path)
    public async getAudioContext(): Promise<AudioContext> {
        await this.init();
        // Get the underlying native AudioContext
        const ctx = Tone.getContext().rawContext;
        // Ensure we have a full AudioContext with all methods
        if (ctx instanceof AudioContext) {
            return ctx;
        }
        // Fallback: create a new AudioContext if needed
        return new AudioContext();
    }

    // Get a direct output node that bypasses recording
    // Loops should connect here to avoid being recorded
    public async getDirectOutput(): Promise<AudioNode> {
        await this.init();
        const ctx = Tone.getContext().rawContext as AudioContext;
        return ctx.destination;
    }

    // Cancel all pending strum timeouts
    private cancelStrumTimeouts() {
        for (const id of this.strumTimeouts) {
            clearTimeout(id);
        }
        this.strumTimeouts = [];
    }

    // Hold mode: Attack with strum (humanized)
    // Uses setTimeout instead of Tone.js future scheduling so we can cancel pending notes
    public async attackNotesStrum(midiNotes: number[], speedMs: number = 50, humanize: boolean = true) {
        await this.init();
        await this.ensureActiveLoaded();
        if (!this.synth) return;

        // New chord replaces the previous held/strummed voices without muting Surge's next attack.
        this.releaseAllVoices(false);
        this.activeFreqs = [];
        this.activeMidiNotes = [];
        this.touchFreqs.clear();
        this.touchMidiNotes.clear();
        this.cancelStrumTimeouts();

        this.applyEnvelope(this.getEnvelopeSettings());

        // Humanization: ONLY timing variation, everything else consistent
        const timingVariation = humanize ? 0.6 : 0; // ±60% timing variation
        const velocityFixed = 0.7;

        const playableNotes = this.playableMidiNotes(midiNotes);
        this.activeFreqs = playableNotes.map(n => Tone.Frequency(n, "midi").toFrequency());
        this.activeMidiNotes = [...playableNotes];

        this.activeFreqs.forEach((freq, index) => {
            // Random timing variation
            const timeJitter = humanize
                ? (Math.random() - 0.5) * 2 * timingVariation * speedMs / 1000
                : 0;
            const delayMs = Math.max(0, (index * speedMs) + timeJitter * 1000);

            if (delayMs === 0) {
                // First note: trigger immediately
                this.synth?.triggerAttack(freq, undefined, velocityFixed);
            } else {
                // Subsequent notes: use setTimeout so we can cancel them
                const id = window.setTimeout(() => {
                    this.synth?.triggerAttack(freq, undefined, velocityFixed);
                }, delayMs);
                this.strumTimeouts.push(id);
            }
        });

        this.strumEndTime = 0; // No longer needed for future scheduling
    }

    // ===== METRONOME =====

    public setMetronomeBeatCallback(cb: MetronomeBeatCallback | null) {
        this.metronomeBeatCallback = cb;
    }

    public async startMetronome(bpm: number, timeSignature: number = 4) {
        await this.init();
        // Stop any existing metronome first
        this.stopMetronome();

        this.metronomeBpm = bpm;
        this.metronomeTimeSignature = timeSignature;
        this.metronomeBeatIndex = 0;

        Tone.getTransport().bpm.value = bpm;

        this.metronomeEventId = Tone.getTransport().scheduleRepeat((time) => {
            const isAccent = this.metronomeBeatIndex === 0;

            // Play click (unless muted)
            if (!this.metronomeMuted) {
                if (this.metronomeClickSound === 'hard') {
                    if (isAccent) {
                        this.metronomeClickHardHigh?.triggerAttackRelease('32n', time);
                    } else {
                        this.metronomeClickHardLow?.triggerAttackRelease('32n', time);
                    }
                } else {
                    if (isAccent) {
                        this.metronomeClickHigh?.triggerAttackRelease('C2', '32n', time);
                    } else {
                        this.metronomeClickLow?.triggerAttackRelease('C3', '32n', time);
                    }
                }
            }

            // Fire visual callback on the main thread
            const beatIdx = this.metronomeBeatIndex;
            Tone.getDraw().schedule(() => {
                this.metronomeBeatCallback?.(beatIdx, isAccent);
            }, time);

            this.metronomeBeatIndex = (this.metronomeBeatIndex + 1) % this.metronomeTimeSignature;
        }, '4n');

        Tone.getTransport().start();
    }

    public stopMetronome() {
        if (this.metronomeEventId !== null) {
            Tone.getTransport().clear(this.metronomeEventId);
            this.metronomeEventId = null;
        }
        Tone.getTransport().stop();
        this.metronomeBeatIndex = 0;
    }

    public setMetronomeBpm(bpm: number) {
        this.metronomeBpm = Math.max(30, Math.min(300, bpm));
        Tone.getTransport().bpm.value = this.metronomeBpm;
    }

    public setMetronomeVolume(vol: number) {
        // vol: 0-100
        const gain = Math.max(0, Math.min(100, vol)) / 100;
        this.metronomeGain?.gain.rampTo(gain, 0.05);
    }

    public setMetronomeMuted(muted: boolean) {
        this.metronomeMuted = muted;
    }

    public setMetronomeTimeSignature(ts: number) {
        this.metronomeTimeSignature = ts;
        this.metronomeBeatIndex = 0;
    }

    public setMetronomeClickSound(sound: 'soft' | 'hard') {
        this.metronomeClickSound = sound;
    }
}

export const audioEngine = new AudioEngine();

declare global {
    interface Window {
        __fivoAudioEngine?: AudioEngine;
    }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
    window.__fivoAudioEngine = audioEngine;
}
