import * as Tone from 'tone';
import { midiBus } from './midi';

export type InstrumentName = 'EP2' | 'Messy' | 'Canadians' | 'E-Bass';

export type AudioNotice = 'fallback' | 'engine-stopped';
export type MetronomeBeatCallback = (beat: number, isAccent: boolean) => void;

type SurgeInstrumentName = Extract<InstrumentName, 'EP2' | 'Messy' | 'Canadians' | 'E-Bass'>;
// Subirla cada vez que cambie algo en public/surge/ (rompe la cache de mobile).
const SURGE_ASSET_VERSION = "fatal-notice-20261008-1";
const SURGE_ENGINE_GAIN = 0.78;
const SURGE_OUTPUT_GAIN = 1.85;
const SURGE_READY_TIMEOUT_MS = 45000;
// Decision de Fabian (8ddc0f7): en mobile se pasa antes al respaldo. Ahora con aviso.
const MOBILE_SURGE_READY_TIMEOUT_MS = 15000;
const MOBILE_AUDIO_START_TIMEOUT_MS = 700;

const SURGE_PRESET_URLS: Record<SurgeInstrumentName, string> = {
    EP2: "/surge/presets/ep2.fxp",
    Messy: "/surge/presets/messy.fxp",
    Canadians: "/surge/presets/canadians.fxp",
    "E-Bass": "/surge/presets/ebass.fxp",
};

let nativeToneContextReady = false;

function isMobileAudioOutput() {
    if (typeof window === 'undefined') return false;
    const ua = navigator.userAgent || '';
    return /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua) ||
        (navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua)) ||
        (navigator.maxTouchPoints > 0 && window.matchMedia?.('(pointer: coarse)').matches);
}

function resolveAfterTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | void> {
    return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => resolve(), timeoutMs);
        promise
            .then(value => {
                window.clearTimeout(timeout);
                resolve(value);
            })
            .catch(error => {
                window.clearTimeout(timeout);
                reject(error);
            });
    });
}

async function startAudioContext(useMobileFallback: boolean) {
    if (!useMobileFallback) {
        await Tone.start();
        return;
    }

    await resumeRawContext(MOBILE_AUDIO_START_TIMEOUT_MS);
}

async function resumeRawContext(timeoutMs?: number) {
    const rawContext = Tone.getContext().rawContext as AudioContext;
    if (rawContext.state === 'running' || typeof rawContext.resume !== 'function') return;

    const resumePromise = rawContext.resume();
    if (timeoutMs === undefined) {
        await resumePromise;
        return;
    }

    await resolveAfterTimeout(resumePromise, timeoutMs);
}

// En iOS la Web Audio API sale por el canal de timbre: con la palanca de silencio
// puesta no se escucha nada y no hay ningun error. Pedir 'playback' la manda al canal
// de multimedia. Hay que fijarlo ANTES de que exista el AudioContext, si no ya quedo
// asignado. En el resto de los navegadores no existe y no pasa nada.
function ensureIosAudioSession() {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (!session) return;
    try {
        session.type = 'playback';
    } catch (error) {
        console.warn('No se pudo fijar audioSession', error);
    }
}

function ensureNativeToneContext() {
    if (nativeToneContextReady || typeof window === 'undefined') return;

    ensureIosAudioSession();

    const NativeAudioContext = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!NativeAudioContext) return;

    const rawContext = Tone.getContext().rawContext as unknown;
    const isNative = typeof BaseAudioContext !== 'undefined' && rawContext instanceof BaseAudioContext;

    // iOS no revive un AudioContext que nacio sin un gesto del usuario: se queda
    // 'suspended' para siempre y resume() no resuelve nunca. Tone crea el suyo al
    // importarse, o sea antes de que nadie toque nada. Solo sirve si ya esta despierto;
    // si no, lo reemplazamos por uno creado aca, que si nace dentro del gesto.
    if (isNative && (rawContext as BaseAudioContext).state === 'running') {
        nativeToneContextReady = true;
        return;
    }

    Tone.setContext(new NativeAudioContext({ latencyHint: 'interactive' }) as unknown as AudioContext);
    nativeToneContextReady = true;
}

