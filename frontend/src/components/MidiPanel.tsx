// Panel MIDI: grabar a .mid y salida en vivo a una DAW. En prueba: solo se
// muestra con ?midi=1 en la URL, para no cambiar la pantalla aprobada hasta
// que el cliente defina donde va.
import { useEffect, useId, useRef, useState } from 'react';
import { MidiLiveOutput, MidiRecorder, midiBus, webMidiSupported, writeMidiFile } from '../api/midi';
import type { MidiPort } from '../api/midi';
import './MidiPanel.css';

const fileName = () => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `fivo-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.mid`;
};

const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Desplegable propio (el nativo no respeta el estilo de Fivo). Teclado:
// flechas, Enter/Espacio para elegir, Escape para cerrar.
const PortSelect: React.FC<{ ports: MidiPort[]; value: string; onChange: (id: string) => void }> = ({ ports, value, onChange }) => {
    const [open, setOpen] = useState(false);
    const [focus, setFocus] = useState(0);
    const root = useRef<HTMLDivElement>(null);
    const listId = useId();
    const options = [{ id: '', name: 'Sin salida' }, ...ports];
    const current = options.find(o => o.id === value) ?? options[0];

    useEffect(() => {
        if (!open) return;
        const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
        window.addEventListener('pointerdown', close, true);
        return () => window.removeEventListener('pointerdown', close, true);
    }, [open]);

    const pick = (id: string) => {
        onChange(id);
        setOpen(false);
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        // Las letras de Fivo (Z..M) tocan acordes: el selector no las deja pasar.
        e.stopPropagation();
        if (!open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
            e.preventDefault();
            setFocus(Math.max(0, options.findIndex(o => o.id === value)));
            setOpen(true);
        } else if (open && e.key === 'ArrowDown') {
            e.preventDefault();
            setFocus(f => Math.min(options.length - 1, f + 1));
        } else if (open && e.key === 'ArrowUp') {
            e.preventDefault();
            setFocus(f => Math.max(0, f - 1));
        } else if (open && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            pick(options[focus].id);
        } else if (e.key === 'Escape') {
            setOpen(false);
        }
    };

    return (
        <div className="midi-select" ref={root} onKeyDown={onKeyDown} onKeyUp={e => e.stopPropagation()}>
            <button
                type="button"
                className={`midi-select-button ${open ? 'open' : ''}`}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={listId}
                onClick={() => { setFocus(Math.max(0, options.findIndex(o => o.id === value))); setOpen(o => !o); }}
            >
                <span className={`midi-select-value ${value ? '' : 'empty'}`}>{current.name}</span>
                <svg className="midi-select-chevron" viewBox="0 0 12 8" aria-hidden="true">
                    <path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>
            {open && (
                <ul className="midi-select-list" role="listbox" id={listId} aria-activedescendant={`${listId}-${focus}`}>
                    {options.map((o, i) => (
                        <li
                            key={o.id || 'none'}
                            id={`${listId}-${i}`}
                            role="option"
                            aria-selected={o.id === value}
                            className={`midi-select-option ${o.id === value ? 'selected' : ''} ${i === focus ? 'focus' : ''} ${o.id ? '' : 'empty'}`}
                            onPointerEnter={() => setFocus(i)}
                            onClick={() => pick(o.id)}
                        >
                            <span className="midi-select-rail" aria-hidden="true" />
                            {o.name}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

interface MidiPanelProps {
    bpm: number;
}

export const MidiPanel: React.FC<MidiPanelProps> = ({ bpm }) => {
    const recorder = useRef(new MidiRecorder(midiBus));
    const live = useRef(new MidiLiveOutput(midiBus));
    const [open, setOpen] = useState(false);
    const [recording, setRecording] = useState(false);
    const [startedAt, setStartedAt] = useState(0);
    const [now, setNow] = useState(0);
    const [take, setTake] = useState<{ url: string; name: string; notes: number; file: File } | null>(null);
    const [emptyTake, setEmptyTake] = useState(false);
    const [ports, setPorts] = useState<MidiPort[] | null>(null);
    const [portId, setPortId] = useState('');
    const [liveError, setLiveError] = useState('');
    const supported = webMidiSupported();

    useEffect(() => {
        if (!recording) return;
        const id = window.setInterval(() => setNow(performance.now()), 250);
        return () => window.clearInterval(id);
    }, [recording]);

    useEffect(() => {
        const out = live.current;
        const rec = recorder.current;
        // Al recargar o cerrar la pestana React no desmonta nada: sin esto la
        // DAW queda con las notas que estaban sonando.
        const silence = () => out.allNotesOff();
        window.addEventListener('pagehide', silence);
        return () => {
            window.removeEventListener('pagehide', silence);
            out.allNotesOff();
            out.select(null);
            rec.stop();
        };
    }, []);

    useEffect(() => () => { if (take) URL.revokeObjectURL(take.url); }, [take]);

    const toggleRecording = () => {
        if (!recording) {
            // La toma anterior sigue disponible hasta que haya una nueva.
            recorder.current.start();
            setEmptyTake(false);
            setStartedAt(performance.now());
            setNow(performance.now());
            setRecording(true);
            return;
        }
        const events = recorder.current.stop();
        setRecording(false);
        const notes = events.filter(e => e.type === 'on').length;
        if (notes === 0) {
            setEmptyTake(true);
            return;
        }
        const name = fileName();
        const file = new File([writeMidiFile(events, bpm).slice().buffer], name, { type: 'audio/midi' });
        setTake({ url: URL.createObjectURL(file), name, notes, file });
    };

    // iPhone/iPad: el menu de compartir manda el archivo a GarageBand, Archivos
    // o AirDrop, y funciona tambien en la app agregada a la pantalla de inicio,
    // donde la descarga directa puede no hacer nada.
    const canShare = Boolean(take && typeof navigator.canShare === 'function' && navigator.canShare({ files: [take.file] }));
    const shareTake = async () => {
        if (!take) return;
        try {
            await navigator.share({ files: [take.file], title: take.name });
        } catch {
            // Cancelado por el usuario: no hay nada que hacer.
        }
    };

    const connectLive = async () => {
        setLiveError('');
        try {
            live.current.onPortsChange = (next) => {
                setPorts(next);
                // Si se desconecta el puerto elegido, se deja de mandar.
                setPortId(current => {
                    if (current && !next.some(p => p.id === current)) {
                        live.current.select(null);
                        return '';
                    }
                    return current;
                });
            };
            live.current.onSendError = () => {
                setLiveError('La salida MIDI dejó de responder. Elegila de nuevo o reconectá el dispositivo.');
                setPortId('');
            };
            setPorts(await live.current.connect());
        } catch (error) {
            const name = error instanceof Error ? error.name : '';
            setLiveError(name === 'NotAllowedError' || name === 'SecurityError'
                ? 'El navegador bloqueó el MIDI. Tocá el candado de la barra de direcciones, permití "Dispositivos MIDI" y recargá.'
                : error instanceof Error ? error.message : 'No se pudo abrir MIDI');
        }
    };

    const choosePort = (id: string) => {
        setLiveError('');
        setPortId(id);
        live.current.select(id || null);
    };

    return (
        <div className={`midi-panel ${open ? 'open' : ''}`}>
            <button type="button" className="midi-panel-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
                <span className={`midi-dot ${recording ? 'rec' : portId ? 'live' : ''}`} />
                MIDI
            </button>

            {open && (
                <div className="midi-panel-body">
                    <div className="midi-section">
                        <span className="midi-label">Grabar a archivo</span>
                        <div className="midi-row">
                            <button type="button" className={`midi-btn ${recording ? 'rec' : ''}`} onClick={toggleRecording}>
                                {recording ? '■ Parar' : '● Grabar'}
                            </button>
                            {recording && <span className="midi-value">{formatTime(now - startedAt)}</span>}
                        </div>
                        {take && (
                            <div className="midi-row">
                                <a className="midi-btn midi-download" href={take.url} download={take.name}>
                                    Descargar .mid
                                </a>
                                {canShare && <button type="button" className="midi-btn" onClick={shareTake}>Compartir</button>}
                            </div>
                        )}
                        {emptyTake && <span className="midi-hint">No se grabó ninguna nota.</span>}
                        <span className="midi-hint">
                            {take ? `${take.notes} notas · ` : ''}Tempo del archivo: {bpm} bpm (el del arpegiador).
                        </span>
                    </div>

                    <div className="midi-section">
                        <span className="midi-label">Salida en vivo</span>
                        {!supported && (
                            <span className="midi-hint">
                                Este navegador no tiene MIDI en vivo (Safari no lo soporta). Usá Chrome o Edge en la compu, o grabá y descargá el archivo.
                            </span>
                        )}
                        {supported && ports === null && (
                            <button type="button" className="midi-btn" onClick={connectLive}>Conectar MIDI</button>
                        )}
                        {supported && ports !== null && (
                            <PortSelect ports={ports} value={portId} onChange={choosePort} />
                        )}
                        {supported && ports !== null && ports.length === 0 && (
                            <span className="midi-hint">No hay salidas MIDI. En Mac: Configuración de Audio MIDI → Estudio MIDI → IAC Driver → "Dispositivo en línea".</span>
                        )}
                        {liveError && <span className="midi-hint midi-error">{liveError}</span>}
                    </div>
                </div>
            )}
        </div>
    );
};
