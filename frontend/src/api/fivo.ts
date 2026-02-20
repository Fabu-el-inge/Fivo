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

export const fetchChord = async (
    key: string,
    root: string,
    inversion: number = 0,
    style: FivoStyle = 'pop',
    isMinor: boolean = false,
    power: PowerMode = 'auto',
    fingers: number = 3
): Promise<FivoResponse> => {
    const url = `${API_BASE}/chord?key=${encodeURIComponent(key)}&root=${encodeURIComponent(root)}&inversion=${inversion}&style=${style}&minor=${isMinor}&power=${power}&fingers=${fingers}`;
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`API Error: ${res.statusText}`);
    }
    return res.json();
};

export const fetchContext = async (key: string, style: FivoStyle = 'pop'): Promise<FivoContextResponse> => {
    const response = await fetch(`${API_BASE}/context?key=${encodeURIComponent(key)}&style=${style}`);
    if (!response.ok) throw new Error('Failed to fetch Context');
    return response.json();
};
