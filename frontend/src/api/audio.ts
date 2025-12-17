import * as Tone from 'tone';

export class AudioEngine {
    private synth: Tone.PolySynth | null = null;
    private reverb: Tone.Reverb | null = null;
    private chorus: Tone.Chorus | null = null;
    private limiter: Tone.Limiter | null = null;
    private initialized = false;

    // Articulation Settings
    private articulationLevel: number = 2; // 0=Staccato ... 3=Legato
    private expressionEnabled: boolean = false;

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

        // Main Synth (Sawtooth + Sine blend via AM or simple addition)
        // Using FMSynth or FMSynth-like configuration for "glassy" professional sound
        this.synth = new Tone.PolySynth(Tone.Synth, {
            oscillator: {
                type: "fatsawtooth", // Richer than basic triangle
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
        }).connect(this.chorus);

        this.initialized = true;
        console.log("Audio Engine Initialized with Tone.js");
    }

    public setArticulation(level: number) {
        this.articulationLevel = Math.max(0, Math.min(3, level));
    }

    public setExpression(enabled: boolean) {
        this.expressionEnabled = enabled;
    }

    private getEnvelopeSettings() {
        // dynamic envelope based on articulation
        // Level 0: Staccato (Short release)
        // Level 3: Legato (Long release, slow attack)

        const base = {
            attack: 0.02,
            decay: 0.1,
            sustain: 0.7,
            release: 1.0
        };

        switch (this.articulationLevel) {
            case 0: // Staccato
                base.release = 0.1;
                base.sustain = 0.1;
                break;
            case 1:
                base.release = 0.5;
                break;
            case 2: // Normal
                base.release = 1.2;
                break;
            case 3: // Legato / Pad
                base.attack = 0.2;
                base.release = 3.0;
                base.sustain = 0.9;
                break;
        }

        if (this.expressionEnabled) {
            // Add more dynamism
            base.attack += 0.05;
            base.release += 0.5;
        }

        return base;
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
}

export const audioEngine = new AudioEngine();
