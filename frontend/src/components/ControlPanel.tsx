import React, { useState, useRef } from 'react';
import { audioEngine } from '../api/audio';
import type { InstrumentName } from '../api/audio';

// Shared interfaces if needed, or just inline props for simplicity.
// But keeping a loose contract is good.

interface ToolsLeftProps {
    liteMode?: boolean;
    strumEnabled: boolean;
    attackOn: boolean;
    releaseOn: boolean;
    colorOn: boolean;
    expressionOn: boolean;
    effectLevel: number;
    onStrumToggle: () => void;
    onAttackToggle: () => void;
    onReleaseToggle: () => void;
    onColorToggle: () => void;
    onExpressionToggle: () => void;
    onEffectLevelChange: (v: number) => void;
}

// Generic Rotary Knob Component
interface RotaryKnobProps {
    value: number;
    onChange: (val: number) => void;
    min: number;
    max: number;
    step?: number;
    label: string;
    formatValue?: (val: number) => string | React.ReactNode;
}

export const RotaryKnob: React.FC<RotaryKnobProps> = ({
    value,
    onChange,
    min,
    max,
    step = 1,
    label,
    formatValue
}) => {
    const knobRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const startY = useRef(0);
    const startVal = useRef(0);
    const [editing, setEditing] = useState(false);
    const [editText, setEditText] = useState('');

    const handlePointerDown = (e: React.PointerEvent) => {
        setIsDragging(true);
        startY.current = e.clientY;
        startVal.current = value;
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDragging) return;
        const deltaY = startY.current - e.clientY; // Drag UP to increase

        // sensitivity: pixels to move 1 unit
        // For distinct steps (Inversion), low sensitivity (50px).
        // For continuous (Strum), higher sensitivity (1px = 1 unit?).
        const range = max - min;
        const sensitivity = range < 10 ? 50 : 2;

        const deltaVal = Math.round(deltaY / sensitivity) * step;

        let nextVal = startVal.current + deltaVal;

        // Clamp
        nextVal = Math.min(max, Math.max(min, nextVal));

        // Snap to step
        if (step > 0) {
            nextVal = Math.round(nextVal / step) * step;
        }

        if (nextVal !== value) {
            onChange(nextVal);
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        setIsDragging(false);
        e.currentTarget.releasePointerCapture(e.pointerId);

        // Click to cycle (only if small range/discrete)
        if (max - min < 10 && Math.abs(startY.current - e.clientY) < 5) {
            const next = value + step > max ? min : value + step;
            onChange(next);
        }
    };

    // Visualization:
    // Map value to angle.
    // Standard knob: -135deg (min) to +135deg (max)
    // 270 degree sweep.
    const pct = (value - min) / (max - min);
    const rotation = -135 + (pct * 270);

    return (
        <div className="knob-wrapper">
            <label>{label}</label>
            <div
                ref={knobRef}
                className="knob-control"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                style={{ transform: `rotate(${rotation}deg)` }}
                title="Drag up/down"
            >
                <div className="knob-indicator"></div>
            </div>
            {editing ? (
                <input
                    className="knob-value-input"
                    type="text"
                    value={editText}
                    autoFocus
                    onChange={e => setEditText(e.target.value)}
                    onBlur={() => {
                        const n = parseInt(editText, 10);
                        if (!isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
                        setEditing(false);
                    }}
                    onKeyDown={e => {
                        if (e.key === 'Enter') {
                            const n = parseInt(editText, 10);
                            if (!isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
                            setEditing(false);
                        }
                        if (e.key === 'Escape') setEditing(false);
                    }}
                />
            ) : (
                <div
                    className="knob-value-label"
                    onClick={() => { setEditText(String(value)); setEditing(true); }}
                    title="Click to edit"
                >
                    {formatValue ? formatValue(value) : value}
                </div>
            )}
        </div>
    );
};

// Vertical Fader Component
interface VerticalFaderProps {
    value: number; // 0-100
    onChange: (val: number) => void;
    label: string;
    height?: number;
}

// Slide Toggle Component
interface SlideToggleProps {
    on: boolean;
    onToggle: () => void;
    label: string;
    sub?: string;
}

const SlideToggle: React.FC<SlideToggleProps> = ({ on, onToggle, label, sub }) => {
    return (
        <div className="slide-toggle-wrap" onClick={onToggle}>
            <span className="slide-toggle-label">{label}</span>
            <div className={`slide-toggle-track ${on ? 'on' : ''}`}>
                <div className="slide-toggle-thumb" />
            </div>
            {sub && <span className="cc-toggle-sub">{sub}</span>}
        </div>
    );
};

const VerticalFader: React.FC<VerticalFaderProps> = ({ value, onChange, label, height = 160 }) => {
    const trackRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);

    const handleMove = (clientY: number) => {
        const rect = trackRef.current?.getBoundingClientRect();
        if (!rect) return;
        const pct = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
        onChange(Math.round(pct * 100));
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(true);
        e.currentTarget.setPointerCapture(e.pointerId);
        handleMove(e.clientY);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isDragging) return;
        e.preventDefault();
        handleMove(e.clientY);
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        setIsDragging(false);
        try {
            e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
            // Pointer capture can already be gone if the browser cancels a touch.
        }
    };

    const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -4 : 4;
        onChange(Math.max(0, Math.min(100, value + delta)));
    };

    return (
        <div className="vfader-wrap" onWheel={handleWheel}>
            <span className="vfader-label">{label}</span>
            <div
                className="vfader-track"
                ref={trackRef}
                style={{ height }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onLostPointerCapture={() => setIsDragging(false)}
            >
                <div className="vfader-fill" style={{ height: `${value}%` }} />
                <div className="vfader-thumb" style={{ bottom: `${value}%` }} />
            </div>
            <span className="vfader-value">{value}%</span>
        </div>
    );
};

