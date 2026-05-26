export interface FivoNote {
    midi_value: number;
    // velocity etc if needed
}

export interface FivoResponse {
    key: number;
    root: number;
    isMinor?: boolean;
    style: string;
    color: string;
    colorCode: number;
    relation: string;
    fifthDistance: number;
    notes: number[];
}

export interface FivoContextResponse {
    key: number;
    style: string;
    map: Record<string, number>; // "0": 1, "2": 2 etc for major chords
    minorMap: Record<string, number>; // "0": 1, "2": 2 etc for minor chords
}

export type FivoStyle = 'pop' | 'rock' | 'jazz' | 'bossa';

import { LITE_MODE } from '../config';

// Use same host as frontend but port 3001 for BFF
const getApiBase = () => {
    if (import.meta.env.VITE_API_BASE_URL) {
        return import.meta.env.VITE_API_BASE_URL;
    }
    // Use current hostname (works for localhost and IP access)
    const host = window.location.hostname;
    return `http://${host}:3001/api`;
};
const API_BASE = getApiBase();

export type PowerMode = 'auto' | 'on' | 'off';

// Cache de acordes: evita round-trip a Railway en cada clic
const chordCache = new Map<string, FivoResponse>();

const cacheKey = (key: string, root: string, inversion: number, style: FivoStyle, isMinor: boolean, power: PowerMode, fingers: number) =>
    `${key}|${root}|${inversion}|${style}|${isMinor}|${power}|${fingers}`;

export const fetchChord = async (
    key: string,
    root: string,
    inversion: number = 0,
    style: FivoStyle = 'pop',
    isMinor: boolean = false,
    power: PowerMode = 'auto',
    fingers: number = 3
): Promise<FivoResponse> => {
    const ck = cacheKey(key, root, inversion, style, isMinor, power, fingers);
    const cached = chordCache.get(ck);
    if (cached) return cached;

    const url = `${API_BASE}/chord?key=${encodeURIComponent(key)}&root=${encodeURIComponent(root)}&inversion=${inversion}&style=${style}&minor=${isMinor}&power=${power}&fingers=${fingers}&lite=${LITE_MODE}`;
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`API Error: ${res.statusText}`);
    }
    const data = await res.json();
    chordCache.set(ck, data);
    return data;
};

// Pre-carga todos los acordes de la key+estilo actual en background
// Así el primer clic ya tiene el dato listo
const MAJOR_ROOTS = ['C', 'G', 'D', 'A', 'E', 'B', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
const MINOR_ROOTS  = ['A', 'E', 'B', 'F#', 'C#', 'G#', 'Eb', 'Bb', 'F', 'C', 'G', 'D'];

export const prefetchChords = (key: string, style: FivoStyle, power: PowerMode = 'auto') => {
    const fetches = [
        ...MAJOR_ROOTS.map(root => fetchChord(key, root, 0, style, false, power, 1)),
        ...MINOR_ROOTS.map(root  => fetchChord(key, root, 0, style, true,  power, 1)),
    ];
    // fire-and-forget, no bloqueamos nada
    Promise.all(fetches).catch(() => {});
};

export const fetchContext = async (key: string, style: FivoStyle = 'pop'): Promise<FivoContextResponse> => {
    const response = await fetch(`${API_BASE}/context?key=${encodeURIComponent(key)}&style=${style}&lite=${LITE_MODE}`);
    if (!response.ok) throw new Error('Failed to fetch Context');
    return response.json();
};
