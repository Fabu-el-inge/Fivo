export interface FivoNote {
    midi_value: number;
    // velocity etc if needed
}

export interface FivoResponse {
    key: number;
    root: number;
    isMinor?: boolean;
    isPower?: boolean;
    fingers?: number;
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

export type PowerMode = 'auto' | 'on' | 'off';

// El front ya no llama al backend: los colores salen de contextTable.ts y la
// lectura del acorde de engine.ts (port exacto del motor C++). El BFF (bff/)
// queda para desarrollo y para regenerar/verificar contra el binario.

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