export const ToolsLeft: React.FC<ToolsLeftProps> = ({
    liteMode = false,
    strumEnabled, attackOn, releaseOn, colorOn, expressionOn,
    effectLevel,
    onStrumToggle, onAttackToggle, onReleaseToggle, onColorToggle, onExpressionToggle,
    onEffectLevelChange,
}) => {
    return (
        <div className="tools-left glass-panel">
            <div className="effects-box">
                <div className="tools-left-buttons">
                    <SlideToggle on={strumEnabled}  onToggle={onStrumToggle}      label="strum" />
                    {!liteMode && (
                        // LITE: estos 4 toggles desaparecen — el fader 'level' aplica
                        // attack/release/sustain/expression a la vez (MOD CC1 + EXPR CC11 + CUTOFF CC74).
                        <>
                            <SlideToggle on={attackOn}      onToggle={onAttackToggle}     label="atck"  />
                            <SlideToggle on={releaseOn}     onToggle={onReleaseToggle}    label="rlse"  />
                            <SlideToggle on={colorOn}       onToggle={onColorToggle}      label="color" />
                            <SlideToggle on={expressionOn}  onToggle={onExpressionToggle} label="expr." />
                        </>
                    )}
                </div>
                <div className="level-fader-wrap">
                    <VerticalFader value={effectLevel} onChange={onEffectLevelChange} label="Expression" height={260} />
                </div>
            </div>
        </div>
    );
};

// Tempo Control Component
const TempoControl: React.FC<{ tempo: number; onTempoChange: (t: number) => void }> = ({ tempo, onTempoChange }) => {
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const tempoRef = useRef(tempo);

    React.useEffect(() => {
        tempoRef.current = tempo;
    }, [tempo]);

    const startHold = (delta: number) => {
        const newVal = Math.max(30, Math.min(300, tempoRef.current + delta));
        tempoRef.current = newVal;
        onTempoChange(newVal);

        intervalRef.current = setInterval(() => {
            const next = Math.max(30, Math.min(300, tempoRef.current + delta));
            tempoRef.current = next;
            onTempoChange(next);
        }, 100);
    };

    const stopHold = () => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    };

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -1 : 1;
        const next = Math.max(30, Math.min(300, tempo + delta));
        onTempoChange(next);
    };

    React.useEffect(() => {
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, []);

    return (
        <div className="tempo-control" onWheel={handleWheel}>
            <span className="tempo-label">Tempo</span>
            <div className="tempo-bar">
                <button
                    className="tempo-btn"
                    onMouseDown={() => startHold(-1)}
                    onMouseUp={stopHold}
                    onMouseLeave={stopHold}
                    onTouchStart={() => startHold(-1)}
                    onTouchEnd={stopHold}
                >
                    −
                </button>
                <input
                    type="range"
                    className="tempo-slider"
                    min={30}
                    max={300}
                    value={tempo}
                    onChange={(e) => onTempoChange(Number(e.target.value))}
                />
                <button
                    className="tempo-btn"
                    onMouseDown={() => startHold(1)}
                    onMouseUp={stopHold}
                    onMouseLeave={stopHold}
                    onTouchStart={() => startHold(1)}
                    onTouchEnd={stopHold}
                >
                    +
                </button>
            </div>
            <span className="tempo-value">{tempo} BPM</span>
        </div>
    );
};

interface StyleSelectorProps {
    style: string;
    onStyleChange: (s: string) => void;
}

export const StyleSelector: React.FC<StyleSelectorProps> = ({ style, onStyleChange }) => {
    const styles = ['Pop', 'Jazz', 'Rock', 'Bossa'];

    return (
        <div className="style-selector-apple">
            <label>Style</label>
            <div className="style-list-apple">
                {styles.map((s) => (
                    <button
                        key={s}
                        className={`style-item-apple ${style === s ? 'active' : ''}`}
                        onClick={() => onStyleChange(s)}
                    >
                        {s}
                    </button>
                ))}
            </div>
        </div>
    );
};

interface InstrumentSelectorProps {
    instrument: InstrumentName;
    onInstrumentChange: (i: InstrumentName) => void;
}

export const InstrumentSelector: React.FC<InstrumentSelectorProps> = ({ instrument, onInstrumentChange }) => {
    const instruments: InstrumentName[] = ['EP2', 'Messy', 'Canadians', 'E-Bass'];

    return (
        <div className="style-selector-apple">
            <label>Instrument</label>
            <div className="style-list-apple">
                {instruments.map((i) => (
                    <button
                        key={i}
                        className={`style-item-apple ${instrument === i ? 'active' : ''}`}
                        onClick={() => onInstrumentChange(i)}
                    >
                        {i}
                    </button>
                ))}
            </div>
        </div>
    );
};

// Arpeggiator Component
interface ArpeggiatorProps {
    liteMode?: boolean; // LITE: switch ON/OFF + selector direccional (Up/Down/Up-Down/Down-Up/Random)
    value: number;
    swing: number;
    tempo: number;
    onValueChange: (v: number) => void;
    onSwingChange: (v: number) => void;
    onTempoChange: (v: number) => void;
}

// LITE: modos direccionales con íconos
const ARP_MODES_LITE: { id: number; label: string; title: string }[] = [
    { id: 1, label: '↑',  title: 'Up' },
    { id: 2, label: '↓',  title: 'Down' },
    { id: 3, label: '↑↓', title: 'Up-Down' },
    { id: 4, label: '↓↑', title: 'Down-Up' },
    { id: 5, label: '⤭',  title: 'Random' },
];

