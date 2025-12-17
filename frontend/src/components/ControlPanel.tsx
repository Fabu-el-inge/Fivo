import React, { useState, useRef } from 'react';

// Shared interfaces if needed, or just inline props for simplicity.
// But keeping a loose contract is good.

interface ToolsLeftProps {
    inversion: number;
    strumEnabled: boolean;
    strumSpeed: number;
    articulation: number;
    expression: boolean;
    onInversionChange: (inv: number) => void;
    onStrumToggle: () => void;
    onStrumSpeedChange: (val: number) => void;
    onArticulationChange: (val: number) => void;
    onExpressionToggle: (val: boolean) => void;
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

const RotaryKnob: React.FC<RotaryKnobProps> = ({
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
            <div className="knob-value-label">
                {formatValue ? formatValue(value) : value}
            </div>
        </div>
    );
};

export const ToolsLeft: React.FC<ToolsLeftProps> = ({
    inversion,
    strumEnabled,
    strumSpeed,
    articulation,
    expression,
    onInversionChange,
    onStrumToggle,
    onStrumSpeedChange,
    onArticulationChange,
    onExpressionToggle,
}) => {
    // Adapter for Strum:
    // Knob Value: 0 = OFF. 1..100 = Speed (mapped 10..200?)
    // Actually simplicity: Let knob value be Strum Delay directly?
    // User wants "Off sea 0".
    // Let's say range 0 to 200.
    // If 0 -> OFF.
    // If >0 -> ON, value is delay.
    // But typical delay is 10ms (fast) to 200ms (slow).
    // Let's allow 0 as a special "OFF" state.

    const handleStrumKnobChange = (val: number) => {
        if (val === 0) {
            if (strumEnabled) onStrumToggle(); // Turn OFF
        } else {
            if (!strumEnabled) onStrumToggle(); // Turn ON
            // Clamp min speed if needed, but 1ms is fine visually
            // Usually < 10ms is instant.
            onStrumSpeedChange(Math.max(10, val));
        }
    };

    const currentStrumVal = strumEnabled ? strumSpeed : 0;

    return (
        <div className="tools-left glass-panel">
            {/* Inversion Knob (Discrete) */}
            <RotaryKnob
                value={inversion}
                onChange={onInversionChange}
                min={0}
                max={2}
                step={1}
                label="Inversion"
                formatValue={(v) => v === 0 ? 'Root' : v === 1 ? '1st' : '2nd'}
            />

            {/* Strum Knob (Continuous) */}
            <RotaryKnob
                value={currentStrumVal}
                onChange={handleStrumKnobChange}
                min={0}
                max={200}
                step={5}
                label="Strum"
                formatValue={(v) => v === 0 ? 'OFF' : `${v}ms`}
            />

            {/* Articulation Knob */}
            <RotaryKnob
                value={articulation}
                onChange={onArticulationChange}
                min={0}
                max={3}
                step={1}
                label="Artic."
                formatValue={(v) => `Lvl ${v}`}
            />

            {/* Expression Knob */}
            <RotaryKnob
                value={expression ? 1 : 0}
                onChange={(v) => onExpressionToggle(v === 1)}
                min={0}
                max={1}
                step={1}
                label="Expr."
                formatValue={(v) => v === 1 ? 'ON' : 'OFF'}
            />
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

interface OctaveControlProps {
    octave: number;
    onOctaveChange: (delta: number) => void;
}

export const OctaveControl: React.FC<OctaveControlProps> = ({ octave, onOctaveChange }) => {
    return (
        <div className="octave-control glass-panel compact">
            <button onClick={() => onOctaveChange(-1)}>−</button>
            <span className="value-display">{octave}</span>
            <button onClick={() => onOctaveChange(1)}>+</button>
        </div>
    );
};

interface KeySelectorProps {
    currentKey: string;
    notes: string[];
    onKeyChange: (key: string) => void;
}

export const KeySelector: React.FC<KeySelectorProps> = ({ currentKey, notes, onKeyChange }) => {
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
                    <div className="key-options-grid">
                        {notes.map((n) => (
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
                )}
            </div>
            {isOpen && (
                <div className="backdrop" onClick={() => setIsOpen(false)} />
            )}
        </div>
    );
};
