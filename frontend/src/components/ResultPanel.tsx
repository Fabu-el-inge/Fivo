import type React from 'react';
import type { FivoResponse } from '../api/fivo';

interface Props {
    chordData: FivoResponse | null;
}

// Helper to convert note ID to name
const noteIdToName = (id: number): string => {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    return names[id % 12] || '?';
};

export const ResultPanel: React.FC<Props> = ({ chordData }) => {
    if (!chordData) return null;

    const rootName = noteIdToName(chordData.root);

    return (
        <div className="result-minimal">
            <span className="chord-text">
                {rootName} {chordData.color.includes('minor') ? 'Minor' : 'Major'}
            </span>
            <span className="separator">•</span>
            <div className="mini-notes">
                {chordData.notes.map((n, i) => (
                    <span key={i} className="mini-note">{n}</span>
                ))}
            </div>
        </div>
    );
};
