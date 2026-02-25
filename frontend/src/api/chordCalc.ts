// chordCalc.ts — Port exacto de la lógica C++ (chord_engine.cpp + cli_main.cpp)
// Calcula notas MIDI localmente, sin llamada a API.

import type { FivoStyle, PowerMode } from './fivo';

const NOTE_SEMITONE: Record<string, number> = {
    'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4,
    'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8,
    'A': 9, 'A#': 10, 'Bb': 10, 'B': 11
};

type ChordType = 'MAJOR' | 'MINOR' | 'POWER5' | 'DOM7' | 'MAJ7' | 'MIN7' | 'DOM9' | 'MAJ9' | 'MIN9';

const CHORD_INTERVALS: Record<ChordType, number[]> = {
    MAJOR:  [0, 4, 7],
    MINOR:  [0, 3, 7],
    POWER5: [0, 7],
    DOM7:   [0, 4, 7, 10],
    MAJ7:   [0, 4, 7, 11],
    MIN7:   [0, 3, 7, 10],
    DOM9:   [0, 4, 7, 10, 14],
    MAJ9:   [0, 4, 7, 11, 14],
    MIN9:   [0, 3, 7, 10, 14],
};

// Strips 'm' for minor keys ("Am" -> "A")
function parseSemitone(s: string): number {
    const key = s.endsWith('m') && s.length > 1 ? s.slice(0, -1) : s;
    return NOTE_SEMITONE[key] ?? 0;
}

// Mirrors fivo_get_chord_ex fingers logic
function applyFingers(intervals: number[], type: ChordType, fingers: number): number[] {
    const is7th = ['DOM7','MAJ7','MIN7','DOM9','MAJ9','MIN9'].includes(type);
    const is9th = ['DOM9','MAJ9','MIN9'].includes(type);
    const out: number[] = [];

    if (is7th) {
        // Jazz voicing: root, 7th, 3rd (drop 5th)
        if (fingers >= 1) out.push(intervals[0]);               // root
        if (fingers >= 2 && intervals.length >= 4) out.push(intervals[3]); // 7th
        if (fingers >= 3 && intervals.length >= 2) out.push(intervals[1]); // 3rd
        if (fingers >= 3 && is9th && intervals.length >= 5) out.push(intervals[4]); // 9th
    } else {
        // Triad: root, 5th, 3rd
        if (fingers >= 1) out.push(intervals[0]);
        if (fingers >= 2) {
            if (intervals.length >= 3) out.push(intervals[2]);  // 5th
            else if (intervals.length >= 2) out.push(intervals[1]);
        }
        if (fingers >= 3 && intervals.length >= 3) out.push(intervals[1]); // 3rd
    }

    return [...out].sort((a, b) => a - b);
}

function applyInversion(intervals: number[], inversion: number): number[] {
    const r = [...intervals];
    for (let i = 0; i < inversion; i++) {
        if (r.length > 0) r.push(r.shift()! + 12);
    }
    return r;
}

/**
 * Calcula notas MIDI localmente. Replica exactamente cli_main.cpp.
 *
 * @param keyStr     Tonalidad, ej: "C", "Am", "F#"
 * @param rootStr    Raíz del acorde (sin 'm'), ej: "G", "F#"
 * @param isMinor    Si es acorde menor
 * @param style      Estilo musical
 * @param inversion  0 | 1 | 2
 * @param fingers    1 | 2 | 3 notas
 * @param power      'auto' | 'on' | 'off'
 * @param contextMap colorCode por semitono del contexto actual (0=RED,1=ORANGE,2=GREEN)
 */
export function calcChordNotes(
    keyStr: string,
    rootStr: string,
    isMinor: boolean,
    style: FivoStyle,
    inversion: number,
    fingers: number,
    power: PowerMode,
    contextMap?: Record<string, number>,
): number[] {
    const keySemitone  = parseSemitone(keyStr);
    const rootSemitone = NOTE_SEMITONE[rootStr] ?? 0;
    const rootMidi     = 12 * 4 + rootSemitone; // octave 3: 12*(3+1)=48 + root

    // Power auto: misma lógica que C++ — solo aplica a acordes mayores con color < GREEN
    const colorCode = contextMap ? (contextMap[rootSemitone.toString()] ?? 2) : 2;
    const isPower = power === 'on' || (power === 'auto' && !isMinor && colorCode < 2);

    // Tipo de acorde (cli_main.cpp: isMinor -> MINOR, luego jazz/bossa upgrade)
    let type: ChordType = isMinor ? 'MINOR' : 'MAJOR';

    if (isPower) {
        type = 'POWER5';
    } else if (style === 'jazz') {
        if (isMinor) {
            type = 'MIN9';
        } else {
            const deg = (rootSemitone - keySemitone + 12) % 12;
            type = (deg === 0 || deg === 5) ? 'MAJ9' : 'DOM9';
        }
    } else if (style === 'bossa') {
        if (isMinor) {
            type = 'MIN7';
        } else {
            const deg = (rootSemitone - keySemitone + 12) % 12;
            type = (deg === 0 || deg === 5) ? 'MAJ7' : 'DOM7';
        }
    }

    const base    = CHORD_INTERVALS[type];
    const limited = applyFingers(base, type, fingers);
    const final   = applyInversion(limited, inversion);

    return final.map(interval => Math.max(0, Math.min(127, rootMidi + interval)));
}
