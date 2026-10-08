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
import { CONTEXT_TABLE } from './contextTable';

type ContextKey = keyof typeof CONTEXT_TABLE.lite.pop;

// In dev, Vite proxies /api to the BFF. This keeps mobile testing on one LAN port.
const getApiBase = () => {
    if (import.meta.env.VITE_API_BASE_URL) {
        const configuredUrl = new URL(import.meta.env.VITE_API_BASE_URL);
        const isLocalApi = configuredUrl.hostname === 'localhost' || configuredUrl.hostname === '127.0.0.1';
        const isLocalPage = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

        if (import.meta.env.DEV && isLocalApi && !isLocalPage) {
            return '/api';
        }

        if (isLocalApi && isLocalPage) {
            configuredUrl.hostname = window.location.hostname;
        }

        return configuredUrl.toString().replace(/\/$/, '');
    }
    if (import.meta.env.DEV) return '/api';
    return '/api';
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

// Colores del circulo: salen de la tabla generada desde el motor C++
// (contextTable.ts), sin red. Antes venian de /api/context en cada cambio de
// tonalidad o estilo; si el backend fallaba, el circulo quedaba gris y el
// power chord automatico dejaba de aplicarse.
export const getContext = (key: string, style: FivoStyle = 'pop'): FivoContextResponse | null => {
    const entry = CONTEXT_TABLE[LITE_MODE ? 'lite' : 'full'][style][key as ContextKey];
    if (!entry) return null;
    const toMap = (colors: readonly number[]) => Object.fromEntries(colors.map((c, i) => [String(i), c]));
    return { key: 0, style, map: toMap(entry[0]), minorMap: toMap(entry[1]) };
};
