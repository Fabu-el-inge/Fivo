

import type React from 'react';

interface Props {
    currentKey: string;
    selectedRoot: string;
    onRootSelect: (note: string, isMinor: boolean) => void;
    contextMap?: Record<string, number>;
    minorContextMap?: Record<string, number>;
}

// Circle of Fifths order - Major chords
const NOTES = ['C', 'G', 'D', 'A', 'E', 'B', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F'];

// Circle of Fifths order - Minor chords (relative minors aligned with majors)
const MINOR_NOTES = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm'];

// Note to semitone ID (for major notes)
const getNoteId = (note: string): number => {
    const map: Record<string, number> = {
        'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5,
        'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11
    };
    return map[note] ?? -1;
};

// Minor note to semitone ID (root of the minor chord)
const getMinorNoteId = (note: string): number => {
    const map: Record<string, number> = {
        'Am': 9, 'A#m': 10, 'Bbm': 10, 'Bm': 11,
        'Cm': 0, 'C#m': 1, 'Dbm': 1, 'Dm': 2, 'D#m': 3, 'Ebm': 3, 'Em': 4,
        'Fm': 5, 'F#m': 6, 'Gbm': 6, 'Gm': 7, 'G#m': 8, 'Abm': 8
    };
    return map[note] ?? -1;
};

// Get color for harmonic context
const getColor = (note: string, currentKey: string, contextMap?: Record<string, number>): string => {
    if (note === currentKey) return 'var(--color-tonic)';

    if (!contextMap) return 'var(--color-neutral)';

    const id = getNoteId(note);
    const code = contextMap[id.toString()];

    switch (code) {
        case 2: return 'var(--color-safe)';
        case 1: return 'var(--color-tension)';
        case 0: return 'var(--color-avoid)';
        default: return 'var(--color-neutral)';
    }
};

// Get color for minor chords
const getMinorColor = (note: string, currentKey: string, minorContextMap?: Record<string, number>): string => {
    const keyId = getNoteId(currentKey);
    const minorId = getMinorNoteId(note);
    const relativeMinorId = (keyId + 9) % 12;

    if (minorId === relativeMinorId) return 'var(--color-tonic)';

    if (!minorContextMap) return 'var(--color-neutral)';

    const code = minorContextMap[minorId.toString()];

    switch (code) {
        case 2: return 'var(--color-safe)';
        case 1: return 'var(--color-tension)';
        case 0: return 'var(--color-avoid)';
        default: return 'var(--color-neutral)';
    }
};

// Helper to check if a color is neutral (for text color decision)
const isNeutralColor = (color: string): boolean => {
    return color === 'var(--color-neutral)';
};

// Create SVG arc path for a segment
const createArcPath = (
    startAngle: number,
    endAngle: number,
    innerRadius: number,
    outerRadius: number,
    cx: number,
    cy: number
): string => {
    const startRad = (startAngle - 90) * (Math.PI / 180);
    const endRad = (endAngle - 90) * (Math.PI / 180);

    const x1 = cx + outerRadius * Math.cos(startRad);
    const y1 = cy + outerRadius * Math.sin(startRad);
    const x2 = cx + outerRadius * Math.cos(endRad);
    const y2 = cy + outerRadius * Math.sin(endRad);
    const x3 = cx + innerRadius * Math.cos(endRad);
    const y3 = cy + innerRadius * Math.sin(endRad);
    const x4 = cx + innerRadius * Math.cos(startRad);
    const y4 = cy + innerRadius * Math.sin(startRad);

    const largeArc = endAngle - startAngle > 180 ? 1 : 0;

    return `M ${x1} ${y1} 
            A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${x2} ${y2} 
            L ${x3} ${y3} 
            A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4} ${y4} 
            Z`;
};

// Get label position for arc segment
const getLabelPosition = (
    startAngle: number,
    endAngle: number,
    innerRadius: number,
    outerRadius: number,
    cx: number,
    cy: number
): { x: number; y: number } => {
    const midAngle = ((startAngle + endAngle) / 2 - 90) * (Math.PI / 180);
    const midRadius = (innerRadius + outerRadius) / 2;
    return {
        x: cx + midRadius * Math.cos(midAngle),
        y: cy + midRadius * Math.sin(midAngle)
    };
};

export const CircleOfFifths: React.FC<Props> = ({
    currentKey,
    selectedRoot,
    onRootSelect,
    contextMap,
    minorContextMap
}) => {
    // Calculate rotation to put current key at top (12 o'clock)
    const keyIndex = NOTES.indexOf(currentKey);
    const rotationDeg = keyIndex * -30;

    // Increase canvas size to prevent drop-shadow clipping
    const size = 500;
    const cx = size / 2;
    const cy = size / 2;

    // Ring radiuses (from center outward)
    // Scaled for size=500 canvas
    const majorOuterRadius = 230;
    const majorInnerRadius = 160;
    const minorOuterRadius = 155;
    const minorInnerRadius = 90;

    const segmentAngle = 30; // 360 / 12

    return (
        <div className="circle-wrapper">
            {/* Center Label */}
            <div className="circle-center">
                <div className="key-label">Key</div>
                <div className="key-value">{currentKey}</div>
            </div>

            {/* SVG Ring Container */}
            <svg
                className="circle-svg"
                viewBox={`0 0 ${size} ${size}`}
                style={{ transform: `rotate(${rotationDeg}deg)` }}
            >
                <defs>
                    <linearGradient id="glass-shine" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="white" stopOpacity="0.4" />
                        <stop offset="50%" stopColor="white" stopOpacity="0.1" />
                        <stop offset="100%" stopColor="white" stopOpacity="0.0" />
                    </linearGradient>
                    <filter id="inner-glow">
                        <feGaussianBlur stdDeviation="2" result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="arithmetic" k2="-1" k3="1" />
                    </filter>
                </defs>

                {/* Outer Ring - Major Chords */}
                {NOTES.map((note, index) => {
                    const startAngle = index * segmentAngle - (segmentAngle / 2);
                    const endAngle = (index + 1) * segmentAngle - (segmentAngle / 2);
                    const color = getColor(note, currentKey, contextMap);
                    // Check if it's "neutral" to decide if we light it up
                    const isNeutral = isNeutralColor(color);
                    const isSelected = note === selectedRoot && !selectedRoot.includes('m');
                    const labelPos = getLabelPosition(startAngle, endAngle, majorInnerRadius, majorOuterRadius, cx, cy);
                    const counterRotation = -rotationDeg;

                    return (
                        <g
                            key={note}
                            className={`glass-pad-group ${isSelected ? 'selected' : ''} ${isNeutral ? 'neutral' : 'active'}`}
                            style={{ '--segment-color': color } as React.CSSProperties}
                            onClick={() => onRootSelect(note, false)}
                        >
                            {/* Layer 1: Intense Color (Behind) */}
                            <path
                                d={createArcPath(startAngle, endAngle, majorInnerRadius, majorOuterRadius, cx, cy)}
                                className="glass-pad-color major"
                            />
                            {/* Layer 2: Glass Shine/Reflection (Front) */}
                            <path
                                d={createArcPath(startAngle, endAngle, majorInnerRadius, majorOuterRadius, cx, cy)}
                                className="glass-pad-shine major"
                                fill="url(#glass-shine)"
                            />
                            <text
                                x={labelPos.x}
                                y={labelPos.y}
                                className="glass-pad-label"
                                style={{ transform: `rotate(${counterRotation}deg)`, transformOrigin: `${labelPos.x}px ${labelPos.y}px` }}
                            >
                                {note}
                            </text>
                        </g>
                    );
                })}

                {/* Inner Ring - Minor Chords */}
                {MINOR_NOTES.map((note, index) => {
                    const startAngle = index * segmentAngle - (segmentAngle / 2);
                    const endAngle = (index + 1) * segmentAngle - (segmentAngle / 2);
                    const color = getMinorColor(note, currentKey, minorContextMap);
                    const isNeutral = isNeutralColor(color);
                    const isSelected = selectedRoot === note;
                    const labelPos = getLabelPosition(startAngle, endAngle, minorInnerRadius, minorOuterRadius, cx, cy);
                    const counterRotation = -rotationDeg;

                    return (
                        <g
                            key={note}
                            className={`glass-pad-group ${isSelected ? 'selected' : ''} ${isNeutral ? 'neutral' : 'active'}`}
                            style={{ '--segment-color': color } as React.CSSProperties}
                            onClick={() => onRootSelect(note, true)}
                        >
                            {/* Layer 1: Intense Color (Behind) */}
                            <path
                                d={createArcPath(startAngle, endAngle, minorInnerRadius, minorOuterRadius, cx, cy)}
                                className="glass-pad-color minor"
                            />
                            {/* Layer 2: Glass Shine/Reflection (Front) */}
                            <path
                                d={createArcPath(startAngle, endAngle, minorInnerRadius, minorOuterRadius, cx, cy)}
                                className="glass-pad-shine minor"
                                fill="url(#glass-shine)"
                            />
                            <text
                                x={labelPos.x}
                                y={labelPos.y}
                                className="glass-pad-label minor"
                                style={{ transform: `rotate(${counterRotation}deg)`, transformOrigin: `${labelPos.x}px ${labelPos.y}px` }}
                            >
                                {note}
                            </text>
                        </g>
                    );
                })}

                {/* Divider lines - We might not need them if we use gap/stroke, but let's keep for precision */}
                {Array.from({ length: 12 }).map((_, index) => {
                    const angle = ((index * segmentAngle - (segmentAngle / 2)) - 90) * (Math.PI / 180);
                    // Draw continuous line from minor inner to major outer? Or 2 segments?
                    // Let's draw full length to separate the "keys" visually
                    const x1 = cx + minorInnerRadius * Math.cos(angle);
                    const y1 = cy + minorInnerRadius * Math.sin(angle);
                    const x2 = cx + majorOuterRadius * Math.cos(angle);
                    const y2 = cy + majorOuterRadius * Math.sin(angle);

                    return (
                        <line
                            key={`divider-${index}`}
                            x1={x1}
                            y1={y1}
                            x2={x2}
                            y2={y2}
                            className="glass-divider"
                        />
                    );
                })}
            </svg>
        </div>
    );
};