class SurgeWasmHost {
    private node: AudioWorkletNode | null = null;
    private nodePromise: Promise<AudioWorkletNode> | null = null;
    private ready = false;
    private messageQueue: Record<string, unknown>[] = [];
    private destinations = new Set<any>();
    private lastDebug: Record<string, unknown> | null = null;
    private debugResolvers: Array<(message: Record<string, unknown> | null) => void> = [];
    // Se llama si el motor se detiene despues de haber arrancado.
    onFatalError: ((message: string) => void) | null = null;

    get isLoaded() {
        return this.ready;
    }

    whenLoaded(): Promise<void> {
        return this.ensureNode().then(() => undefined);
    }

    connect(destination: any) {
        this.destinations.add(destination);
        if (this.node) this.connectNode(this.node, destination);
        // El fallo de carga lo maneja ensureActiveLoaded (pasa al respaldo y avisa).
        this.ensureNode().catch(() => undefined);
    }

    send(message: Record<string, unknown>) {
        // MIDI (archivo y salida en vivo) escucha lo mismo que el worklet.
        midiBus.handleWorkletMessage(message);
        if (this.node) {
            this.node.port.postMessage(message);
            return;
        }

        this.messageQueue.push(message);
        // El fallo de carga lo maneja ensureActiveLoaded (pasa al respaldo y avisa).
        this.ensureNode().catch(() => undefined);
    }

    private async ensureNode(): Promise<AudioWorkletNode> {
        if (this.nodePromise) return this.nodePromise;

        this.nodePromise = this.createNode();
        return this.nodePromise;
    }

