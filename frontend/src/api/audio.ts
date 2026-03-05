import * as Tone from 'tone';

export type InstrumentName = 'Piano' | 'E.Piano' | 'Synth' | 'Organ';

export type MetronomeBeatCallback = (beat: number, isAccent: boolean) => void;

export class AudioEngine {
    private synth: Tone.PolySynth | null = null;
    private filter: Tone.Filter | null = null;
    private reverb: Tone.Reverb | null = null;
    private chorus: Tone.Chorus | null = null;
    private limiter: Tone.Limiter | null = null;
    private initialized = false;

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
    private currentInstrument: InstrumentName = 'Piano';

    private async init() {
        if (this.initialized) return;

        await Tone.start();

        // Limiter to prevent clipping
        this.limiter = new Tone.Limiter(-1).toDestination();

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
        this.filter = new Tone.Filter({
            type: 'lowpass',
            frequency: this.expressionToHz(this.expressionVal),
            rolloff: -12,
        }).connect(this.chorus);

        // Main Synth
        this.synth = new Tone.PolySynth(Tone.Synth, {
            oscillator: {
                type: "fatsawtooth",
                count: 3,
                spread: 30
            },
            envelope: {
                attack: 0.05,
                decay: 0.1,
                sustain: 0.6,
                release: 1
            },
            volume: -8
        }).connect(this.filter);

        // Set max polyphony (must be done after construction)
        this.synth.maxPolyphony = 64;

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
        // Apply instrument that was set before init (e.g. 'Piano' from React state)
        this.setInstrument(this.currentInstrument);
        console.log("Audio Engine Initialized with Tone.js");
    }