export const Arpeggiator: React.FC<ArpeggiatorProps> = ({
    liteMode = false,
    value,
    swing,
    tempo,
    onValueChange,
    onSwingChange,
    onTempoChange,
}) => {
    const [selectedMode, setSelectedMode] = useState(value > 0 ? value : 1);

    React.useEffect(() => {
        if (value > 0) setSelectedMode(value);
    }, [value]);

    // LITE: switch ON/OFF separado del selector + íconos direccionales en línea
    if (liteMode) {
        const isOn = value > 0;
        const toggleOn = () => onValueChange(isOn ? 0 : selectedMode);
        const selectMode = (mode: number) => {
            setSelectedMode(mode);
            if (isOn) onValueChange(mode);
        };

        return (
            <div className="arpeggiator-control">
                <span className="arp-title-lite">arpeggiator</span>
                <div className="arp-demo-row">
                    <div className="arp-demo-control">
                        <span className="arp-demo-label">On/Off</span>
                        <button
                            type="button"
                            className={`arp-power-switch ${isOn ? 'on' : ''}`}
                            onClick={toggleOn}
                            role="switch"
                            aria-checked={isOn}
                            aria-label={isOn ? 'Apagar arpegiador' : 'Encender arpegiador'}
                        >
                            <span className="arp-power-thumb" />
                        </button>
                    </div>

                    <div className="arp-demo-control arp-type-control">
                        <RotaryKnob
                            value={selectedMode}
                            onChange={selectMode}
                            min={1}
                            max={5}
                            step={1}
                            label="Type"
                            formatValue={(v) => ARP_MODES_LITE.find(mode => mode.id === v)?.title ?? v}
                        />
                    </div>

                    <div className="arp-demo-control">
                        <RotaryKnob
                            value={tempo}
                            onChange={onTempoChange}
                            min={30}
                            max={300}
                            step={1}
                            label="Tempo"
                            formatValue={(v) => `${v}`}
                        />
                    </div>
                </div>

                {/* FULL VERSION:
                <div className="arp-header">
                    <span className="arp-title-lite">arpeggiator</span>
                    <button
                        type="button"
                        className={`arp-power-switch ${isOn ? 'on' : ''}`}
                        onClick={toggleOn}
                        role="switch"
                        aria-checked={isOn}
                        aria-label={isOn ? 'Apagar arpegiador' : 'Encender arpegiador'}
                    >
                        <span className="arp-power-thumb" />
                    </button>
                </div>
                <div className="arp-mode-selector">
                    {ARP_MODES_LITE.map(m => (
                        <button
                            key={m.id}
                            className={`arp-mode-btn ${selectedMode === m.id ? 'active' : ''}`}
                            onClick={() => selectMode(m.id)}
                            title={m.title}
                        >
                            {m.label}
                        </button>
                    ))}
                </div>
                <div className="arp-swing-row">
                    <span className="arp-swing-label">swing</span>
                    <input
                        type="range"
                        className="arp-swing-slider"
                        min={0} max={100} step={1}
                        value={swing}
                        onChange={(e) => onSwingChange(Number(e.target.value))}
                    />
                    <span className="arp-swing-value">{swing}%</span>
                </div>
                */}
            </div>
        );
    }

    // FULL: knob original con voicing patterns numerados (Off, 1, 2, 3, 4, 5)
    const patterns = ['Off', '1', '2', '3', '4', '5'];

    const handleKnobClick = () => {
        const next = (value + 1) % patterns.length;
        onValueChange(next);
    };

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -1 : 1;
        const next = Math.max(0, Math.min(patterns.length - 1, value + delta));
        onValueChange(next);
    };

    const rotation = -135 + (value / (patterns.length - 1)) * 270;

    const labelPositions: Record<string, [number, number]> = {
        'Off': [15, 85],
        '1': [-5, 50],
        '2': [25, 5],
        '3': [75, 5],
        '4': [105, 50],
        '5': [85, 85],
    };

    return (
        <div className="arpeggiator-control">
            <div className="arp-knob-container">
                <div className="arp-labels">
                    {patterns.map((p, idx) => {
                        const [left, top] = labelPositions[p];
                        return (
                            <span
                                key={p}
                                className={`arp-label ${value === idx ? 'active' : ''}`}
                                style={{
                                    left: `${left}%`,
                                    top: `${top}%`,
                                    transform: 'translate(-50%, -50%)'
                                }}
                                onClick={() => onValueChange(idx)}
                            >
                                {p}
                            </span>
                        );
                    })}
                </div>
                <div
                    className="arp-knob"
                    style={{ transform: `rotate(${rotation}deg)` }}
                    onClick={handleKnobClick}
                    onWheel={handleWheel}
                >
                    <div className="arp-knob-indicator"></div>
                </div>
                <span className="arp-title">arpeggiator</span>
            </div>
            <div className="arp-swing-row">
                <span className="arp-swing-label">swing</span>
                <input
                    type="range"
                    className="arp-swing-slider"
                    min={0} max={100} step={1}
                    value={swing}
                    onChange={(e) => onSwingChange(Number(e.target.value))}
                />
                <span className="arp-swing-value">{swing}%</span>
            </div>
        </div>
    );
};

// Arp Tempo Control
export const ArpTempoControl: React.FC<{ tempo: number; onTempoChange: (t: number) => void }> = ({ tempo, onTempoChange }) => {
    return (
        <RotaryKnob
            value={tempo}
            onChange={onTempoChange}
            min={30}
            max={300}
            step={1}
            label="tempo"
            formatValue={(v) => `${v} bpm`}
        />
    );
};

interface OctaveControlProps {
    octave: number;
    onOctaveChange: (delta: number) => void;
}

export const OctaveControl: React.FC<OctaveControlProps> = ({ octave, onOctaveChange }) => {
    const lastTouchAt = useRef(0);

    const handleTouchStart = (e: React.TouchEvent<HTMLButtonElement>, delta: number) => {
        e.preventDefault();
        lastTouchAt.current = performance.now();
        onOctaveChange(delta);
    };

    const handleClick = (delta: number) => {
        if (performance.now() - lastTouchAt.current < 650) return;
        onOctaveChange(delta);
    };

    return (
        <div className="octave-control glass-panel compact">
            <button
                type="button"
                onClick={() => handleClick(-1)}
                onTouchStart={(e) => handleTouchStart(e, -1)}
            >−</button>
            <span className="value-display">{octave}</span>
            <button
                type="button"
                onClick={() => handleClick(1)}
                onTouchStart={(e) => handleTouchStart(e, 1)}
            >+</button>
        </div>
    );
};

interface KeySelectorProps {
    currentKey: string;
    majorNotes: string[];
    minorNotes: string[];
    onKeyChange: (key: string) => void;
}

