/* global AudioWorkletProcessor, registerProcessor, sampleRate, createFivoSurgeModule */

class FivoSurgeProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.module = null;
        this.ready = false;
        this.error = null;
        this.currentInstrument = "EP2";
        this.engines = new Map();
        this.polyEngines = new Map();
        this.pendingMessages = [];
        this.leftPtr = 0;
        this.rightPtr = 0;
        this.frames = 128;
        this.processCount = 0;
        this.lastPeak = 0;
        this.lastRms = 0;
        this.processErrorReported = false;
        this.holdEnabled = new Map();
        this.activeNotes = new Map();
        this.holdStates = new Map();
        this.holdWarmupSamples = Math.round(sampleRate * 0.09);
        this.holdTargetRms = 0.055;
        this.holdFloorRms = 0.00035;
        this.holdMaxGain = 7.5;
        this.ebassSustain = { age: 0, gain: 1, phase: 0, note: null };
        this.ebassSustainStartSamples = Math.round(sampleRate * 0.85);
        this.ebassSustainFadeSamples = Math.round(sampleRate * 0.35);
        this.ebassSustainCeilingRms = 0.026;
        this.ebassSustainCeilingPeak = 0.055;
        this.ebassTailLevel = 0.032;

        this.port.onmessage = (event) => this.handleMessage(event.data);
        this.init(options?.processorOptions?.presets ?? {});
    }

    async init(presets) {
        try {
            if (typeof createFivoSurgeModule !== "function") {
                throw new Error("Surge WASM module was not loaded");
            }

            const Module = await createFivoSurgeModule({
                print: () => {},
                printErr: (message) => console.warn("[Fivo Surge]", message),
            });

            this.module = Module;
            this.frames = 128;
            this.leftPtr = Module._malloc(this.frames * 4);
            this.rightPtr = Module._malloc(this.frames * 4);

            this.loadEngine("EP2", presets.EP2);
            this.loadEngine("Messy", presets.Messy);
            this.loadEngine("Canadians", presets.Canadians);
            this.loadPolyEngine("E-Bass", presets["E-Bass"], 8);

            this.ready = true;
            this.port.postMessage({ type: "ready" });

            const pending = this.pendingMessages.splice(0);
            for (const message of pending) this.handleMessage(message);
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
            this.port.postMessage({ type: "error", error: this.error });
        }
    }

    loadEngine(instrument, presetBuffer) {
        this.engines.set(instrument, this.createLoadedEngine(instrument, presetBuffer));
    }

    loadPolyEngine(instrument, presetBuffer, voiceCount) {
        if (!presetBuffer) throw new Error(`Missing ${instrument} preset`);

        const engines = [];
        for (let i = 0; i < voiceCount; i++) {
            engines.push(this.createLoadedEngine(`${instrument} voice ${i + 1}`, presetBuffer));
        }

        this.polyEngines.set(instrument, {
            engines,
            activeNotes: new Map(),
            nextEngine: 0,
        });
    }

    createLoadedEngine(instrument, presetBuffer) {
        if (!presetBuffer) throw new Error(`Missing ${instrument} preset`);

        const Module = this.module;
        const engine = Module._fivo_surge_create(sampleRate);
        if (!engine) {
            throw new Error(Module.UTF8ToString(Module._fivo_surge_last_error()));
        }

        const presetBytes = new Uint8Array(presetBuffer);
        const presetPtr = Module._malloc(presetBytes.byteLength);
        Module.HEAPU8.set(presetBytes, presetPtr);
        const loaded = Module._fivo_surge_load_fxp(engine, presetPtr, presetBytes.byteLength);
        Module._free(presetPtr);

        if (loaded !== 0) {
            Module._fivo_surge_destroy(engine);
            throw new Error(`Failed to load ${instrument} preset: ${loaded}`);
        }

        return engine;
    }

    handleMessage(message) {
        if (!message || typeof message.type !== "string") return;
        if (!this.ready) {
            this.pendingMessages.push(message);
            return;
        }

        const Module = this.module;
        const instrument = message.instrument || this.currentInstrument;

        switch (message.type) {
            case "instrument":
                if (this.engines.has(instrument) || this.polyEngines.has(instrument)) this.currentInstrument = instrument;
                break;

            case "noteOn":
                this.forNotes(message.notes, (note) => {
                    this.noteOn(instrument, note, this.velocity(message.velocity, 100));
                });
                break;

            case "noteOff":
                this.forNotes(message.notes, (note) => {
                    this.noteOff(instrument, note, this.velocity(message.velocity, 64));
                });
                break;

            case "hold":
                this.setHold(instrument, !!message.enabled);
                break;

            case "panic":
                for (const engine of this.engines.values()) {
                    Module._fivo_surge_all_sound_off(engine);
                }
                for (const group of this.polyEngines.values()) {
                    for (const engine of group.engines) Module._fivo_surge_all_sound_off(engine);
                    group.activeNotes.clear();
                }
                for (const notes of this.activeNotes.values()) notes.clear();
                for (const instrumentName of this.holdStates.keys()) this.resetHoldState(instrumentName);
                break;

            case "gain":
                for (const engine of this.engines.values()) {
                    Module._fivo_surge_set_gain(engine, Number(message.value) || 0.35);
                }
                for (const group of this.polyEngines.values()) {
                    for (const engine of group.engines) Module._fivo_surge_set_gain(engine, Number(message.value) || 0.35);
                }
                break;

            case "debug":
                this.port.postMessage({
                    type: "debug",
                    ready: this.ready,
                    error: this.error,
                    currentInstrument: this.currentInstrument,
                    processCount: this.processCount,
                    lastPeak: this.lastPeak,
                    lastRms: this.lastRms,
                    activeNotes: Object.fromEntries([...this.activeNotes.entries()].map(([name, notes]) => [name, [...notes]])),
                    polyActiveNotes: Object.fromEntries([...this.polyEngines.entries()].map(([name, group]) => [name, [...group.activeNotes.keys()]])),
                });
                break;
        }
    }

    noteOn(instrument, note, velocity) {
        this.trackNoteOn(instrument, note);
        this.resetHoldState(instrument);
        if (instrument === "E-Bass") {
            this.resetEbassSustain();
            this.ebassSustain.note = note;
        }

        const polyGroup = this.polyEngines.get(instrument);
        if (polyGroup) {
            this.polyNoteOn(polyGroup, note, velocity);
            return;
        }

        this.module._fivo_surge_note_on(this.engineFor(instrument), note, velocity);
    }

    noteOff(instrument, note, velocity) {
        this.trackNoteOff(instrument, note);

        const polyGroup = this.polyEngines.get(instrument);
        if (polyGroup) {
            this.polyNoteOff(polyGroup, note, velocity);
            if (this.activeNoteCount(instrument) === 0) this.resetHoldState(instrument);
            if (instrument === "E-Bass" && this.activeNoteCount(instrument) === 0) this.resetEbassSustain();
            return;
        }

        this.module._fivo_surge_note_off(this.engineFor(instrument), note, velocity);
        if (this.activeNoteCount(instrument) === 0) this.resetHoldState(instrument);
        if (instrument === "E-Bass" && this.activeNoteCount(instrument) === 0) this.resetEbassSustain();
    }

    polyNoteOn(group, note, velocity) {
        const Module = this.module;
        const existingIndex = group.activeNotes.get(note);
        if (existingIndex !== undefined) {
            const existingEngine = group.engines[existingIndex];
            Module._fivo_surge_note_off(existingEngine, note, 64);
        }

        const usedEngines = new Set(group.activeNotes.values());
        let engineIndex = group.engines.findIndex((_, index) => !usedEngines.has(index));

        if (engineIndex < 0) {
            engineIndex = group.nextEngine % group.engines.length;
            const engine = group.engines[engineIndex];
            Module._fivo_surge_all_sound_off(engine);
            for (const [activeNote, activeIndex] of [...group.activeNotes.entries()]) {
                if (activeIndex === engineIndex) group.activeNotes.delete(activeNote);
            }
        }

        group.nextEngine = (engineIndex + 1) % group.engines.length;
        group.activeNotes.set(note, engineIndex);
        Module._fivo_surge_note_on(group.engines[engineIndex], note, velocity);
    }

    polyNoteOff(group, note, velocity) {
        const engineIndex = group.activeNotes.get(note);
        if (engineIndex === undefined) return;

        this.module._fivo_surge_note_off(group.engines[engineIndex], note, velocity);
        group.activeNotes.delete(note);
    }

    setHold(instrument, enabled) {
        this.holdEnabled.set(instrument, enabled);
        if (!enabled) this.resetHoldState(instrument);
    }

    trackNoteOn(instrument, note) {
        let notes = this.activeNotes.get(instrument);
        if (!notes) {
            notes = new Set();
            this.activeNotes.set(instrument, notes);
        }
        notes.add(note);
    }

    trackNoteOff(instrument, note) {
        const notes = this.activeNotes.get(instrument);
        if (!notes) return;
        notes.delete(note);
    }

    activeNoteCount(instrument) {
        const polyGroup = this.polyEngines.get(instrument);
        if (polyGroup) return polyGroup.activeNotes.size;
        return this.activeNotes.get(instrument)?.size ?? 0;
    }

    getHoldState(instrument) {
        let state = this.holdStates.get(instrument);
        if (!state) {
            state = {
                gain: 1,
                age: 0,
            };
            this.holdStates.set(instrument, state);
        }
        return state;
    }

    resetHoldState(instrument) {
        const state = this.holdStates.get(instrument);
        if (!state) return;
        state.gain = 1;
        state.age = 0;
    }

    applyHoldSustain(instrument, sourceLeft, sourceRight, outLeft, outRight, frameCount, rms) {
        if (instrument === "E-Bass") return false;

        const state = this.getHoldState(instrument);
        const enabled = this.holdEnabled.get(instrument) === true && this.activeNoteCount(instrument) > 0;

        if (!enabled) {
            state.age = 0;
            state.gain = 1;
            return false;
        }

        state.age += frameCount;
        if (state.age < this.holdWarmupSamples) return false;

        const wantedGain = rms > this.holdFloorRms
            ? Math.max(1, Math.min(this.holdMaxGain, this.holdTargetRms / rms))
            : state.gain;
        const smoothing = wantedGain > state.gain ? 0.018 : 0.06;
        state.gain += (wantedGain - state.gain) * smoothing;

        if (state.gain <= 1.001) return false;

        for (let i = 0; i < frameCount; i++) {
            outLeft[i] = (sourceLeft[i] || 0) * state.gain;
            outRight[i] = (sourceRight[i] || 0) * state.gain;
        }

        return true;
    }

    resetEbassSustain() {
        this.ebassSustain.age = 0;
        this.ebassSustain.gain = 1;
        this.ebassSustain.phase = 0;
        this.ebassSustain.note = null;
    }

    activeEbassNote() {
        const group = this.polyEngines.get("E-Bass");
        if (!group || group.activeNotes.size === 0) return null;
        return group.activeNotes.keys().next().value;
    }

    limitEbassSample(value) {
        return Math.max(-this.ebassSustainCeilingPeak, Math.min(this.ebassSustainCeilingPeak, value));
    }

    applyEbassSustainControl(leftOut, rightOut, frameCount, rms, peak) {
        const activeNote = this.activeEbassNote();
        if (this.currentInstrument !== "E-Bass" || activeNote === null) {
            this.resetEbassSustain();
            return { rms, peak };
        }

        this.ebassSustain.note = activeNote;
        this.ebassSustain.age += frameCount;
        if (this.ebassSustain.age < this.ebassSustainStartSamples) {
            this.ebassSustain.gain = 1;
            return { rms, peak };
        }

        const rmsGain = rms > this.ebassSustainCeilingRms
            ? this.ebassSustainCeilingRms / Math.max(rms, 0.000001)
            : 1;
        const peakGain = peak > this.ebassSustainCeilingPeak
            ? this.ebassSustainCeilingPeak / Math.max(peak, 0.000001)
            : 1;
        const targetGain = Math.max(0.45, Math.min(1, rmsGain, peakGain));
        const smoothing = targetGain < this.ebassSustain.gain ? 0.55 : 0.12;
        this.ebassSustain.gain += (targetGain - this.ebassSustain.gain) * smoothing;

        const fadeAge = Math.max(0, this.ebassSustain.age - this.ebassSustainStartSamples);
        if (this.ebassSustain.gain >= 0.999 && fadeAge === 0) return { rms, peak };

        const wet = Math.min(1, fadeAge / Math.max(1, this.ebassSustainFadeSamples));
        const dryScale = 1 - wet * 0.86;
        const frequency = 440 * Math.pow(2, ((this.ebassSustain.note ?? activeNote) - 69) / 12);
        const phaseStep = (Math.PI * 2 * frequency) / sampleRate;
        let newPeak = 0;
        let sumSquares = 0;

        for (let i = 0; i < frameCount; i++) {
            const phase = this.ebassSustain.phase;
            const tail = wet * this.ebassTailLevel * (
                Math.sin(phase) +
                Math.sin(phase * 2) * 0.16
            );

            let left = leftOut[i] * this.ebassSustain.gain * dryScale + tail;
            let right = rightOut[i] * this.ebassSustain.gain * dryScale + tail;
            left = this.limitEbassSample(left);
            right = this.limitEbassSample(right);
            leftOut[i] = left;
            rightOut[i] = right;
            newPeak = Math.max(newPeak, Math.abs(left), Math.abs(right));
            sumSquares += left * left + right * right;

            this.ebassSustain.phase += phaseStep;
            if (this.ebassSustain.phase > Math.PI * 2) this.ebassSustain.phase -= Math.PI * 2;
        }

        return {
            rms: Math.sqrt(sumSquares / Math.max(1, frameCount * 2)),
            peak: newPeak,
        };
    }

    engineFor(instrument) {
        return this.engines.get(instrument) || this.engines.get(this.currentInstrument);
    }

    velocity(value, fallback) {
        const numeric = Number(value ?? fallback);
        if (!Number.isFinite(numeric)) return fallback;
        return Math.max(0, Math.min(127, Math.round(numeric)));
    }

    forNotes(notes, callback) {
        if (!Array.isArray(notes)) return;
        for (const note of notes) {
            const midi = Math.max(0, Math.min(127, Math.round(Number(note))));
            if (Number.isFinite(midi)) callback(midi);
        }
    }

    process(_inputs, outputs) {
        const output = outputs[0];
        if (!output || output.length === 0) return true;

        const leftOut = output[0];
        const rightOut = output[1] || output[0];

        if (!this.ready || this.error) {
            leftOut.fill(0);
            if (rightOut !== leftOut) rightOut.fill(0);
            return true;
        }

        this.processCount++;

        const Module = this.module;
        const frameCount = leftOut.length;
        const polyGroup = this.polyEngines.get(this.currentInstrument);

        if (frameCount > this.frames) {
            leftOut.fill(0);
            if (rightOut !== leftOut) rightOut.fill(0);
            return true;
        }

        if (polyGroup) {
            this.processPolyGroup(polyGroup, leftOut, rightOut, frameCount);
            return true;
        }

        const engine = this.engineFor(this.currentInstrument);

        if (!engine) {
            leftOut.fill(0);
            if (rightOut !== leftOut) rightOut.fill(0);
            return true;
        }

        try {
            Module._fivo_surge_process(engine, this.leftPtr, this.rightPtr, frameCount);

            const leftOffset = this.leftPtr >> 2;
            const rightOffset = this.rightPtr >> 2;
            const leftData = Module.HEAPF32.subarray(leftOffset, leftOffset + frameCount);
            const rightData = Module.HEAPF32.subarray(rightOffset, rightOffset + frameCount);

            let peak = 0;
            let sumSquares = 0;
            for (let i = 0; i < frameCount; i++) {
                const left = leftData[i] || 0;
                const right = rightData[i] || 0;
                peak = Math.max(peak, Math.abs(left), Math.abs(right));
                sumSquares += left * left + right * right;
            }
            this.lastPeak = peak;
            this.lastRms = Math.sqrt(sumSquares / Math.max(1, frameCount * 2));

            if (!this.applyHoldSustain(this.currentInstrument, leftData, rightData, leftOut, rightOut, frameCount, this.lastRms)) {
                leftOut.set(leftData);
                rightOut.set(rightData);
            }
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
            leftOut.fill(0);
            if (rightOut !== leftOut) rightOut.fill(0);
            if (!this.processErrorReported) {
                this.processErrorReported = true;
                this.port.postMessage({ type: "processError", error: this.error });
            }
        }

        return true;
    }

    processPolyGroup(group, leftOut, rightOut, frameCount) {
        const Module = this.module;
        leftOut.fill(0);
        if (rightOut !== leftOut) rightOut.fill(0);

        let sumSquares = 0;
        const voiceGain = 0.85;

        try {
            for (const engine of group.engines) {
                Module._fivo_surge_process(engine, this.leftPtr, this.rightPtr, frameCount);

                const leftOffset = this.leftPtr >> 2;
                const rightOffset = this.rightPtr >> 2;
                const leftData = Module.HEAPF32.subarray(leftOffset, leftOffset + frameCount);
                const rightData = Module.HEAPF32.subarray(rightOffset, rightOffset + frameCount);

                for (let i = 0; i < frameCount; i++) {
                    leftOut[i] += (leftData[i] || 0) * voiceGain;
                    rightOut[i] += (rightData[i] || 0) * voiceGain;
                }
            }

            let peak = 0;
            for (let i = 0; i < frameCount; i++) {
                const left = leftOut[i] || 0;
                const right = rightOut[i] || 0;
                peak = Math.max(peak, Math.abs(left), Math.abs(right));
                sumSquares += left * left + right * right;
            }
            const rms = Math.sqrt(sumSquares / Math.max(1, frameCount * 2));
            const controlled = this.applyEbassSustainControl(leftOut, rightOut, frameCount, rms, peak);
            this.lastPeak = controlled.peak;
            this.lastRms = controlled.rms;
            this.applyHoldSustain(this.currentInstrument, leftOut, rightOut, leftOut, rightOut, frameCount, this.lastRms);
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
            leftOut.fill(0);
            if (rightOut !== leftOut) rightOut.fill(0);
            if (!this.processErrorReported) {
                this.processErrorReported = true;
                this.port.postMessage({ type: "processError", error: this.error });
            }
        }
    }
}

registerProcessor("fivo-surge", FivoSurgeProcessor);