    // Attack: 0-100 → logarítmico 1ms..1500ms
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
        return 500 * Math.pow(40, val / 100);
    }

    public setExpression(val: number) {
        this.expressionVal = Math.max(0, Math.min(100, val));
        if (this.filter) {
            this.filter.frequency.rampTo(this.expressionToHz(this.expressionVal), 0.05);
        }
    }

    public setInstrument(name: InstrumentName) {
        this.currentInstrument = name;
        if (!this.synth || !this.chorus || !this.reverb) return;

        switch (name) {
            case 'Piano':
                this.synth.set({
                    oscillator: { type: "triangle" } as any,
                    envelope: { attack: 0.02, decay: 0.3, sustain: 0.3, release: 1.2 },
                    volume: -8,
                });
                this.chorus.set({ wet: 0 });
                this.reverb.set({ wet: 0.2 });
                break;

            case 'E.Piano':
                this.synth.set({
                    oscillator: { type: "fmsine", modulationType: "sine", modulationIndex: 3, harmonicity: 2 } as any,
                    envelope: { attack: 0.02, decay: 0.5, sustain: 0.4, release: 1.5 },
                    volume: -8,
                });
                this.chorus.set({ wet: 0.4 });
                this.reverb.set({ wet: 0.25 });
                break;

            case 'Synth':
                this.synth.set({
                    oscillator: { type: "fatsawtooth", count: 3, spread: 30 } as any,
                    envelope: { attack: 0.05, decay: 0.1, sustain: 0.6, release: 1 },
                    volume: -8,
                });
                this.chorus.set({ wet: 0.2 });
                this.reverb.set({ wet: 0.3 });
                break;

            case 'Organ':
                this.synth.set({
                    oscillator: { type: "fatsquare", count: 3, spread: 8 } as any,
                    envelope: { attack: 0.01, decay: 0.01, sustain: 1.0, release: 0.05 },
                    volume: -14,
                });
                this.chorus.set({ wet: 0.25 });
                this.reverb.set({ wet: 0.1 });
                break;
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

    public async playNotes(midiNotes: number[], duration: string = "2n") {
        await this.init();
        if (!this.synth) return;

        // Apply settings
        this.synth.set({ envelope: this.getEnvelopeSettings() });

        const freqs = midiNotes.map(n => Tone.Frequency(n, "midi").toFrequency());

        // Trigger
        this.synth.triggerAttackRelease(freqs, duration);
    }

    public async playNotesStrum(midiNotes: number[], speedMs: number = 50) {
        await this.init();
        if (!this.synth) return;

        this.synth.set({ envelope: this.getEnvelopeSettings() });
        const now = Tone.now();

        midiNotes.forEach((note, index) => {
            const freq = Tone.Frequency(note, "midi").toFrequency();
            const time = now + (index * (speedMs / 1000));
            this.synth?.triggerAttackRelease(freq, "2n", time);
        });
    }

    // Track currently playing frequencies for release
    private activeFreqs: number[] = [];
    // Track the end time of strum (when last note attack finishes)
    private strumEndTime: number = 0;

    // Multi-touch: per-touch frequency tracking
    private touchFreqs: Map<string, number[]> = new Map();
    // Multi-touch: per-touch strum timeout IDs (para poder cancelarlos en release)
    private touchStrumTimeouts: Map<string, number[]> = new Map();

    // Arpeggiator: crisp note with auto-release, no overlap between steps
    // intervalMs = duration of this step (note will auto-release at 80% of interval)
    public async arpAttackNotes(midiNotes: number[], intervalMs: number) {
        const token = this.attackCancelToken;
        await this.init();
        if (this.attackCancelToken !== token) return;
        if (!this.synth) return;

        // Hard-stop previous note immediately (no long release tail)
        this.synth.releaseAll(Tone.now());
        this.activeFreqs = [];

        const freqs = midiNotes.map(n => Tone.Frequency(n, "midi").toFrequency());
        this.activeFreqs = freqs;

        const durationS = Math.max(0.04, (intervalMs / 1000) * 0.80);
        const releaseS  = Math.min(0.06, durationS * 0.15);

        this.synth.set({
            envelope: {
                attack:  0.004,
                decay:   0.04,
                sustain: 0.85,
                release: releaseS,
            }
        });
        this.synth.triggerAttackRelease(freqs, durationS);
    }

    // Hold mode: Attack (start sound)
    public async attackNotes(midiNotes: number[]) {
        const token = this.attackCancelToken;
        await this.init();
        if (this.attackCancelToken !== token) return;
        if (!this.synth) return;

        // Release any currently playing notes first
        this.releaseNotes();

        this.synth.set({ envelope: this.getEnvelopeSettings() });
        this.activeFreqs = midiNotes.map(n => Tone.Frequency(n, "midi").toFrequency());
        this.strumEndTime = 0; // No strum delay
        this.synth.triggerAttack(this.activeFreqs);
    }

    // Multi-touch: attack notes for a specific touch without stopping other touches
    public async attackNotesForTouch(midiNotes: number[], touchId: string) {
        const token = this.attackCancelToken;
        await this.init();
        if (this.attackCancelToken !== token) return;
        if (!this.synth) return;

        const prev = this.touchFreqs.get(touchId);
        const newFreqs = midiNotes.map(n => Tone.Frequency(n, "midi").toFrequency());
        this.touchFreqs.set(touchId, newFreqs);

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

        this.synth.set({ envelope: this.getEnvelopeSettings() });
        if (toAttack.length > 0) this.synth.triggerAttack(toAttack);
    }

    // Multi-touch: strum for a specific touch
    // totalMs = duración total del strum. Curva cuadrática: acelera hacia las notas finales.
    public async attackNotesStrumForTouch(midiNotes: number[], totalMs: number = 80, touchId: string) {
        const token = this.attackCancelToken;
        await this.init();
        if (this.attackCancelToken !== token) return;
        if (!this.synth) return;

        // Cancelar strum previo de este touch
        const prevTimeouts = this.touchStrumTimeouts.get(touchId);
        if (prevTimeouts) { prevTimeouts.forEach(id => clearTimeout(id)); }
        this.touchStrumTimeouts.set(touchId, []);

        const prev = this.touchFreqs.get(touchId);
        const newFreqs = midiNotes.map(n => Tone.Frequency(n, "midi").toFrequency());
        this.touchFreqs.set(touchId, newFreqs);

        if (prev && prev.length > 0) {
            const allOtherFreqs = new Set<string>();
            this.touchFreqs.forEach((f, id) => { if (id !== touchId) f.forEach(freq => allOtherFreqs.add(freq.toFixed(2))); });
            const toRelease = prev.filter(f => !allOtherFreqs.has(f.toFixed(2)));
            if (toRelease.length > 0) this.synth.triggerRelease(toRelease);
        }

        this.synth.set({ envelope: this.getEnvelopeSettings() });
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
        if (!this.synth) return;

        // Cancelar strum timeouts pendientes de este touch (fix de notas trabadas)
        const pending = this.touchStrumTimeouts.get(touchId);
        if (pending) { pending.forEach(id => clearTimeout(id)); this.touchStrumTimeouts.delete(touchId); }

        const freqs = this.touchFreqs.get(touchId);
        if (!freqs || freqs.length === 0) return;
        this.touchFreqs.delete(touchId);

        // Only release freqs not still held by another touch
        const allOtherFreqs = new Set<string>();
        this.touchFreqs.forEach(f => f.forEach(freq => allOtherFreqs.add(freq.toFixed(2))));
        const toRelease = freqs.filter(f => !allOtherFreqs.has(f.toFixed(2)));
        if (toRelease.length > 0) this.synth.triggerRelease(toRelease);
    }

    // Hold mode: Release (stop sound)
    public releaseNotes() {
        if (!this.synth || this.activeFreqs.length === 0) return;

        // Cancel any pending strum notes that haven't triggered yet
        this.cancelStrumTimeouts();

        // Release all currently sounding notes
        this.synth.triggerRelease(this.activeFreqs);

        this.activeFreqs = [];
        this.strumEndTime = 0;
    }

    // Force release ALL notes (for glide transitions)
    public releaseAll() {
        this.attackCancelToken++;
        if (!this.synth) return;

        this.cancelStrumTimeouts();
        this.touchStrumTimeouts.forEach(ids => ids.forEach(id => clearTimeout(id)));
        this.touchStrumTimeouts.clear();

        this.synth.releaseAll(Tone.now());

        this.activeFreqs = [];
        this.strumEndTime = 0;
        this.touchFreqs.clear();
    }

    // PANIC: Stop everything immediately
    public panic() {
        this.attackCancelToken++;
        if (!this.synth) return;

        this.cancelStrumTimeouts();
        this.touchStrumTimeouts.forEach(ids => ids.forEach(id => clearTimeout(id)));
        this.touchStrumTimeouts.clear();

        this.synth.releaseAll(Tone.now());

        this.activeFreqs = [];
        this.strumEndTime = 0;
        this.touchFreqs.clear();
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
        if (!this.synth) return;

        // Release any currently playing notes first
        this.releaseNotes();

        this.synth.set({ envelope: this.getEnvelopeSettings() });

        // Cancel any previous strum timeouts
        this.cancelStrumTimeouts();

        // Humanization: ONLY timing variation, everything else consistent
        const timingVariation = humanize ? 0.6 : 0; // ±60% timing variation
        const velocityFixed = 0.7;

        this.activeFreqs = midiNotes.map(n => Tone.Frequency(n, "midi").toFrequency());

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