    private async createNode(): Promise<AudioWorkletNode> {
        const toneContext = Tone.getContext();
        const context = toneContext.rawContext as AudioContext;
        const mobile = isMobileAudioOutput();
        if (!context.audioWorklet) {
            throw new Error("AudioWorklet is not available in this browser");
        }

        const ep2PresetPromise = this.fetchPreset(SURGE_PRESET_URLS.EP2);
        const desktopPresetsPromise = mobile ? null : Promise.all([
            ep2PresetPromise,
            this.fetchPreset(SURGE_PRESET_URLS.Messy),
            this.fetchPreset(SURGE_PRESET_URLS.Canadians),
            this.fetchPreset(SURGE_PRESET_URLS["E-Bass"]),
        ]);

        await context.audioWorklet.addModule(`/surge/fivo-surge-prelude.js?v=${SURGE_ASSET_VERSION}`);
        await context.audioWorklet.addModule(`/surge/fivo-surge-wasm.js?v=${SURGE_ASSET_VERSION}`);
        await context.audioWorklet.addModule(`/surge/fivo-surge-processor.js?v=${SURGE_ASSET_VERSION}`);

        const presets: Partial<Record<SurgeInstrumentName, ArrayBuffer>> = {};
        if (desktopPresetsPromise) {
            const [ep2, messy, canadians, ebass] = await desktopPresetsPromise;
            presets.EP2 = ep2;
            presets.Messy = messy;
            presets.Canadians = canadians;
            presets["E-Bass"] = ebass;
        } else {
            presets.EP2 = await ep2PresetPromise;
        }

        const node = toneContext.createAudioWorkletNode("fivo-surge", {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            processorOptions: {
                mobile,
                presets,
            },
        });

        this.node = node;
        for (const destination of this.destinations) this.connectNode(node, destination);
        node.port.postMessage({ type: "gain", value: SURGE_ENGINE_GAIN });
        for (const message of this.messageQueue.splice(0)) node.port.postMessage(message);

        await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(
                () => reject(new Error("Surge WASM init timed out")),
                mobile ? MOBILE_SURGE_READY_TIMEOUT_MS : SURGE_READY_TIMEOUT_MS
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
                    console.log("Surge WASM ready");
                    resolve();
                }
                if (message?.type === "error") {
                    window.clearTimeout(timeout);
                    reject(new Error(message.error || "Surge WASM init failed"));
                }
                if (message?.type === "processError") {
                    console.warn("Surge WASM process error", message.error);
                    if (message.fatal) this.onFatalError?.(String(message.error));
                }
            };
            node.port.addEventListener("message", handleMessage);
            node.port.start?.();
        });

        if (mobile) this.preloadMobilePresets(node);

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
        const preset = await response.arrayBuffer();
        // Un .fxp empieza con "CcnK". El rewrite de vercel.json devuelve
        // index.html con 200 para cualquier ruta que no exista.
        const magic = String.fromCharCode(...new Uint8Array(preset.slice(0, 4)));
        if (magic !== 'CcnK') throw new Error(`${url} is not a Surge preset`);
        return preset;
    }

    private async fetchPresetWithRetry(url: string, attempts = 4): Promise<ArrayBuffer> {
        for (let attempt = 1; ; attempt++) {
            try {
                return await this.fetchPreset(url);
            } catch (error) {
                if (attempt >= attempts) throw error;
                await new Promise(resolve => window.setTimeout(resolve, 1000 * 3 ** (attempt - 1)));
            }
        }
    }

    private preloadMobilePresets(node: AudioWorkletNode) {
        (["Messy", "Canadians", "E-Bass"] as SurgeInstrumentName[]).forEach(instrument => {
            // Si falla, el instrumento quedaria mudo toda la sesion: se reintenta.
            void this.fetchPresetWithRetry(SURGE_PRESET_URLS[instrument])
                .then(preset => {
                    try {
                        node.port.postMessage({ type: "preset", instrument, preset }, [preset]);
                    } catch {
                        node.port.postMessage({ type: "preset", instrument, preset });
                    }
                })
                .catch(error => {
                    console.warn(`Could not preload ${instrument} Surge preset`, error);
                });
        });
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

class ToneFallbackInstrument {
    private context: AudioContext;
    private output: GainNode;
    private voices = new Map<string, { oscillator: OscillatorNode; gain: GainNode }>();
    private instrument: InstrumentName;
    private oscillatorType: OscillatorType;
    private attack: number;
    private release: number;
    private level: number;

    constructor(instrument: InstrumentName) {
        this.instrument = instrument;
        this.context = Tone.getContext().rawContext as AudioContext;
        const options = this.getOptions(instrument);
        this.oscillatorType = options.oscillatorType;
        this.attack = options.attack;
        this.release = options.release;
        this.level = options.level;
        this.output = this.context.createGain();
        this.output.gain.value = options.outputGain * (isMobileAudioOutput() ? 2.8 : 1);
    }

    get isLoaded(): boolean {
        return true;
    }

    whenLoaded(): Promise<void> {
        return Promise.resolve();
    }

    connect(destination: any) {
        const target = this.unwrapAudioTarget(destination?.input ?? destination);
        try {
            this.output.connect((target ?? this.context.destination) as AudioNode);
        } catch {
            this.output.connect(this.context.destination);
        }
        return this;
    }

    set(options: { attack?: number; release?: number; volume?: number }) {
        if (options.attack !== undefined) this.attack = options.attack;
        if (options.release !== undefined) this.release = options.release;
        if (options.volume !== undefined) this.output.gain.value = Math.pow(10, options.volume / 20);
    }

    setHoldMode(_enabled: boolean) {
        // El respaldo de osciladores sostiene con triggerAttack/triggerRelease.
    }

    activate() {
        // No preset switch needed for the fallback synth.
    }

    debug() {
        return Promise.resolve({
            fallback: true,
            nativeFallback: true,
            instrument: this.instrument,
            contextState: this.context.state,
            activeVoices: this.voices.size,
        });
    }

    triggerAttack(notes: number | number[], time?: Tone.Unit.Time, velocity: number = 1) {
        void this.context.resume?.();
        const noteList = Array.isArray(notes) ? notes : [notes];
        // MIDI tambien con el respaldo: las notas tal como suenan aca.
        midiBus.handleWorkletMessage({ type: 'noteOn', notes: this.toMidi(noteList), velocity: Math.max(1, Math.min(127, Math.round(velocity * 127))) });
        noteList.forEach(note => this.startVoice(this.toFrequency(note), time, velocity));
    }

    triggerRelease(notes: number | number[], time?: Tone.Unit.Time) {
        const noteList = Array.isArray(notes) ? notes : [notes];
        midiBus.handleWorkletMessage({ type: 'noteOff', notes: this.toMidi(noteList) });
        noteList.forEach(note => this.stopVoice(this.toFrequency(note), time));
    }

    private toMidi(noteList: number[]) {
        return noteList.map(note => Math.max(0, Math.min(127, Math.round(Tone.Frequency(note).toMidi()))));
    }

    triggerAttackRelease(notes: number | number[], duration: Tone.Unit.Time, time?: Tone.Unit.Time, velocity: number = 1) {
        this.triggerAttack(notes, time, velocity);
        const startTime = this.toTimeSeconds(time);
        const durationSeconds = typeof duration === 'number' ? duration : Tone.Time(duration).toSeconds();
        window.setTimeout(() => this.triggerRelease(notes), Math.max(1, (startTime + durationSeconds - this.context.currentTime) * 1000));
    }

    releaseAll(time?: Tone.Unit.Time) {
        if (this.voices.size > 0) midiBus.handleWorkletMessage({ type: 'panic' });
        [...this.voices.keys()].forEach(key => this.stopVoiceByKey(key, time, true));
    }

    private getOptions(instrument: InstrumentName) {
        switch (instrument) {
            case 'EP2':
                return {
                    oscillatorType: 'triangle' as OscillatorType,
                    attack: 0.006,
                    release: 0.75,
                    level: 0.22,
                    outputGain: 1.0,
                };
            case 'Messy':
                return {
                    oscillatorType: 'sawtooth' as OscillatorType,
                    attack: 0.012,
                    release: 0.55,
                    level: 0.16,
                    outputGain: 0.9,
                };
            case 'Canadians':
                return {
                    oscillatorType: 'sine' as OscillatorType,
                    attack: 0.025,
                    release: 1.1,
                    level: 0.24,
                    outputGain: 1.0,
                };
            case 'E-Bass':
                return {
                    oscillatorType: 'square' as OscillatorType,
                    attack: 0.004,
                    release: 0.22,
                    level: 0.18,
                    outputGain: 0.9,
                };
        }
    }

    private startVoice(freq: number, time?: Tone.Unit.Time, velocity: number = 1) {
        const key = this.voiceKey(freq);
        this.stopVoiceByKey(key, undefined, true);

        const startTime = this.toTimeSeconds(time);
        const oscillator = this.context.createOscillator();
        const gain = this.context.createGain();
        oscillator.type = this.oscillatorType;
        oscillator.frequency.setValueAtTime(freq, startTime);
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(this.level * Math.max(0.05, Math.min(1, velocity)), startTime + this.attack);
        oscillator.connect(gain).connect(this.output);
        oscillator.start(startTime);
        this.voices.set(key, { oscillator, gain });
    }

    private stopVoice(freq: number, time?: Tone.Unit.Time) {
        this.stopVoiceByKey(this.voiceKey(freq), time, false);
    }

    private stopVoiceByKey(key: string, time?: Tone.Unit.Time, hard = false) {
        const voice = this.voices.get(key);
        if (!voice) return;

        this.voices.delete(key);
        const stopTime = this.toTimeSeconds(time);
        const release = hard ? 0.025 : Math.max(0.04, this.release);

        try {
            voice.gain.gain.cancelScheduledValues(stopTime);
            voice.gain.gain.setValueAtTime(voice.gain.gain.value, stopTime);
            voice.gain.gain.linearRampToValueAtTime(0, stopTime + release);
            voice.oscillator.stop(stopTime + release + 0.02);
            window.setTimeout(() => {
                voice.oscillator.disconnect();
                voice.gain.disconnect();
            }, (release + 0.08) * 1000);
        } catch {
            // The voice may have already been stopped.
        }
    }

    private toFrequency(note: number) {
        return Tone.Frequency(note).toFrequency();
    }

    private toTimeSeconds(time?: Tone.Unit.Time) {
        if (time === undefined) return this.context.currentTime;
        const seconds = typeof time === 'number' ? time : Tone.Time(time).toSeconds();
        return Math.max(this.context.currentTime, seconds);
    }

    private voiceKey(freq: number) {
        return freq.toFixed(2);
    }

    private unwrapAudioTarget(target: any): AudioNode | AudioParam | null {
        const seen = new Set<any>();
        let current = target;

        while (current && !seen.has(current)) {
            seen.add(current);

            if (typeof AudioNode !== "undefined" && current instanceof AudioNode) return current;
            if (typeof AudioParam !== "undefined" && current instanceof AudioParam) return current;
            if (current._nativeAudioNode) {
                current = current._nativeAudioNode;
                continue;
            }
            if (current._nativeAudioParam) {
                current = current._nativeAudioParam;
                continue;
            }
            if (current.input && current.input !== current) {
                current = current.input;
                continue;
            }
            return null;
        }

        return null;
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
    private usingFallbackInstruments = false;
    private noticeListener: ((notice: AudioNotice) => void) | null = null;

    // Avisa a la UI cuando el sonido deja de ser el aprobado (Surge): respaldo
    // de osciladores o motor detenido. Antes pasaba en silencio.
    public onNotice(listener: ((notice: AudioNotice) => void) | null) {
        this.noticeListener = listener;
        surgeWasmHost.onFatalError = listener ? () => listener('engine-stopped') : null;
    }
    private initialized = false;
    private initPromise: Promise<void> | null = null;
    private mobilePrimeNodes: { oscillator: OscillatorNode; gain: GainNode } | null = null;
    private mobilePrimeStopTimeout: number | null = null;

    // Envelope Settings (0-100 knob values)
    private attackVal: number = 20;   // 0-100 → log 1ms..1500ms
    private sustainVal: number = 70;  // 0-100 → linear 0..100%
    private releaseVal: number = 50;  // 0-100 → log 50ms..5000ms

    // Expression = pasa-bajos (0-100 → log 1200Hz..20000Hz; 500..16000 en el respaldo).
    // La UI arranca en 50 (App.tsx), que pisa este valor inicial.
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
        const useMobileFallback = isMobileAudioOutput();
        await startAudioContext(useMobileFallback);

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

        const rawContext = Tone.getContext().rawContext as AudioContext;
        const canUseSurge = Boolean(
            rawContext.audioWorklet &&
            (typeof window === 'undefined' || window.isSecureContext)
        );
        if (canUseSurge) {
            this.ep2Sampler = new SurgeWasmInstrument('EP2').connect(this.surgeOutput);
            this.polySynth = this.ep2Sampler;
            this.synth = this.ep2Sampler;

            this.messySampler = new SurgeWasmInstrument('Messy').connect(this.surgeOutput);

            this.canadiansSampler = new SurgeWasmInstrument('Canadians').connect(this.surgeOutput);

            this.ebassSampler = new SurgeWasmInstrument('E-Bass').connect(this.surgeOutput);
        } else {
            this.activateFallbackInstruments(useMobileFallback
                ? 'Mobile-compatible WebAudio fallback'
                : window.isSecureContext
                    ? 'AudioWorklet is not available in this browser'
                    : 'Surge AudioWorklet requires a secure context');
        }

        this.applyHoldModeToSamplers();

        // No esperar la carga aca: Surge carga en segundo plano y los metodos de
        // ataque esperan solo al instrumento activo (ensureActiveLoaded).

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

    private activateFallbackInstruments(reason: unknown) {
        if (this.usingFallbackInstruments) return;

        console.warn('Using Tone.js fallback instruments', reason);
        this.noticeListener?.('fallback');
        try {
            this.releaseEveryInstrument(true);
        } catch {
            // The primary engine may have failed before it became releasable.
        }

        const destination = this.filter ?? this.limiter;
        this.usingFallbackInstruments = true;
        this.ep2Sampler = new ToneFallbackInstrument('EP2').connect(destination);
        this.polySynth = this.ep2Sampler;
        this.messySampler = new ToneFallbackInstrument('Messy').connect(destination);
        this.canadiansSampler = new ToneFallbackInstrument('Canadians').connect(destination);
        this.ebassSampler = new ToneFallbackInstrument('E-Bass').connect(destination);
        this.synth = null;
        this.applyHoldModeToSamplers();
        this.setInstrument(this.currentInstrument);
    }

    public async unlock() {
        await this.init();
        await resumeRawContext();
    }

    public primeUserGesture() {
        if (!isMobileAudioOutput()) return;

        try {
            ensureNativeToneContext();
            const rawContext = Tone.getContext().rawContext as AudioContext;
            const resumePromise = rawContext.state !== 'running' && typeof rawContext.resume === 'function'
                ? rawContext.resume()
                : null;
            resumePromise?.catch(() => {});

            if (
                typeof rawContext.createOscillator !== 'function' ||
                typeof rawContext.createGain !== 'function' ||
                !rawContext.destination
            ) {
                return;
            }

            if (!this.mobilePrimeNodes) {
                const oscillator = rawContext.createOscillator();
                const gain = rawContext.createGain();
                gain.gain.value = 0.00003;
                oscillator.frequency.value = 440;
                oscillator.connect(gain).connect(rawContext.destination);
                oscillator.start(rawContext.currentTime);
                this.mobilePrimeNodes = { oscillator, gain };
            }

            if (this.mobilePrimeStopTimeout !== null) {
                window.clearTimeout(this.mobilePrimeStopTimeout);
            }
            this.mobilePrimeStopTimeout = window.setTimeout(() => {
                this.stopMobilePrime();
            }, 8000);
        } catch {
            // iOS can throw while suspended; the real engine init retries on the same gesture.
        }
    }

    public preloadMobileAssets(signal?: AbortSignal) {
        if (!isMobileAudioOutput()) return;

        [
            `/surge/fivo-surge-prelude.js?v=${SURGE_ASSET_VERSION}`,
            `/surge/fivo-surge-wasm.js?v=${SURGE_ASSET_VERSION}`,
            `/surge/fivo-surge-processor.js?v=${SURGE_ASSET_VERSION}`,
            SURGE_PRESET_URLS.EP2,
        ].forEach(url => {
            fetch(url, {
                cache: 'force-cache',
                signal,
            }).catch(() => {});
        });
    }

    private stopMobilePrime() {
        if (this.mobilePrimeStopTimeout !== null) {
            window.clearTimeout(this.mobilePrimeStopTimeout);
            this.mobilePrimeStopTimeout = null;
        }

        const nodes = this.mobilePrimeNodes;
        this.mobilePrimeNodes = null;
        if (!nodes) return;

        try {
            nodes.oscillator.stop();
        } catch {
            // The oscillator may already have been stopped by the browser.
        }

        window.setTimeout(() => {
            nodes.oscillator.disconnect();
            nodes.gain.disconnect();
        }, 30);
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
            contextState: (rawContext as { state?: string })?.state ?? 'unknown',
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

    // Expression: 0-100 → log 1200Hz..20000Hz (pasa-bajos despues de Surge)
    // 0 = oscuro/apagado pero audible, 100 = brillo completo
    private expressionToHz(val: number): number {
        return 1200 * Math.pow(20000 / 1200, val / 100);
    }

    private expressionToGain(val: number): number {
        return 0.85 + (val / 100) * 0.15;
    }

    private fallbackExpressionToHz(val: number): number {
        return 500 * Math.pow(16000 / 500, val / 100);
    }

    private fallbackExpressionToGain(val: number): number {
        return 0.35 + (val / 100) * 0.75;
    }

    public setExpressionControls(val: number) {
        this.expressionVal = Math.max(0, Math.min(100, val));
        if (this.filter) {
            this.filter.frequency.rampTo(
                this.usingFallbackInstruments
                    ? this.fallbackExpressionToHz(this.expressionVal)
                    : this.expressionToHz(this.expressionVal),
                0.05
            );
        }
        if (this.expressionGain) {
            this.expressionGain.gain.rampTo(
                this.usingFallbackInstruments
                    ? this.fallbackExpressionToGain(this.expressionVal)
                    : this.expressionToGain(this.expressionVal),
                0.05
            );
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
        this.releasedTouchIds.clear();
        this.touchAttackStartedAt.clear();
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
            try {
                await sampler.whenLoaded();
            } catch (error) {
                this.activateFallbackInstruments(error);
                const fallback = this.getSamplerForInstrument(this.currentInstrument);
                if (fallback?.whenLoaded && !fallback.isLoaded) {
                    await fallback.whenLoaded();
                }
            }
        }
    }

    private playableMidiNotes(midiNotes: number[]) {
        const notes = this.currentInstrument === 'E-Bass' && midiNotes.length > 1
            ? [midiNotes[0]]
            : midiNotes;
        const transpose = this.instrumentTransposeSemitones(this.currentInstrument);
        const totalTranspose = transpose;
        return totalTranspose === 0
            ? notes
            : notes.map(note => Math.max(0, Math.min(127, note + totalTranspose)));
    }

    private instrumentTransposeSemitones(instrument: InstrumentName) {
        return instrument === 'Canadians' ? 12 : 0;
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
    private releasedTouchIds: Set<string> = new Set();
    private touchAttackStartedAt: Map<string, number> = new Map();
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
        const isTouch = touchId.startsWith('touch-');
        // Un id (dedo, mouse o tecla) que se suelta mientras carga el motor queda
        // marcado en releasedTouchIds: al terminar la carga suena corto en vez
        // de quedar colgado.
        this.releasedTouchIds.delete(touchId);
        if (isTouch) {
            this.touchAttackStartedAt.set(touchId, performance.now());
        }
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
        if (this.releasedTouchIds.has(touchId)) {
            this.releasedTouchIds.delete(touchId);
            this.touchFreqs.delete(touchId);
            this.touchMidiNotes.delete(touchId);
            this.touchAttackStartedAt.delete(touchId);
            this.syncActiveMidiFromTouches();
            if (toAttack.length > 0) this.synth.triggerAttackRelease(toAttack, 0.16);
            return;
        }

        if (toAttack.length > 0) this.synth.triggerAttack(toAttack);
    }

    // Multi-touch: strum for a specific touch
    // totalMs = duración total del strum. Curva cuadrática: acelera hacia las notas finales.
    public async attackNotesStrumForTouch(midiNotes: number[], totalMs: number = 80, touchId: string) {
        const token = this.attackCancelToken;
        const isTouch = touchId.startsWith('touch-');
        // Un id (dedo, mouse o tecla) que se suelta mientras carga el motor queda
        // marcado en releasedTouchIds: al terminar la carga suena corto en vez
        // de quedar colgado.
        this.releasedTouchIds.delete(touchId);
        if (isTouch) {
            this.touchAttackStartedAt.set(touchId, performance.now());
        }
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
        if (this.releasedTouchIds.has(touchId)) {
            this.releasedTouchIds.delete(touchId);
            this.touchFreqs.delete(touchId);
            this.touchMidiNotes.delete(touchId);
            this.touchAttackStartedAt.delete(touchId);
            this.syncActiveMidiFromTouches();
            if (newFreqs.length > 0) this.synth.triggerAttackRelease(newFreqs, 0.16);
            return;
        }

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
        const isTouch = touchId.startsWith('touch-');
        if (!this.synth) {
            this.releasedTouchIds.add(touchId);
            return;
        }

        // Cancelar strum timeouts pendientes de este touch (fix de notas trabadas)
        const pending = this.touchStrumTimeouts.get(touchId);
        if (pending) { pending.forEach(id => clearTimeout(id)); this.touchStrumTimeouts.delete(touchId); }

        const freqs = this.touchFreqs.get(touchId);
        if (!freqs || freqs.length === 0) {
            this.releasedTouchIds.add(touchId);
            this.touchMidiNotes.delete(touchId);
            this.syncActiveMidiFromTouches();
            return;
        }

        const releaseStartedAt = this.touchAttackStartedAt.get(touchId);
        const minTouchMs = isTouch ? 140 : 0;
        const elapsedMs = releaseStartedAt === undefined ? minTouchMs : performance.now() - releaseStartedAt;
        const release = () => {
            if (releaseStartedAt !== undefined && this.touchAttackStartedAt.get(touchId) !== releaseStartedAt) return;

            this.touchFreqs.delete(touchId);
            this.touchMidiNotes.delete(touchId);
            this.touchAttackStartedAt.delete(touchId);
            this.syncActiveMidiFromTouches();

            // Only release freqs not still held by another touch
            const allOtherFreqs = new Set<string>();
            this.touchFreqs.forEach(f => f.forEach(freq => allOtherFreqs.add(freq.toFixed(2))));
            const toRelease = freqs.filter(f => !allOtherFreqs.has(f.toFixed(2)));
            if (toRelease.length > 0) this.synth.triggerRelease(toRelease);
        };

        const waitMs = Math.max(0, minTouchMs - elapsedMs);
        if (waitMs > 0) {
            window.setTimeout(release, waitMs);
            return;
        }

        release();
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
        const token = this.attackCancelToken;
        await this.init();
        await this.ensureActiveLoaded();
        if (this.attackCancelToken !== token) return;
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

if (typeof window !== 'undefined') {
    const audioDebugEnabled = new URLSearchParams(window.location.search).has('audioDebug');
    if (import.meta.env.DEV || audioDebugEnabled) {
        window.__fivoAudioEngine = audioEngine;
    }
}
