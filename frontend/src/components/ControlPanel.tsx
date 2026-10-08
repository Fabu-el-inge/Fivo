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

    // La caña es vertical en escritorio y horizontal en la franja de mobile.
    // En vez de un prop, se toma el eje del propio elemento: el lado mas largo
    // manda. Asi el arrastre siempre sigue a la forma que se ve en pantalla.
    const handleMove = (clientX: number, clientY: number) => {
        const rect = trackRef.current?.getBoundingClientRect();
        if (!rect) return;
        const horizontal = rect.width > rect.height;
        const raw = horizontal
            ? (clientX - rect.left) / rect.width
            : 1 - (clientY - rect.top) / rect.height;
        const pct = Math.max(0, Math.min(1, raw));
        onChange(Math.round(pct * 100));
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(true);
        e.currentTarget.setPointerCapture(e.pointerId);
        handleMove(e.clientX, e.clientY);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isDragging) return;
        e.preventDefault();
        handleMove(e.clientX, e.clientY);
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
            <div className="panel-rule" />
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
                <div className="vfader-fill" style={{ '--v': `${value}%` } as React.CSSProperties} />
                <div className="vfader-thumb" style={{ '--v': `${value}%` } as React.CSSProperties} />
            </div>
            <span className="vfader-value">
                {value}
                <span className="vfader-unit">&nbsp;%</span>
            </span>
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
                        // expresion: un pasa-bajos y una ganancia de Tone despues de Surge (ver
                        // AudioEngine.setExpressionControls).
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

    const index = Math.max(0, instruments.indexOf(instrument)) + 1;

    return (
        <div className="style-selector-apple instrument-panel">
            <div className="panel-head">
                <label>Instrument</label>
                <span className="panel-index">
                    {String(index).padStart(2, '0')}
                    <span className="panel-index-total">&nbsp;/&nbsp;04</span>
                </span>
            </div>
            <div className="panel-rule" />
            <div className="style-list-apple">
                {instruments.map((i) => (
                    <button
                        key={i}
                        className={`style-item-apple ${instrument === i ? 'active' : ''}`}
                        onClick={() => onInstrumentChange(i)}
                    >
                        <span className="slot-rail" aria-hidden="true" />
                        <span className="slot-name">{i}</span>
                        <span className="slot-dot" aria-hidden="true" />
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
                <div className="arp-head">
                    <span className="arp-title-lite">
                        <span className="arp-title-long">arpeggiator</span>
                        <span className="arp-title-short">arp</span>
                    </span>
                    <span className="arp-state-text">{isOn ? 'ON' : 'OFF'}</span>
                    <button
                        type="button"
                        className={`arp-power-switch arp-power-mini ${isOn ? 'on' : ''}`}
                        onClick={toggleOn}
                        role="switch"
                        aria-checked={isOn}
                        aria-label={isOn ? 'Apagar arpegiador' : 'Encender arpegiador'}
                    >
                        <span className="arp-power-thumb" />
                    </button>
                </div>
                <div className="panel-rule" />
                <div className="arp-demo-row">
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
