// engine.ts — Port exacto del motor C++ para la lectura del acorde (lo que
// antes devolvia GET /api/chord del BFF en Railway): demos/cli_main.cpp +
// core/src/chord_engine.cpp + core/src/circle_engine.cpp. El color sale de
// contextTable.ts, generada desde core/src/style_manager.cpp.
//
// No es lo que suena: lo que suena lo calcula chordCalc.ts (difieren en jazz y
// bossa, ver docs/AUDITORIA-2026-10.md H1). Verificado contra el binario C++
// en todo el dominio que usa la app: scripts/check-engine.mjs.

import { CONTEXT_TABLE } from './contextTable';
import type { FivoResponse, FivoStyle, PowerMode } from './fivo';

type ContextKey = keyof typeof CONTEXT_TABLE.lite.pop;

const NOTE_IDS: Record<string, number> = {
    'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5,
    'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11,
};

// parse_note: saca la "m" final (tonalidades menores); lo desconocido es C.
const parseNote = (s: string): number => NOTE_IDS[s.endsWith('m') ? s.slice(0, -1) : s] ?? 0;

type ChordType =
    | 'MAJOR' | 'MINOR' | 'DOM7' | 'MAJ7' | 'MIN7' | 'POWER5' | 'DOM9' | 'MAJ9' | 'MIN9'
    | 'DOM13' | 'DOM7_FLAT13' | 'DOM7_SHARP9' | 'MAJ7_ADD6' | 'MIN7_ADD11' | 'MIN11';

// Prioridad de voces por tipo (chord_engine.cpp, paso 2): se toman las
// primeras `fingers` y se ordenan.
const PRIORITY: Record<ChordType, number[]> = {
    MAJOR: [0, 7, 4],
    MINOR: [0, 7, 3],
    POWER5: [0, 7],
    DOM7: [0, 10, 4, 7],
    MAJ7: [0, 11, 4, 7],
    MIN7: [0, 10, 3, 7],
    DOM9: [0, 10, 4, 14, 7],
    MAJ9: [0, 11, 4, 14, 7],
    MIN9: [0, 10, 3, 14, 7],
    DOM13: [0, 10, 4, 21, 7],
    DOM7_FLAT13: [0, 10, 4, 20, 7],
    DOM7_SHARP9: [0, 10, 4, 15, 7],
    MAJ7_ADD6: [0, 11, 4, 9, 7],
    MIN7_ADD11: [0, 10, 3, 17, 7],
    MIN11: [0, 10, 3, 17, 14, 7],
};

// Voicings jazz por grado (cli_main.cpp, slide "ACORDES JAZZY").
const JAZZ_MINOR: Record<number, ChordType> = { 5: 'MIN11', 1: 'MIN7_ADD11', 4: 'MIN7_ADD11', 6: 'MIN7_ADD11', 8: 'MIN7_ADD11', 11: 'MIN7_ADD11' };
const JAZZ_MAJOR: Record<number, ChordType> = {
    0: 'MAJ7', 5: 'MAJ7', 3: 'MAJ7', 11: 'MAJ7_ADD6', 1: 'MAJ9', 6: 'MAJ9', 8: 'MAJ9',
    7: 'DOM13', 9: 'DOM7_FLAT13', 4: 'DOM7_SHARP9', 2: 'DOM9', 10: 'DOM9',
};

const COLOR_NAMES = ['RED (Unsafe)', 'ORANGE (Tension)', 'GREEN (Safe)', 'BLUE (Active)'];
const STYLE_NAMES: Record<FivoStyle, string> = { pop: 'Pop', rock: 'Rock', jazz: 'Jazz', bossa: 'Bossa' };

const fifthDistance = (from: number, to: number): number => {
    const fifthPos = ((((to - from + 12) % 12) * 7) % 12);
    return fifthPos > 6 ? 12 - fifthPos : fifthPos;
};

/**
 * Misma respuesta que GET /api/chord (bff/server.js → fivo_demo --json).
 * Devuelve null si la tonalidad no esta en la tabla de colores.
 */
export function engineChord(
    keyStr: string,
    rootStr: string,
    inversion: number,
    style: FivoStyle,
    isMinor: boolean,
    power: PowerMode,
    fingersParam: number,
    lite: boolean,
): FivoResponse | null {
    const colors = CONTEXT_TABLE[lite ? 'lite' : 'full'][style][keyStr as ContextKey];
    if (!colors) return null;

    const key = parseNote(keyStr);
    const root = parseNote(rootStr);
    let fingers = Math.min(3, Math.max(1, Math.trunc(fingersParam)));
    let type: ChordType = isMinor ? 'MINOR' : 'MAJOR';
    let isPower = false;
    if (power === 'on') {
        isPower = true;
        type = 'POWER5';
    }

    const color = colors[isMinor ? 1 : 0][root];

    // Power chord automatico: ORANGE/RED mayores, salvo jazz y bossa.
    if (power === 'auto' && !isMinor && (color === 1 || color === 0) && style !== 'jazz' && style !== 'bossa') {
        isPower = true;
        type = 'POWER5';
    }

    const degree = (root - key + 12) % 12;
    if (style === 'jazz' && !isPower) {
        type = isMinor ? (JAZZ_MINOR[degree] ?? 'MIN9') : JAZZ_MAJOR[degree];
        if (fingers < 4) fingers = 4;
        if (type === 'MIN11' && fingers < 5) fingers = 5;
    }
    if (style === 'bossa' && !isPower) {
        type = isMinor ? 'MIN7' : (degree === 0 || degree === 5 ? 'MAJ7' : 'DOM7');
    }

    // fivo_get_chord_ex(root, type, inversion, 3, { fingers }) sin voice leading.
    const intervals = PRIORITY[type].slice(0, fingers).sort((a, b) => a - b);
    for (let i = 0; i < inversion; i++) {
        if (intervals.length > 0) intervals.push(intervals.shift()! + 12);
    }
    const rootBase = 12 * 4 + root;
    const notes = intervals.slice(0, 8).map(iv => Math.min(127, Math.max(0, rootBase + iv)));

    let relation = 'OTHER';
    if (isMinor) {
        if (root === (key + 9) % 12) relation = 'RELATIVE_MINOR';
        else if (root === (key + 2) % 12) relation = 'SUPERTONIC_MINOR';
        else if (root === (key + 4) % 12) relation = 'MEDIANT_MINOR';
        // El C++ tiene aca SUBMEDIANT_MINOR con la misma condicion que
        // RELATIVE_MINOR (key + 9): nunca se ejecuta, asi que no se porta.
        else if (root === key) relation = 'PARALLEL_MINOR';
    } else {
        if (root === (key + 7) % 12) relation = 'DOMINANT';
        else if (root === (key + 5) % 12) relation = 'SUBDOMINANT';
        else if (root === key) relation = 'TONIC';
        else if (root === (key + 9) % 12) relation = 'RELATIVE_MINOR';
    }

    return {
        key,
        root,
        isMinor,
        isPower,
        fingers,
        style: STYLE_NAMES[style],
        color: COLOR_NAMES[color],
        colorCode: color,
        relation,
        fifthDistance: fifthDistance(key, root),
        notes,
    };
}