export const KeySelector: React.FC<KeySelectorProps> = ({ currentKey, majorNotes, minorNotes, onKeyChange }) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="key-selector-custom">
            <label>Key</label>
            <div className="key-dropdown-wrapper">
                <button
                    className={`key-trigger ${isOpen ? 'active' : ''}`}
                    onClick={() => setIsOpen(!isOpen)}
                >
                    <span className="current-key">{currentKey}</span>
                </button>

                {isOpen && (
                    <div className="key-options-container">
                        <div className="key-section">
                            <span className="key-section-label">Major</span>
                            <div className="key-options-grid">
                                {majorNotes.map((n) => (
                                    <button
                                        key={n}
                                        className={`key-option ${currentKey === n ? 'selected' : ''}`}
                                        onClick={() => {
                                            onKeyChange(n);
                                            setIsOpen(false);
                                        }}
                                    >
                                        {n}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="key-section">
                            <span className="key-section-label">Minor</span>
                            <div className="key-options-grid">
                                {minorNotes.map((n) => (
                                    <button
                                        key={n}
                                        className={`key-option minor ${currentKey === n ? 'selected' : ''}`}
                                        onClick={() => {
                                            onKeyChange(n);
                                            setIsOpen(false);
                                        }}
                                    >
                                        {n}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
            {isOpen && (
                <div className="backdrop" onClick={() => setIsOpen(false)} />
            )}
        </div>
    );
};

// Loop Bank Slot type
interface LoopSlot {
    buffer: AudioBuffer | null;
    duration: number;
    volume: number;
    sourceNode: AudioBufferSourceNode | null;
    gainNode: GainNode | null;
    isPlaying: boolean;
    isRecording: boolean;
    trimStart: number;
    trimEnd: number;
}

// RecLoopHold Component
interface RecLoopHoldProps {
    isHold: boolean;
    onHoldChange: (hold: boolean) => void;
    activeModal: 'fingers' | 'loopbank' | null;
    onModalFocus: (modal: 'fingers' | 'loopbank' | null) => void;
}

const createEmptySlot = (): LoopSlot => ({
    buffer: null,
    duration: 0,
    volume: 80,
    sourceNode: null,
    gainNode: null,
    isPlaying: false,
    isRecording: false,
    trimStart: 0,
    trimEnd: 0,
});

export const RecLoopHold: React.FC<RecLoopHoldProps> = ({ isHold, onHoldChange, activeModal, onModalFocus }) => {
    const [isRec, setIsRec] = useState(false);
    const [isLoop, setIsLoop] = useState(false);
    const [showLoopBank, setShowLoopBank] = useState(false);
    const [loopBank, setLoopBank] = useState<LoopSlot[]>([
        createEmptySlot(),
        createEmptySlot(),
        createEmptySlot(),
        createEmptySlot(),
    ]);
    const [recordingSlot, setRecordingSlot] = useState<number | null>(null);
    const [showTrimModal, setShowTrimModal] = useState<number | null>(null);
    const [showBackingTrackPrompt, setShowBackingTrackPrompt] = useState<number | null>(null);
    const [backingTrackSlot, setBackingTrackSlot] = useState<number | null>(null);
    const backingTrackSlotRef = useRef<number | null>(null);
    // Store active backing track audio nodes for reliable stopping
    const backingTrackNodesRef = useRef<{ source: AudioBufferSourceNode | null; gain: GainNode | null }>({ source: null, gain: null });
    const [countdown, setCountdown] = useState<number | null>(null);
    const [pendingRecording, setPendingRecording] = useState<{ targetSlot: number; backingSlot: number | null } | null>(null);

    // Keep ref in sync with state
    React.useEffect(() => {
        backingTrackSlotRef.current = backingTrackSlot;
    }, [backingTrackSlot]);

    // Modal drag state
    const [modalPos, setModalPos] = useState<{ x: number; y: number } | null>(null);
    const [isDraggingModal, setIsDraggingModal] = useState(false);
    const modalDragOffset = useRef({ x: 0, y: 0 });

    // Audio refs - single context for both recording and playback
    const audioContextRef = useRef<AudioContext | null>(null);
    const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
    const gainNodeRef = useRef<GainNode | null>(null);
    const audioBufferRef = useRef<AudioBuffer | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const recordedLeftRef = useRef<Float32Array[]>([]);
    const recordedRightRef = useRef<Float32Array[]>([]);

    // Single audio context for loops (recording stream comes from audioEngine)
    const ensureAudioContext = () => {
        if (!audioContextRef.current) {
            audioContextRef.current = new AudioContext();
        }
        return audioContextRef.current;
    };

    // Per-slot recording functions
    const startRecordingSlot = async (slotIndex: number) => {
        if (recordingSlot !== null) {
            stopRecordingSlot(recordingSlot);
        }

        try {
            const ctx = ensureAudioContext();
            if (ctx.state === 'suspended') {
                await ctx.resume();
            }

            const stream = await audioEngine.getOutputStream();
            streamRef.current = stream;

            const source = ctx.createMediaStreamSource(stream);
            mediaStreamSourceRef.current = source;

            const bufferSize = 8192;
            const scriptProcessor = ctx.createScriptProcessor(bufferSize, 2, 2);
            scriptProcessorRef.current = scriptProcessor;
            recordedLeftRef.current = [];
            recordedRightRef.current = [];

            scriptProcessor.onaudioprocess = (e) => {
                const left = new Float32Array(e.inputBuffer.getChannelData(0));
                const right = e.inputBuffer.numberOfChannels > 1
                    ? new Float32Array(e.inputBuffer.getChannelData(1))
                    : new Float32Array(left);
                recordedLeftRef.current.push(left);
                recordedRightRef.current.push(right);
            };

            source.connect(scriptProcessor);
            const muteGain = ctx.createGain();
            muteGain.gain.value = 0;
            scriptProcessor.connect(muteGain);
            muteGain.connect(ctx.destination);

            const newBank = [...loopBank];
            newBank[slotIndex] = { ...newBank[slotIndex], isRecording: true };
            setLoopBank(newBank);
            setRecordingSlot(slotIndex);

        } catch (err) {
            console.error('Error recording to slot:', err);
        }
    };

    const stopRecordingSlot = (slotIndex: number) => {
        // Stop backing track if playing
        if (backingTrackSlotRef.current !== null) {
            stopBackingTrack();
            setBackingTrackSlot(null);
            backingTrackSlotRef.current = null;
        }

        if (scriptProcessorRef.current) {
            scriptProcessorRef.current.disconnect();
            scriptProcessorRef.current = null;
        }
        if (mediaStreamSourceRef.current) {
            mediaStreamSourceRef.current.disconnect();
            mediaStreamSourceRef.current = null;
        }
        streamRef.current = null;

        if (recordedLeftRef.current.length > 0 && audioContextRef.current) {
            const totalLength = recordedLeftRef.current.reduce((acc, chunk) => acc + chunk.length, 0);

            const audioBuffer = audioContextRef.current.createBuffer(
                2,
                totalLength,
                audioContextRef.current.sampleRate
            );

            const leftChannel = audioBuffer.getChannelData(0);
            const rightChannel = audioBuffer.getChannelData(1);

            let offset = 0;
            for (let i = 0; i < recordedLeftRef.current.length; i++) {
                leftChannel.set(recordedLeftRef.current[i], offset);
                rightChannel.set(recordedRightRef.current[i], offset);
                offset += recordedLeftRef.current[i].length;
            }

            const newBank = [...loopBank];
            newBank[slotIndex] = {
                ...createEmptySlot(),
                buffer: audioBuffer,
                duration: audioBuffer.duration,
                volume: 80,
                trimStart: 0,
                trimEnd: audioBuffer.duration,
            };
            setLoopBank(newBank);

            recordedLeftRef.current = [];
            recordedRightRef.current = [];
        } else {
            const newBank = [...loopBank];
            newBank[slotIndex] = { ...newBank[slotIndex], isRecording: false };
            setLoopBank(newBank);
        }

        setRecordingSlot(null);
    };

    const toggleRecordSlot = (slotIndex: number) => {
        if (loopBank[slotIndex].isRecording) {
            stopRecordingSlot(slotIndex);
        } else {
            const availableBackingTracks = loopBank
                .map((slot, idx) => ({ slot, idx }))
                .filter(({ slot, idx }) => slot.buffer !== null && idx !== slotIndex);

            if (availableBackingTracks.length > 0) {
                setShowBackingTrackPrompt(slotIndex);
            } else {
                startCountdown(slotIndex, null);
            }
        }
    };

    const startCountdown = (targetSlot: number, backingSlotIndex: number | null) => {
        setShowBackingTrackPrompt(null);
        setPendingRecording({ targetSlot, backingSlot: backingSlotIndex });
        setCountdown(3);
    };

    // Play backing track and store nodes in ref for reliable stopping
    const playBackingTrack = (slotIndex: number) => {
        const slot = loopBank[slotIndex];
        if (!slot.buffer) return;

        const ctx = ensureAudioContext();
        if (ctx.state === 'suspended') {
            ctx.resume();
        }

        const gainNode = ctx.createGain();
        gainNode.gain.value = slot.volume / 100;
        gainNode.connect(ctx.destination);

        const source = ctx.createBufferSource();
        source.buffer = slot.buffer;
        source.loop = true;
        const loopStart = slot.trimStart || 0;
        const loopEnd = slot.trimEnd || slot.duration;
        source.loopStart = loopStart;
        source.loopEnd = loopEnd;
        source.connect(gainNode);
        source.start(0, loopStart);

        // Store in ref for later stopping
        backingTrackNodesRef.current = { source, gain: gainNode };
    };

    // Stop backing track using stored refs
    const stopBackingTrack = () => {
        const { source, gain } = backingTrackNodesRef.current;
        if (source) {
            try { source.stop(); } catch {}
        }
        if (gain) {
            gain.disconnect();
        }
        backingTrackNodesRef.current = { source: null, gain: null };
    };

    // Handle countdown
    React.useEffect(() => {
        if (countdown === null) return;

        if (countdown > 0) {
            const timer = setTimeout(() => {
                setCountdown(countdown - 1);
            }, 1000);
            return () => clearTimeout(timer);
        } else if (countdown === 0) {
            const timer = setTimeout(() => {
                if (pendingRecording) {
                    const { targetSlot, backingSlot } = pendingRecording;

                    if (backingSlot !== null) {
                        playBackingTrack(backingSlot);
                        setBackingTrackSlot(backingSlot);
                        backingTrackSlotRef.current = backingSlot;
                    }

                    startRecordingSlot(targetSlot);
                    setPendingRecording(null);
                }
                setCountdown(null);
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [countdown, pendingRecording]);

    const cancelCountdown = () => {
        setCountdown(null);
        setPendingRecording(null);
    };

    const startRecordingWithBacking = (targetSlot: number, backingSlotIndex: number | null) => {
        startCountdown(targetSlot, backingSlotIndex);
    };

    const startRecordingWithoutBacking = (targetSlot: number) => {
        startCountdown(targetSlot, null);
    };

    const playSlot = (slotIndex: number) => {
        const slot = loopBank[slotIndex];
        if (!slot.buffer) return;

        const ctx = ensureAudioContext();

        if (ctx.state === 'suspended') {
            ctx.resume();
        }

        const gainNode = ctx.createGain();
        gainNode.gain.value = slot.volume / 100;
        // Loops go to this context's destination (separate from Tone.js/recording stream)
        gainNode.connect(ctx.destination);

        const source = ctx.createBufferSource();
        source.buffer = slot.buffer;
        source.loop = true;

        const loopStart = slot.trimStart || 0;
        const loopEnd = slot.trimEnd || slot.duration;
        source.loopStart = loopStart;
        source.loopEnd = loopEnd;

        source.connect(gainNode);
        source.start(0, loopStart);

        const newBank = [...loopBank];
        newBank[slotIndex] = {
            ...newBank[slotIndex],
            sourceNode: source,
            gainNode: gainNode,
            isPlaying: true,
        };
        setLoopBank(newBank);
    };

    const stopSlot = (slotIndex: number) => {
        const slot = loopBank[slotIndex];
        if (slot.sourceNode) {
            try { slot.sourceNode.stop(); } catch {}
        }
        if (slot.gainNode) {
            slot.gainNode.disconnect();
        }

        const newBank = [...loopBank];
        newBank[slotIndex] = {
            ...newBank[slotIndex],
            sourceNode: null,
            gainNode: null,
            isPlaying: false,
        };
        setLoopBank(newBank);
    };

    const toggleSlotPlay = (slotIndex: number) => {
        const slot = loopBank[slotIndex];
        if (!slot.buffer) return;

        if (slot.isPlaying) {
            stopSlot(slotIndex);
        } else {
            playSlot(slotIndex);
        }
    };

    const setSlotVolume = (slotIndex: number, volume: number) => {
        const newBank = [...loopBank];
        newBank[slotIndex] = {
            ...newBank[slotIndex],
            volume: volume,
        };
        if (newBank[slotIndex].gainNode) {
            newBank[slotIndex].gainNode!.gain.value = volume / 100;
        }
        setLoopBank(newBank);
    };

    const deleteSlot = (slotIndex: number) => {
        if (loopBank[slotIndex].isPlaying) {
            stopSlot(slotIndex);
        }

        const newBank = [...loopBank];
        newBank[slotIndex] = createEmptySlot();
        setLoopBank(newBank);
    };

    const stopAllSlots = () => {
        const newBank = [...loopBank];
        loopBank.forEach((slot, index) => {
            if (slot.isPlaying) {
                if (slot.sourceNode) {
                    try { slot.sourceNode.stop(); } catch {}
                }
                if (slot.gainNode) {
                    slot.gainNode.disconnect();
                }
                newBank[index] = {
                    ...newBank[index],
                    sourceNode: null,
                    gainNode: null,
                    isPlaying: false,
                };
            }
        });
        setLoopBank(newBank);
    };

    const playAllSlots = () => {
        const ctx = ensureAudioContext();

        if (ctx.state === 'suspended') {
            ctx.resume();
        }

        const startTime = ctx.currentTime + 0.05;
        const newBank = [...loopBank];

        loopBank.forEach((slot, index) => {
            if (slot.buffer && !slot.isPlaying) {
                const gainNode = ctx.createGain();
                gainNode.gain.value = slot.volume / 100;
                // Loops go to this context's destination (separate from recording)
                gainNode.connect(ctx.destination);

                const source = ctx.createBufferSource();
                source.buffer = slot.buffer;
                source.loop = true;

                const loopStart = slot.trimStart || 0;
                const loopEnd = slot.trimEnd || slot.duration;
                source.loopStart = loopStart;
                source.loopEnd = loopEnd;

                source.connect(gainNode);
                source.start(startTime, loopStart);

                newBank[index] = {
                    ...newBank[index],
                    sourceNode: source,
                    gainNode: gainNode,
                    isPlaying: true,
                };
            }
        });

        setLoopBank(newBank);
    };

    const clearAllSlots = () => {
        loopBank.forEach((slot, index) => {
            if (slot.isPlaying) {
                stopSlot(index);
            }
        });
        setLoopBank([
            createEmptySlot(),
            createEmptySlot(),
            createEmptySlot(),
            createEmptySlot(),
        ]);
    };

    const setSlotTrim = (slotIndex: number, trimStart: number, trimEnd: number) => {
        const newBank = [...loopBank];
        newBank[slotIndex] = {
            ...newBank[slotIndex],
            trimStart: Math.max(0, trimStart),
            trimEnd: Math.min(newBank[slotIndex].duration, trimEnd),
        };
        setLoopBank(newBank);
    };

    const formatDuration = (seconds: number): string => {
        return seconds.toFixed(1) + 's';
    };

    const hasAnyLoop = loopBank.some(slot => slot.buffer !== null);
    const anyPlaying = loopBank.some(slot => slot.isPlaying);

    const handleHold = () => {
        onHoldChange(!isHold);
    };

    // Modal drag handlers
    const handleModalDragStart = (e: React.MouseEvent | React.TouchEvent) => {
        setIsDraggingModal(true);
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

        if (modalPos) {
            modalDragOffset.current = { x: clientX - modalPos.x, y: clientY - modalPos.y };
        } else {
            const rect = (e.currentTarget.parentElement as HTMLElement)?.getBoundingClientRect();
            if (rect) {
                modalDragOffset.current = { x: clientX - rect.left, y: clientY - rect.top };
                setModalPos({ x: rect.left, y: rect.top });
            }
        }
    };

    React.useEffect(() => {
        if (!isDraggingModal) return;

        const handleMove = (e: MouseEvent | TouchEvent) => {
            const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
            const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

            let newX = clientX - modalDragOffset.current.x;
            let newY = clientY - modalDragOffset.current.y;

            const modalWidth = 380;
            const minY = 0;
            const maxY = window.innerHeight - 50;
            const minX = -modalWidth + 100;
            const maxX = window.innerWidth - 100;

            newX = Math.max(minX, Math.min(maxX, newX));
            newY = Math.max(minY, Math.min(maxY, newY));

            setModalPos({ x: newX, y: newY });
        };

        const handleUp = () => setIsDraggingModal(false);

        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
        window.addEventListener('touchmove', handleMove);
        window.addEventListener('touchend', handleUp);

        return () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
            window.removeEventListener('touchmove', handleMove);
            window.removeEventListener('touchend', handleUp);
        };
    }, [isDraggingModal]);

    React.useEffect(() => {
        if (showLoopBank && modalPos) {
            const modalWidth = 380;
            const maxY = window.innerHeight - 50;
            const maxX = window.innerWidth - 100;
            const minX = -modalWidth + 100;

            if (modalPos.y < 0 || modalPos.y > maxY ||
                modalPos.x < minX || modalPos.x > maxX) {
                setModalPos(null);
            }
        }
    }, [showLoopBank]);

    const handleCloseModal = () => {
        setShowLoopBank(false);
        setModalPos(null);
    };

    return (
        <div className="rec-loop-hold">
            <div className="rec-loop-labels">
                <span>Rec</span>
                <span>Loop</span>
            </div>
            <div className="rec-loop-buttons">
                <button
                    className={`rec-btn-square ${isRec ? 'active' : ''}`}
                    onClick={() => {
                        const newRecState = !isRec;
                        setIsRec(newRecState);

                        if (newRecState) {
                            let targetSlot = loopBank.findIndex(s => s.buffer === null);
                            if (targetSlot === -1) targetSlot = 0;
                            startRecordingSlot(targetSlot);
                        } else {
                            if (recordingSlot !== null) {
                                stopRecordingSlot(recordingSlot);
                            }
                        }
                    }}
                />
                <button
                    className={`rec-btn-square ${isLoop ? 'active' : ''}`}
                    onClick={() => {
                        const newLoopState = !isLoop;
                        setIsLoop(newLoopState);

                        if (newLoopState) {
                            let lastFilledSlot = -1;
                            for (let i = loopBank.length - 1; i >= 0; i--) {
                                if (loopBank[i].buffer !== null) {
                                    lastFilledSlot = i;
                                    break;
                                }
                            }
                            if (lastFilledSlot >= 0 && !loopBank[lastFilledSlot].isPlaying) {
                                playSlot(lastFilledSlot);
                            }
                        } else {
                            stopAllSlots();
                        }
                    }}
                />
            </div>

            <button
                className="loop-bank-btn"
                onClick={() => {
                    setShowLoopBank(true);
                    onModalFocus('loopbank');
                }}
                title="Loop Bank"
                style={{ display: 'none' }}
            >
                opciones avanzadas
            </button>

            {showLoopBank && (
                <>
                    <div className="loop-bank-backdrop" onClick={handleCloseModal} />
                    <div
                        className="loop-bank-modal"
                        onMouseDown={() => onModalFocus('loopbank')}
                        style={{
                            zIndex: activeModal === 'loopbank' ? 900 : 700,
                            ...(modalPos ? { left: modalPos.x, top: modalPos.y, right: 'auto', transform: 'none' } : {})
                        }}
                    >
                        <div
                            className="loop-bank-header"
                            onMouseDown={handleModalDragStart}
                            onTouchStart={handleModalDragStart}
                        >
                            <h3>Opciones Avanzadas</h3>
                            <button className="loop-bank-close" onClick={handleCloseModal}>×</button>
                        </div>

                        <div className="loop-bank-controls">
                            <div className="loop-bank-control-item">
                                <span className="control-label">Hold</span>
                                <button
                                    className={`control-btn-large ${isHold ? 'active' : ''}`}
                                    onClick={handleHold}
                                >
                                    {isHold ? 'ON' : 'OFF'}
                                </button>
                            </div>
                            <div className="loop-bank-control-item">
                                <span className="control-label">Play All</span>
                                <button
                                    className={`control-btn-large play ${anyPlaying ? 'active' : ''}`}
                                    onClick={anyPlaying ? stopAllSlots : playAllSlots}
                                    disabled={!hasAnyLoop}
                                >
                                    {anyPlaying ? '■' : '▶'}
                                </button>
                            </div>
                        </div>

                        <div className="loop-bank-section-title">Loop Bank</div>
                        <div className="loop-bank-slots-vertical">
                            {loopBank.map((slot, index) => (
                                <div key={index} className={`loop-slot-row ${slot.buffer ? 'has-loop' : 'empty'} ${slot.isPlaying ? 'playing' : ''} ${slot.isRecording ? 'recording' : ''}`}>
                                    <button
                                        className={`slot-rec-btn ${slot.isRecording ? 'active' : ''}`}
                                        onClick={() => toggleRecordSlot(index)}
                                        title={slot.isRecording ? 'Parar grabación' : 'Grabar en slot'}
                                    >
                                        ●
                                    </button>

                                    <span className="slot-number">{index + 1}</span>

                                    {slot.buffer ? (
                                        <>
                                            <button
                                                className="slot-play-btn"
                                                onClick={() => toggleSlotPlay(index)}
                                            >
                                                {slot.isPlaying ? '■' : '▶'}
                                            </button>
                                            <span className="slot-duration">{formatDuration(slot.trimEnd - slot.trimStart)}</span>
                                            <input
                                                type="range"
                                                className="slot-volume"
                                                min={0}
                                                max={100}
                                                value={slot.volume}
                                                onChange={(e) => setSlotVolume(index, Number(e.target.value))}
                                                title={`Vol: ${slot.volume}%`}
                                            />
                                            <button
                                                className="slot-trim-btn"
                                                onClick={() => setShowTrimModal(index)}
                                                title="Recortar"
                                            >
                                                ✂
                                            </button>
                                            <button
                                                className="slot-delete-btn"
                                                onClick={() => deleteSlot(index)}
                                            >
                                                ×
                                            </button>
                                        </>
                                    ) : (
                                        <span className="slot-empty">{slot.isRecording ? 'Grabando...' : 'Vacío - Click ● para grabar'}</span>
                                    )}
                                </div>
                            ))}
                        </div>

                        {countdown !== null && (
                            <div className="countdown-overlay">
                                <div className="countdown-content">
                                    <div className={`countdown-number ${countdown === 0 ? 'go' : ''}`}>
                                        {countdown > 0 ? countdown : 'GO!'}
                                    </div>
                                    <button className="countdown-cancel" onClick={cancelCountdown}>
                                        Cancelar
                                    </button>
                                </div>
                            </div>
                        )}

                        {showBackingTrackPrompt !== null && (
                            <div className="backing-track-prompt">
                                <div className="backing-prompt-header">
                                    <h4>¿Grabar con pista de fondo?</h4>
                                    <button onClick={() => setShowBackingTrackPrompt(null)}>×</button>
                                </div>
                                <p className="backing-prompt-text">Elegí un loop como pista o grabá solo:</p>
                                <div className="backing-options">
                                    {loopBank.map((slot, idx) => (
                                        slot.buffer && idx !== showBackingTrackPrompt ? (
                                            <button
                                                key={idx}
                                                className="backing-option-btn"
                                                onClick={() => startRecordingWithBacking(showBackingTrackPrompt, idx)}
                                            >
                                                <span className="backing-slot-num">Loop {idx + 1}</span>
                                                <span className="backing-slot-dur">{formatDuration(slot.trimEnd - slot.trimStart)}</span>
                                            </button>
                                        ) : null
                                    ))}
                                </div>
                                <button
                                    className="backing-solo-btn"
                                    onClick={() => startRecordingWithoutBacking(showBackingTrackPrompt)}
                                >
                                    Grabar solo (sin pista)
                                </button>
                            </div>
                        )}

                        {showTrimModal !== null && loopBank[showTrimModal]?.buffer && (
                            <div className="trim-modal">
                                <div className="trim-modal-header">
                                    <h4>Recortar Loop {showTrimModal + 1}</h4>
                                    <button onClick={() => setShowTrimModal(null)}>×</button>
                                </div>
                                <div className="trim-controls">
                                    <div className="trim-control">
                                        <label>Inicio: {loopBank[showTrimModal].trimStart.toFixed(2)}s</label>
                                        <input
                                            type="range"
                                            min={0}
                                            max={loopBank[showTrimModal].duration}
                                            step={0.01}
                                            value={loopBank[showTrimModal].trimStart}
                                            onChange={(e) => setSlotTrim(
                                                showTrimModal,
                                                Number(e.target.value),
                                                loopBank[showTrimModal].trimEnd
                                            )}
                                        />
                                    </div>
                                    <div className="trim-control">
                                        <label>Fin: {loopBank[showTrimModal].trimEnd.toFixed(2)}s</label>
                                        <input
                                            type="range"
                                            min={0}
                                            max={loopBank[showTrimModal].duration}
                                            step={0.01}
                                            value={loopBank[showTrimModal].trimEnd}
                                            onChange={(e) => setSlotTrim(
                                                showTrimModal,
                                                loopBank[showTrimModal].trimStart,
                                                Number(e.target.value)
                                            )}
                                        />
                                    </div>
                                    <div className="trim-info">
                                        Duración: {(loopBank[showTrimModal].trimEnd - loopBank[showTrimModal].trimStart).toFixed(2)}s
                                        <span className="trim-original">(Original: {loopBank[showTrimModal].duration.toFixed(2)}s)</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="loop-bank-actions">
                            <button
                                className="loop-bank-clear-btn"
                                onClick={clearAllSlots}
                            >
                                Borrar Todo
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

// Metronome Standalone Component
export type MetronomeClickSound = 'soft' | 'hard';

interface MetronomeProps {
    active: boolean;
    volume: number;
    muted: boolean;
    timeSignature: number;
    beat: number;
    accent: boolean;
    clickSound: MetronomeClickSound;
    tempo: number;
    onToggle: () => void;
    onVolumeChange: (vol: number) => void;
    onMuteToggle: () => void;
    onTimeSignatureChange: (ts: number) => void;
    onClickSoundChange: (sound: MetronomeClickSound) => void;
    onTempoChange: (t: number) => void;
}

export const Metronome: React.FC<MetronomeProps> = ({
    active,
    volume,
    muted,
    timeSignature,
    beat,
    accent,
    clickSound,
    tempo,
    onToggle,
    onVolumeChange,
    onMuteToggle,
    onTimeSignatureChange,
    onClickSoundChange,
    onTempoChange,
}) => {
    return (
        <div className="metronome-section">
            {/* FULL VERSION: shared tempo control can return to the metronome.
            <div className="metro-tempo-col">
                <RotaryKnob
                    value={tempo}
                    onChange={onTempoChange}
                    min={30}
                    max={300}
                    step={1}
                    label="tempo"
                    formatValue={(v) => `${v} bpm`}
                />
            </div>
            */}

            <div className="metro-controls-col">
                <div className="metronome-header">
                    <button
                        className={`metronome-toggle ${active ? 'active' : ''}`}
                        onClick={onToggle}
                        title={active ? 'Stop metronome' : 'Start metronome'}
                    />
                    <span className="metronome-label">Metro</span>
                    <button
                        className={`metronome-mute ${muted ? 'muted' : ''}`}
                        onClick={onMuteToggle}
                        title={muted ? 'Unmute click' : 'Mute click'}
                    >
                        {muted ? '🔇' : '🔊'}
                    </button>
                </div>

                <div className="metronome-beats">
                    {Array.from({ length: timeSignature }).map((_, i) => (
                        <div
                            key={i}
                            className={`metronome-pulse ${active && beat === i ? 'active' : ''} ${active && beat === i && accent ? 'accent' : ''}`}
                        />
                    ))}
                </div>

                <div className="metronome-sound-selector">
                    <button
                        className={`metronome-sound-btn ${clickSound === 'soft' ? 'active' : ''}`}
                        onClick={() => onClickSoundChange('soft')}
                    >Soft</button>
                    <button
                        className={`metronome-sound-btn ${clickSound === 'hard' ? 'active' : ''}`}
                        onClick={() => onClickSoundChange('hard')}
                    >Hard</button>
                </div>

                <div className="time-sig-selector">
                    {[3, 4, 6].map(ts => (
                        <button
                            key={ts}
                            className={`time-sig-btn ${timeSignature === ts ? 'active' : ''}`}
                            onClick={() => onTimeSignatureChange(ts)}
                        >
                            {ts === 6 ? '6/8' : `${ts}/4`}
                        </button>
                    ))}
                </div>

                <input
                    type="range"
                    className="metronome-volume"
                    min={0}
                    max={100}
                    value={volume}
                    onChange={(e) => onVolumeChange(Number(e.target.value))}
                    title={`Volume: ${volume}%`}
                />
            </div>
        </div>
    );
};
