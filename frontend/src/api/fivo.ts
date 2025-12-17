export interface FivoNote {
    midi_value: number;
    // velocity etc if needed
}

export interface FivoResponse {
    key: number;
    root: number;
    color: string;
    colorCode: number;
    relation: string;
    notes: number[];
}

export interface FivoContextResponse {
    key: number;
    map: Record<string, number>; // "0": 1, "2": 2 etc for major chords
    minorMap: Record<string, number>; // "0": 1, "2": 2 etc for minor chords
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

export const fetchChord = async (key: string, root: string, inversion: number = 0): Promise<FivoResponse> => {
    // Note: passing inversion to backend
    const res = await fetch(`${API_BASE}/chord?key=${encodeURIComponent(key)}&root=${encodeURIComponent(root)}&inversion=${inversion}`);
    if (!res.ok) {
        throw new Error(`API Error: ${res.statusText}`);
    }
    return res.json();
};

export const fetchContext = async (key: string): Promise<FivoContextResponse> => {
    const response = await fetch(`${API_BASE}/context?key=${encodeURIComponent(key)}`);
    if (!response.ok) throw new Error('Failed to fetch Context');
    return response.json();
};
