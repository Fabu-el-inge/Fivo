// Metronomo de la version completa. La UI esta oculta en LITE (App.tsx).
import React from 'react';
import { RotaryKnob } from './ControlPanel';

export type MetronomeClickSound = 'soft' | 'hard';

interface MetronomeProps {
    active: boolean;
    volume: number;
    muted: boolean;
    timeSignature: number;
    beat: number;
    accent: boolean;
    clickSound: MetronomeClickSound;
    tempo: number;
    onToggle: () => void;
    onVolumeChange: (vol: number) => void;
    onMuteToggle: () => void;
    onTimeSignatureChange: (ts: number) => void;
    onClickSoundChange: (sound: MetronomeClickSound) => void;
    onTempoChange: (t: number) => void;
}

export const Metronome: React.FC<MetronomeProps> = ({
    active,
    volume,
    muted,
    timeSignature,
    beat,
    accent,
    clickSound,
    tempo,
    onToggle,
    onVolumeChange,
    onMuteToggle,
    onTimeSignatureChange,
    onClickSoundChange,
    onTempoChange,
}) => {
    return (
        <div className="metronome-section">
            {/* FULL VERSION: shared tempo control can return to the metronome.
            <div className="metro-tempo-col">
                <RotaryKnob
                    value={tempo}
                    onChange={onTempoChange}
                    min={30}
                    max={300}
                    step={1}
                    label="tempo"
                    formatValue={(v) => `${v} bpm`}
                />
            </div>
            */}

            <div className="metro-controls-col">
                <div className="metronome-header">
                    <button
                        className={`metronome-toggle ${active ? 'active' : ''}`}
                        onClick={onToggle}
                        title={active ? 'Stop metronome' : 'Start metronome'}
                    />
                    <span className="metronome-label">Metro</span>
                    <button
                        className={`metronome-mute ${muted ? 'muted' : ''}`}
                        onClick={onMuteToggle}
                        title={muted ? 'Unmute click' : 'Mute click'}
                    >
                        {muted ? '🔇' : '🔊'}
                    </button>
                </div>

                <div className="metronome-beats">
                    {Array.from({ length: timeSignature }).map((_, i) => (
                        <div
                            key={i}
                            className={`metronome-pulse ${active && beat === i ? 'active' : ''} ${active && beat === i && accent ? 'accent' : ''}`}
                        />
                    ))}
                </div>

                <div className="metronome-sound-selector">
                    <button
                        className={`metronome-sound-btn ${clickSound === 'soft' ? 'active' : ''}`}
                        onClick={() => onClickSoundChange('soft')}
                    >Soft</button>
                    <button
                        className={`metronome-sound-btn ${clickSound === 'hard' ? 'active' : ''}`}
                        onClick={() => onClickSoundChange('hard')}
                    >Hard</button>
                </div>

                <div className="time-sig-selector">
                    {[3, 4, 6].map(ts => (
                        <button
                            key={ts}
                            className={`time-sig-btn ${timeSignature === ts ? 'active' : ''}`}
                            onClick={() => onTimeSignatureChange(ts)}
                        >
                            {ts === 6 ? '6/8' : `${ts}/4`}
                        </button>
                    ))}
                </div>

                <input
                    type="range"
                    className="metronome-volume"
                    min={0}
                    max={100}
                    value={volume}
                    onChange={(e) => onVolumeChange(Number(e.target.value))}
                    title={`Volume: ${volume}%`}
                />
            </div>
        </div>
    );
};
