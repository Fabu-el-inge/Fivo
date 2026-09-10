import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import { CircleOfFifths } from './components/CircleOfFifths';
import { ToolsLeft, StyleSelector, InstrumentSelector, OctaveControl, KeySelector, RotaryKnob, RecLoopHold, Arpeggiator, ArpTempoControl, Metronome } from './components/ControlPanel';
import type { MetronomeClickSound } from './components/ControlPanel';
import { ResultPanel } from './components/ResultPanel';
import { fetchChord, fetchContext, prefetchChords } from './api/fivo';
import type { FivoResponse, FivoContextResponse, FivoStyle, PowerMode } from './api/fivo';
import { calcChordNotes } from './api/chordCalc';
import { audioEngine } from './api/audio';
import type { InstrumentName } from './api/audio';
import { LITE_MODE } from './config';

const MAJOR_NOTES = ['C', 'G', 'D', 'A', 'E', 'B', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
const MINOR_NOTES = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm'];

// Panel order: naturals first, then accidentals
const MAJOR_PANEL = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'Db', 'Eb', 'Gb', 'Ab', 'Bb'];
const MINOR_PANEL = ['Cm', 'Dm', 'Em', 'Fm', 'Gm', 'Am', 'Bm', 'C#m', 'Ebm', 'F#m', 'G#m', 'Bbm'];
const ALL_NOTES = [...MAJOR_NOTES, ...MINOR_NOTES];
const KEYBOARD_MAP: Record<string, { note: string; isMinor: boolean }> = {
  KeyZ: { note: 'C', isMinor: false },
  KeyS: { note: 'Db', isMinor: false },
  KeyX: { note: 'D', isMinor: false },
  KeyD: { note: 'Eb', isMinor: false },
  KeyC: { note: 'E', isMinor: false },
  KeyV: { note: 'F', isMinor: false },
  KeyG: { note: 'Gb', isMinor: false },
  KeyB: { note: 'G', isMinor: false },
  KeyH: { note: 'Ab', isMinor: false },
  KeyN: { note: 'A', isMinor: false },
  KeyJ: { note: 'Bb', isMinor: false },
  KeyM: { note: 'B', isMinor: false },
};

// Convert minor chord name to root note for API
const getMinorRoot = (minorNote: string): string => {
  return minorNote.replace('m', '');
};

type FullscreenRoot = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

function isMobileAudioActivationTarget() {
  // El gate "Activar audio" tapaba la pantalla en mobile. Existia porque el
  // AudioContext no se despertaba solo; eso ahora se arregla en la raiz (se crea
  // uno nuevo dentro del gesto), asi que el audio entra con el primer toque y el
  // gate no hace falta en ninguna plataforma.
  return false;
}

function FivoWorkspace() {
  const [currentKey, setCurrentKey] = useState('C');
  const [pressedRoot, setPressedRoot] = useState<string | null>(null);
  const [pressedRoots, setPressedRoots] = useState<Set<string>>(new Set());
  const activeTouches = useRef<Map<string, { note: string; isMinor: boolean }>>(new Map());
  const lastGlideTimes = useRef<Map<string, number>>(new Map());
  const [, setIsMinorPressed] = useState(false);
  const [octave, setOctave] = useState(3);
  const [inversion, setInversion] = useState(0);
  const [strumEnabled, setStrumEnabled] = useState(false);
  const [style, setStyle] = useState<FivoStyle>('pop');
  const [powerMode, setPowerMode] = useState<PowerMode>('auto');
  // Fingers per note (default 1 for all)
  const [fingersPerNote, setFingersPerNote] = useState<Record<string, number>>({});
  // Inversion per note (default 0 = Root for all)
  const [inversionPerNote, setInversionPerNote] = useState<Record<string, number>>({});
  // Chord Mode - play 2-finger dyad instead of single note
  // LITE: arranca ON; FULL: arranca OFF
  const [chordMode, setChordMode] = useState(LITE_MODE);
  // Auto Voicing - automatically choose best inversion for smooth voice leading
  // LITE: siempre ON, sin toggle visible; FULL: toggle visible, arranca OFF
  const [autoVoicing, setAutoVoicing] = useState(LITE_MODE);
  const lastPlayedNotes = useRef<number[]>([]); // Track last chord notes for auto voicing
  const lastPlayedRootRef = useRef<{ note: string; isMinor: boolean } | null>(null);
  const [showFingersPanel, setShowFingersPanel] = useState(false);
  const [fingersPanelPos, setFingersPanelPos] = useState<{ x: number; y: number } | null>(null);
  const [fingersPanelSize, setFingersPanelSize] = useState<{ w: number; h: number }>({ w: 420, h: 500 });
  const [isDraggingPanel, setIsDraggingPanel] = useState(false);
  // Track which modal is on top (last clicked/opened)
  const [activeModal, setActiveModal] = useState<'fingers' | 'loopbank' | null>(null);
  const [isResizing, setIsResizing] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0, px: 0, py: 0 });

  // Sound State
  const [attackOn, setAttackOn] = useState(false);
  const [releaseOn, setReleaseOn] = useState(false);
  const [colorOn, setColorOn] = useState(false);
  const [expressionOn, setExpressionOn] = useState(false);
  const [strumSpeed, setStrumSpeed] = useState(80);
  // Un nivel compartido para todos los efectos (0-100)
  const [effectLevel, setEffectLevel] = useState(50);
  const [instrument, setInstrument] = useState<InstrumentName>('EP2');

  // Metronome State
  const [metronomeActive, setMetronomeActive] = useState(false);
  const [metronomeVolume, setMetronomeVolume] = useState(70);
  const [metronomeMuted, setMetronomeMuted] = useState(false);
  const [timeSignature, setTimeSignature] = useState(4);
  const [metronomeBeat, setMetronomeBeat] = useState<number>(-1);
  const [metronomeAccent, setMetronomeAccent] = useState(false);
  const [metronomeClickSound, setMetronomeClickSound] = useState<MetronomeClickSound>('soft');

  // Arpeggiator State
  const [arpPattern, setArpPattern] = useState(0); // 0 = off, 1-5 = patterns
  const [arpTempo, setArpTempo] = useState(120); // BPM
  const [arpSwing, setArpSwing] = useState(0); // 0-100%
  const arpTempoRef = useRef(120);
  const arpSwingRef = useRef(0);
  const arpPatternRef = useRef(0);
  const arpBaseNotesRef = useRef<number[]>([]);
  const arpIntervalRef = useRef<number | null>(null);
  const savedFingersRef = useRef<Record<string, number> | null>(null);
  const lastGlideTime = useRef<number>(0); // Throttle glide events (monophonic fallback)
  const arpStartTime = useRef<number>(0);
  const arpClockOrigin = useRef<number>(performance.now());
  const pendingGlide = useRef<{ note: string; isMinor: boolean; arpNotes?: number[][]; baseNotes?: number[]; chordData?: FivoResponse } | null>(null);
  const currentPressedRef = useRef<string | null>(null); // Track current pressed note (avoid state timing issues)
  const strumInversionRef = useRef<Record<string, number>>({}); // Inversion cycle per note for strum
  const keyboardHeldKeys = useRef<Set<string>>(new Set());
  const [audioActivationRequired, setAudioActivationRequired] = useState(() => isMobileAudioActivationTarget());
  const [audioActivationState, setAudioActivationState] = useState<'idle' | 'loading' | 'error'>('idle');
  const audioActivationStartedRef = useRef(false);

  // Hold State - keeps chord/arp playing after release
  const [isHold, setIsHold] = useState(false);
  const isHoldRef = useRef(false);

  const updateHold = useCallback((hold: boolean) => {
    isHoldRef.current = hold;
    audioEngine.setHoldMode(hold);
    setIsHold(hold);
  }, []);

  useEffect(() => {
    let unlocked = false;
    const unlockAudio = () => {
      if (unlocked) return;
      unlocked = true;
      audioEngine.primeUserGesture();
      void audioEngine.unlock().catch(error => {
        console.error('Audio unlock failed', error);
      });
    };

    const addOptions: AddEventListenerOptions = { capture: true, once: true };
    const removeOptions: EventListenerOptions = { capture: true };
    window.addEventListener('pointerdown', unlockAudio, addOptions);
    window.addEventListener('touchstart', unlockAudio, addOptions);
    window.addEventListener('keydown', unlockAudio, addOptions);

    return () => {
      window.removeEventListener('pointerdown', unlockAudio, removeOptions);
      window.removeEventListener('touchstart', unlockAudio, removeOptions);
      window.removeEventListener('keydown', unlockAudio, removeOptions);
    };
  }, []);

  useEffect(() => {
    const updateAudioGate = () => {
      if (!audioActivationStartedRef.current) {
        setAudioActivationRequired(isMobileAudioActivationTarget());
      }
    };

    updateAudioGate();
    window.addEventListener('resize', updateAudioGate);
    window.addEventListener('orientationchange', updateAudioGate);

    return () => {
      window.removeEventListener('resize', updateAudioGate);
      window.removeEventListener('orientationchange', updateAudioGate);
    };
  }, []);

  const handleMobileAudioActivation = useCallback((event: { preventDefault: () => void; stopPropagation: () => void }) => {
    event.preventDefault();
    event.stopPropagation();
    if (audioActivationStartedRef.current) return;

    audioActivationStartedRef.current = true;
    setAudioActivationState('loading');
    audioEngine.primeUserGesture();

    void audioEngine.prepareForPlayback()
      .then(() => {
        setAudioActivationRequired(false);
        setAudioActivationState('idle');
      })
      .catch(error => {
        console.error('Mobile audio activation failed', error);
        audioActivationStartedRef.current = false;
        setAudioActivationState('error');
      });
  }, []);

  useEffect(() => {
    const shouldPreloadSurge =
      window.matchMedia?.('(pointer: coarse)').matches ||
      window.innerWidth <= 1024;
    if (!shouldPreloadSurge) return;

    const controller = new AbortController();
    audioEngine.preloadMobileAssets(controller.signal);

    return () => controller.abort();
  }, []);

  const toggleHold = useCallback(() => {
    const nextHold = !isHoldRef.current;
    updateHold(nextHold);
    if (!nextHold) {
      audioEngine.releaseAll();
    }
  }, [updateHold]);

  const getNextArpGridDelay = (): number => {
    const eighthMs = 30000 / arpTempoRef.current;
    const elapsed = performance.now() - arpClockOrigin.current;
    const remainder = ((elapsed % eighthMs) + eighthMs) % eighthMs;

    // Never fire late inside a step; advance to the next eighth-note boundary.
    return remainder < 4 ? 0 : eighthMs - remainder;
  };

  // Arpeggio patterns
  // LITE: modos direccionales — 1=Up, 2=Down, 3=Up-Down, 4=Down-Up, 5=Random
  // FULL: voicing patterns — densidad creciente, voicings musicalmente sanos
  const getArpPattern = (pattern: number, notes: number[]): number[][] => {
    if (notes.length < 2) return notes.map(n => [n]);
    const R  = notes[0];                  // root
    const T  = notes[1] || R;             // third
    const F  = notes[2] || T;             // fifth
    const O  = R + 12;                    // root octave up
    const F2 = F + 12;                    // fifth octave up

    if (LITE_MODE) {
      const up = [...notes].sort((a, b) => a - b);
      switch (pattern) {
        case 1: return up.map(n => [n]);                                    // Up: C E G
        case 2: return [...up].reverse().map(n => [n]);                     // Down: G E C
        case 3: return [...up, ...up.slice(1, -1).reverse()].map(n => [n]); // Up-Down: C E G E
        case 4: {                                                            // Down-Up: G E C E
          const dn = [...up].reverse();
          return [...dn, ...dn.slice(1, -1).reverse()].map(n => [n]);
        }
        case 5: return [...up].sort(() => Math.random() - 0.5).map(n => [n]);
        default: return notes.map(n => [n]);
      }
    }

    // FULL: voicing patterns originales
    switch (pattern) {
      // 1: cascada clásica — sube y baja
      case 1: return [[R], [F], [O], [T]];
      // 2: alberti — root salta al oct, rellena con tercera y quinta
      case 2: return [[R], [T], [F], [O]];
      // 3: octava doble en tiempos fuertes
      case 3: return [[R, O], [T], [F, O], [T]];
      // 4: power dyads — quinta + octava juntas
      case 4: return [[R, F], [T, O], [F, O], [R, T]];
      // 5: spread triad abierto — grande pero limpio
      case 5: return [[R, F, O], [T, O], [R, F2], [T, F, O]];
      default: return notes.map(n => [n]);
    }
  };

  const getArpFingers = (): number => instrument === 'E-Bass' ? 1 : 3;

  // Handle arpeggiator pattern change - save/restore fingers
  const handleArpPatternChange = (newPattern: number) => {
    arpPatternRef.current = newPattern;
    const wasOff = arpPattern === 0;
    const willBeOff = newPattern === 0;

    if (wasOff && !willBeOff) {
      savedFingersRef.current = { ...fingersPerNote };
      const allNotesFingers: Record<string, number> = {};
      ALL_NOTES.forEach(note => { allNotesFingers[note] = 3; });
      setFingersPerNote(allNotesFingers);

      if (isHold && pressedRoot && lastPlayedRootRef.current) {
        const heldRoot = lastPlayedRootRef.current;
        const apiRoot = heldRoot.isMinor ? getMinorRoot(heldRoot.note) : heldRoot.note;
        const noteFingers = getArpFingers();
        const useVoiceLeading = autoVoicing && instrument !== 'E-Bass';
        const noteInversion = useVoiceLeading ? 0 : getInversionForNote(heldRoot.note);
        const baseNotes = calcChordNotes(currentKey, apiRoot, heldRoot.isMinor, style, noteInversion, noteFingers, 'off', contextData?.map)
          .map(n => n + (octave - 3) * 12);
        const adjustedNotes = useVoiceLeading && lastPlayedNotes.current.length > 0
          ? voiceLeadNotes(baseNotes, lastPlayedNotes.current)
          : baseNotes;

        lastPlayedNotes.current = adjustedNotes;
        arpBaseNotesRef.current = adjustedNotes;
        audioEngine.releaseAll();

        let noteIndex = 0;
        let timingIndex = 0;
        let currentArpNotes = getArpPattern(newPattern, adjustedNotes);
        let lastPatternUsed = newPattern;

        const getNextInterval = (timingIdx: number): number => {
          const msPerBeat = 60000 / arpTempoRef.current;
          const eighth = msPerBeat / 2;
          const sf = arpSwingRef.current / 300; // 0 → 0.333 (triplet swing)
          const pattern = [eighth * (1 + sf), eighth * (1 - sf), eighth * (1 + sf), eighth * (1 - sf)];
          return pattern[timingIdx % pattern.length];
        };

        const playNextNote = () => {
          if (arpPatternRef.current === 0) {
            audioEngine.attackNotes(arpBaseNotesRef.current);
            return;
          }
          if (arpPatternRef.current !== lastPatternUsed) {
            lastPatternUsed = arpPatternRef.current;
            currentArpNotes = getArpPattern(arpPatternRef.current, arpBaseNotesRef.current);
            noteIndex = 0;
          }
          if (noteIndex >= currentArpNotes.length) noteIndex = 0;
          const iv = getNextInterval(timingIndex);
          timingIndex++;
          audioEngine.arpAttackNotes(currentArpNotes[noteIndex], iv);
          noteIndex++;
          arpIntervalRef.current = window.setTimeout(playNextNote, iv);
        };

        const startOnGrid = () => {
          const firstIv = getNextInterval(timingIndex);
          timingIndex++;
          audioEngine.arpAttackNotes(currentArpNotes[noteIndex], firstIv);
          noteIndex++;
          arpIntervalRef.current = window.setTimeout(playNextNote, firstIv);
        };

        arpIntervalRef.current = window.setTimeout(startOnGrid, getNextArpGridDelay());
        fetchChordData(currentKey, heldRoot.note, heldRoot.isMinor, noteInversion, style, 'off', noteFingers);
      }
    } else if (!wasOff && willBeOff) {
      if (savedFingersRef.current !== null) {
        setFingersPerNote(savedFingersRef.current);
        savedFingersRef.current = null;
      }
    }

    setArpPattern(newPattern);
  };

  // Update Audio Engine when settings change
  // LITE: ignora los toggles individuales y aplica todo siempre desde effectLevel.
  // FULL: cada efecto solo se aplica si su toggle está ON.
  useEffect(() => {
    audioEngine.setExpressionControls(effectLevel);
  }, [effectLevel]);

  // FULL VERSION - preserved for later reactivation:
  // useEffect(() => { audioEngine.setAttack(LITE_MODE || attackOn ? effectLevel : 0); }, [attackOn, effectLevel]);
  // useEffect(() => { audioEngine.setSustain(LITE_MODE || colorOn ? 40 + effectLevel * 0.5 : 60); }, [colorOn, effectLevel]);
  // useEffect(() => { audioEngine.setRelease(LITE_MODE || releaseOn ? effectLevel : 0); }, [releaseOn, effectLevel]);
  // useEffect(() => { if (strumEnabled) setStrumSpeed(20 + effectLevel * 1.6); }, [effectLevel, strumEnabled]);
  // useEffect(() => { audioEngine.setExpression(LITE_MODE || expressionOn ? effectLevel : 100); }, [expressionOn, effectLevel]);

  // Metronome beat callback
  useEffect(() => {
    audioEngine.setMetronomeBeatCallback((beat, isAccent) => {
      setMetronomeBeat(beat);
      setMetronomeAccent(isAccent);
    });
    return () => {
      audioEngine.setMetronomeBeatCallback(null);
    };
  }, []);

  // Metronome start/stop
  useEffect(() => {
    if (metronomeActive) {
      arpClockOrigin.current = performance.now();
      audioEngine.startMetronome(arpTempo, timeSignature);
    } else {
      audioEngine.stopMetronome();
      setMetronomeBeat(-1);
    }
    return () => {
      if (metronomeActive) {
        audioEngine.stopMetronome();
      }
    };
  }, [metronomeActive, timeSignature]);

  // Sync metronome BPM with arpTempo
  useEffect(() => {
    audioEngine.setMetronomeBpm(arpTempo);
  }, [arpTempo]);

  // Metronome volume
  useEffect(() => {
    audioEngine.setMetronomeVolume(metronomeVolume);
  }, [metronomeVolume]);

  // Metronome mute
  useEffect(() => {
    audioEngine.setMetronomeMuted(metronomeMuted);
  }, [metronomeMuted]);

  // Metronome click sound
  useEffect(() => {
    audioEngine.setMetronomeClickSound(metronomeClickSound);
  }, [metronomeClickSound]);

  // Keep arp tempo ref in sync
  useEffect(() => {
    arpTempoRef.current = arpTempo;
  }, [arpTempo]);

  // Keep arp swing ref in sync
  useEffect(() => {
    arpSwingRef.current = arpSwing;
  }, [arpSwing]);

  // Keep arp pattern ref in sync
  useEffect(() => {
    arpPatternRef.current = arpPattern;
  }, [arpPattern]);

  // Update instrument when changed
  useEffect(() => {
    lastPlayedNotes.current = [];
    audioEngine.setInstrument(instrument);
  }, [instrument]);

  // Track previous hold state to detect toggle OFF
  const prevHoldRef = useRef(isHold);
  useEffect(() => {
    isHoldRef.current = isHold;

    // Only act when hold is turned OFF (was true, now false)
    if (prevHoldRef.current && !isHold) {
      if (arpIntervalRef.current) {
        clearTimeout(arpIntervalRef.current);
        arpIntervalRef.current = null;
      }
      pendingGlide.current = null;
      currentPressedRef.current = null;
      activeTouches.current.clear();
      keyboardHeldKeys.current.clear();
      audioEngine.releaseAll();
      setPressedRoot(null);
      setPressedRoots(new Set());
    }
    prevHoldRef.current = isHold;
  }, [isHold]);

  const [chordData, setChordData] = useState<FivoResponse | null>(null);
  const [contextData, setContextData] = useState<FivoContextResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const doc = document as FullscreenDoc;
    const root = document.documentElement as FullscreenRoot;

    setFullscreenAvailable(Boolean(root.requestFullscreen || root.webkitRequestFullscreen));

    const syncFullscreen = () => {
      setIsFullscreen(Boolean(document.fullscreenElement || doc.webkitFullscreenElement));
    };

    syncFullscreen();
    document.addEventListener('fullscreenchange', syncFullscreen);
    document.addEventListener('webkitfullscreenchange', syncFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen);
      document.removeEventListener('webkitfullscreenchange', syncFullscreen);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const doc = document as FullscreenDoc;
    const root = document.documentElement as FullscreenRoot;
    const active = Boolean(document.fullscreenElement || doc.webkitFullscreenElement);

    try {
      if (active) {
        const exit = document.exitFullscreen?.bind(document) ?? doc.webkitExitFullscreen?.bind(doc);
        await exit?.();
        return;
      }

      const enter = root.requestFullscreen?.bind(root) ?? root.webkitRequestFullscreen?.bind(root);
      await enter?.();
    } catch (error) {
      console.error('Fullscreen toggle failed', error);
    }
  }, []);

  const updateContext = useCallback(async (key: string, styleParam: FivoStyle) => {
    try {
      const ctx = await fetchContext(key, styleParam);
      console.log("Context loaded:", ctx);
      setContextData(ctx);
    } catch (e: unknown) {
      console.error("Context Error", e);
    }
  }, []);

  // Fetch chord data WITHOUT playing sound
  const fetchChordData = useCallback(async (key: string, root: string, isMinor: boolean = false, inv: number = 0, styleParam: FivoStyle = 'pop', power: PowerMode = 'auto', fingersParam: number = 3) => {
    try {
      setErrorMsg('');
      const apiRoot = isMinor ? getMinorRoot(root) : root;
      // Pass isMinor to API - backend now generates correct minor chord notes
      const res = await fetchChord(key, apiRoot, inv, styleParam, isMinor, power, fingersParam);
      setChordData(res);
      return res;
    } catch (e: unknown) {
      const error = e as Error;
      console.error(error);
      setErrorMsg(error.message || 'Unknown Error');
      return null;
    }
  }, []);

  // Initial load - fetch context + pre-cargar acordes con delay para no saturar rate limit
  useEffect(() => {
    updateContext(currentKey, style);
    const t = setTimeout(() => prefetchChords(currentKey, style, powerMode), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update ONLY when style changes - NO sound, just refresh colors
  useEffect(() => {
    // Skip initial render
    if (contextData !== null) {
      updateContext(currentKey, style);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style]);

  // Key change - update context only, NO sound
  const handleKeyChange = (newKey: string) => {
    setCurrentKey(newKey);
    updateContext(newKey, style);
  };

  // Get fingers for a specific note
  // chordMode = 3 fingers (full chord), otherwise per-note setting (default 1)
  const getFingersForNote = (note: string): number => {
    if (arpPattern > 0 || arpPatternRef.current > 0) return 3;
    if (instrument === 'E-Bass') return 1;
    if (chordMode) return 3;
    return fingersPerNote[note] ?? 1;
  };

  // Set fingers for a specific note
  const handleFingersChange = (note: string, fingers: number) => {
    setFingersPerNote(prev => ({ ...prev, [note]: fingers }));
  };

  // Set ALL notes to same finger count (used by quick-fingers, currently disabled)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const setAllFingers = (fingers: number) => {
    const allFingers: Record<string, number> = {};
    ALL_NOTES.forEach(note => {
      allFingers[note] = fingers;
    });
    setFingersPerNote(allFingers);
  };

  // Get inversion for a specific note (uses global inversion as default)
  const getInversionForNote = (note: string): number => {
    return inversionPerNote[note] ?? inversion;
  };

  // Set inversion for a specific note
  const handleInversionPerNoteChange = (note: string, inv: number) => {
    setInversionPerNote(prev => ({ ...prev, [note]: inv }));
  };

  // Voice leading: cada nota se transpone a la octava más cercana al centro del acorde anterior
  const voiceLeadNotes = (baseNotes: number[], previousNotes: number[]): number[] => {
    if (previousNotes.length === 0 || baseNotes.length === 0) return baseNotes;

    const prevCenter = previousNotes.reduce((a, b) => a + b, 0) / previousNotes.length;

    const voiced = baseNotes.map(note => {
      const pc = ((note % 12) + 12) % 12; // pitch class 0-11
      let best = note;
      let minDist = Infinity;
      // Buscar en todas las octavas razonables (MIDI 36-96)
      for (let oct = 2; oct <= 8; oct++) {
        const candidate = oct * 12 + pc;
        if (candidate < 36 || candidate > 96) continue;
        const dist = Math.abs(candidate - prevCenter);
        if (dist < minDist) {
          minDist = dist;
          best = candidate;
        }
      }
      return best;
    });

    return voiced.sort((a, b) => a - b);
  };

  // Drag handlers for fingers panel
  const handlePanelDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDraggingPanel(true);
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    if (fingersPanelPos) {
      dragOffset.current = { x: clientX - fingersPanelPos.x, y: clientY - fingersPanelPos.y };
    } else {
      // First drag - panel is centered, calculate from center
      dragOffset.current = { x: 0, y: 0 };
      setFingersPanelPos({ x: clientX, y: clientY });
    }
  };

  useEffect(() => {
    if (!isDraggingPanel) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

      // Calculate new position
      let newX = clientX - dragOffset.current.x;
      let newY = clientY - dragOffset.current.y;

      // Bounds checking - keep header visible
      const minY = 0; // At least at top of screen
      const maxY = window.innerHeight - 50; // At least 50px visible
      const minX = -fingersPanelSize.w + 100; // At least 100px visible from right
      const maxX = window.innerWidth - 100; // At least 100px visible from left

      newX = Math.max(minX, Math.min(maxX, newX));
      newY = Math.max(minY, Math.min(maxY, newY));

      setFingersPanelPos({ x: newX, y: newY });
    };

    const handleUp = () => {
      setIsDraggingPanel(false);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMove);
    window.addEventListener('touchend', handleUp);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
    };
  }, [isDraggingPanel, fingersPanelSize.w]);

  // Reset position if panel is out of bounds when opened
  useEffect(() => {
    if (showFingersPanel && fingersPanelPos) {
      const maxY = window.innerHeight - 50;
      const maxX = window.innerWidth - 100;
      const minX = -fingersPanelSize.w + 100;

      // Check if position is out of bounds
      if (fingersPanelPos.y < 0 || fingersPanelPos.y > maxY ||
          fingersPanelPos.x < minX || fingersPanelPos.x > maxX) {
        // Reset to center
        setFingersPanelPos(null);
      }
    }
  }, [showFingersPanel]);

  // Resize handlers for fingers panel
  const handleResizeStart = (direction: string) => (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    setIsResizing(direction);
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    resizeStart.current = {
      x: clientX,
      y: clientY,
      w: fingersPanelSize.w,
      h: fingersPanelSize.h,
      px: fingersPanelPos?.x ?? window.innerWidth - fingersPanelSize.w,
      py: fingersPanelPos?.y ?? window.innerHeight / 2 - fingersPanelSize.h / 2
    };
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      const dx = clientX - resizeStart.current.x;
      const dy = clientY - resizeStart.current.y;

      let newW = resizeStart.current.w;
      let newH = resizeStart.current.h;
      let newX = resizeStart.current.px;
      let newY = resizeStart.current.py;

      if (isResizing.includes('e')) newW = Math.max(150, resizeStart.current.w + dx);
      if (isResizing.includes('w')) {
        newW = Math.max(150, resizeStart.current.w - dx);
        newX = resizeStart.current.px + dx;
      }
      if (isResizing.includes('s')) newH = Math.max(100, resizeStart.current.h + dy);
      if (isResizing.includes('n')) {
        newH = Math.max(100, resizeStart.current.h - dy);
        newY = resizeStart.current.py + dy;
      }

      setFingersPanelSize({ w: newW, h: newH });
      setFingersPanelPos({ x: newX, y: newY });
    };

    const handleUp = () => setIsResizing(null);

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMove);
    window.addEventListener('touchend', handleUp);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
    };
  }, [isResizing]);

  // User presses on a chord - START sound (síncrono: notas calculadas localmente)
  const handleRootPress = (note: string, isMinor: boolean, touchId: string = 'mouse') => {
    audioEngine.primeUserGesture();
    void audioEngine.unlock().catch(error => {
      console.error('Audio unlock failed', error);
    });
    lastPlayedRootRef.current = { note, isMinor };
    const apiRoot = isMinor ? getMinorRoot(note) : note;

    if (arpPattern > 0 && arpIntervalRef.current && (currentPressedRef.current === note || pressedRoot === note)) {
      clearTimeout(arpIntervalRef.current);
      arpIntervalRef.current = null;
      pendingGlide.current = null;
      currentPressedRef.current = null;
      activeTouches.current.clear();
      keyboardHeldKeys.current.clear();
      audioEngine.releaseHeldNotes();
      setPressedRoot(null);
      setPressedRoots(new Set());
      setIsMinorPressed(false);
      return;
    }

    if (isHoldRef.current && arpPattern === 0 && (currentPressedRef.current === note || pressedRoot === note)) {
      pendingGlide.current = null;
      currentPressedRef.current = null;
      activeTouches.current.clear();
      keyboardHeldKeys.current.clear();
      audioEngine.releaseHeldNotes();
      setPressedRoot(null);
      setPressedRoots(new Set());
      setIsMinorPressed(false);
      return;
    }

    // MONOPHONIC mode: hold ON or arp ON
    if (isHoldRef.current || arpPattern > 0) {
      // If Hold is ON and arpeggiator is already running, queue the change (quantized)
      if (isHoldRef.current && arpPattern > 0 && arpIntervalRef.current) {
        setPressedRoot(note);
        setPressedRoots(new Set([note]));
        setIsMinorPressed(isMinor);
        currentPressedRef.current = note;

        const noteFingers = getFingersForNote(note);
        const noteInversion = getInversionForNote(note);
        const adjustedNotes = calcChordNotes(currentKey, apiRoot, isMinor, style, noteInversion, noteFingers, 'off', contextData?.map)
          .map(n => n + (octave - 3) * 12);
        const newArpNotes = getArpPattern(arpPattern, adjustedNotes);
        pendingGlide.current = { note, isMinor, arpNotes: newArpNotes, baseNotes: adjustedNotes };
        fetchChordData(currentKey, note, isMinor, noteInversion, style, 'off', noteFingers);
        return;
      }

      // Stop any currently playing arpeggiator/notes before starting new one
      if (arpIntervalRef.current) {
        clearTimeout(arpIntervalRef.current);
        arpIntervalRef.current = null;
      }
      pendingGlide.current = null;
      activeTouches.current.clear();
      if (arpPattern > 0) {
        audioEngine.panic();
      }

      setPressedRoot(note);
      setPressedRoots(new Set([note]));
      setIsMinorPressed(isMinor);
      currentPressedRef.current = note;
      const noteFingers = getFingersForNote(note);
      const playbackPowerMode = arpPattern > 0 ? 'off' : powerMode;
      const useVoiceLeading = autoVoicing && instrument !== 'E-Bass';

      const noteInversion = useVoiceLeading ? 0 : getInversionForNote(note);
      const baseNotes = calcChordNotes(currentKey, apiRoot, isMinor, style, noteInversion, noteFingers, playbackPowerMode, contextData?.map)
        .map(n => n + (octave - 3) * 12);
      const adjustedNotes = useVoiceLeading && lastPlayedNotes.current.length > 0
        ? voiceLeadNotes(baseNotes, lastPlayedNotes.current)
        : baseNotes;

      lastPlayedNotes.current = adjustedNotes;
      fetchChordData(currentKey, note, isMinor, noteInversion, style, playbackPowerMode, noteFingers);

      if (arpPattern > 0) {
        arpBaseNotesRef.current = adjustedNotes;
        let arpNotes = getArpPattern(arpPattern, adjustedNotes);

        const getNextInterval = (timingIdx: number): number => {
          const msPerBeat = 60000 / arpTempoRef.current;
          const eighth = msPerBeat / 2;
          const sf = arpSwingRef.current / 300; // 0 → 0.333 (triplet swing)
          const pattern = [eighth * (1 + sf), eighth * (1 - sf), eighth * (1 + sf), eighth * (1 - sf)];
          return pattern[timingIdx % pattern.length];
        };

        let noteIndex = 0;
        let timingIndex = 0;
        let lastPatternUsed = arpPattern;

        const playNextNote = () => {
          if (arpPatternRef.current !== lastPatternUsed) {
            if (arpPatternRef.current === 0) {
              audioEngine.attackNotes(arpBaseNotesRef.current);
              return;
            }
            lastPatternUsed = arpPatternRef.current;
            arpNotes = getArpPattern(arpPatternRef.current, arpBaseNotesRef.current);
            noteIndex = 0;
          }

          if (noteIndex >= arpNotes.length) {
            noteIndex = 0;
            if (pendingGlide.current) {
              const pending = pendingGlide.current;
              pendingGlide.current = null;
              if (pending.arpNotes && (pending.baseNotes || pending.chordData)) {
                arpBaseNotesRef.current = pending.baseNotes ?? pending.chordData!.notes.map(n => n + (octave - 3) * 12);
                arpNotes = pending.arpNotes;
                setPressedRoot(pending.note);
                setPressedRoots(new Set([pending.note]));
                setIsMinorPressed(pending.isMinor);
                if (pending.chordData) setChordData(pending.chordData);
              }
            }
          }

          const interval = getNextInterval(timingIndex);
          timingIndex++;
          audioEngine.arpAttackNotes(arpNotes[noteIndex], interval);
          noteIndex++;
          arpIntervalRef.current = window.setTimeout(playNextNote, interval);
        };

        const startDelay = getNextArpGridDelay();
        arpStartTime.current = performance.now() + startDelay;
        const startOnGrid = () => {
          const firstInterval = getNextInterval(timingIndex);
          timingIndex++;
          audioEngine.arpAttackNotes(arpNotes[noteIndex], firstInterval);
          noteIndex++;
          arpIntervalRef.current = window.setTimeout(playNextNote, firstInterval);
        };

        arpIntervalRef.current = window.setTimeout(startOnGrid, startDelay);
      } else if (strumEnabled) {
        audioEngine.attackNotesStrum(adjustedNotes, strumSpeed);
      } else {
        audioEngine.attackNotes(adjustedNotes);
      }
      return;
    }

    // POLYPHONIC mode: no hold, no arp — each touch sounds independently
    activeTouches.current.set(touchId, { note, isMinor });
    setPressedRoots(prev => new Set([...prev, note]));
    setPressedRoot(note);
    setIsMinorPressed(isMinor);
    currentPressedRef.current = note;
    const noteFingers = getFingersForNote(note);

    // Strum: cicla inversión cada vez que se presiona la misma nota
    let noteInversion: number;
    if (strumEnabled) {
      const prev = strumInversionRef.current[note] ?? 0;
      noteInversion = prev;
      strumInversionRef.current[note] = (prev + 1) % 3;
    } else {
      noteInversion = autoVoicing && instrument !== 'E-Bass' ? 0 : getInversionForNote(note);
    }

    const baseNotes = calcChordNotes(currentKey, apiRoot, isMinor, style, noteInversion, noteFingers, powerMode, contextData?.map)
      .map(n => n + (octave - 3) * 12);
    const adjustedNotes = (!strumEnabled && autoVoicing && instrument !== 'E-Bass' && lastPlayedNotes.current.length > 0)
      ? voiceLeadNotes(baseNotes, lastPlayedNotes.current)
      : baseNotes;

    lastPlayedNotes.current = adjustedNotes;
    fetchChordData(currentKey, note, isMinor, noteInversion, style, powerMode, noteFingers);

    if (strumEnabled) {
      audioEngine.attackNotesStrumForTouch(adjustedNotes, strumSpeed, touchId);
    } else {
      audioEngine.attackNotesForTouch(adjustedNotes, touchId);
    }
  };

  // User releases chord - STOP sound (unless hold is ON)
  const handleRootRelease = (touchId: string = 'mouse') => {
    if (isHoldRef.current) return;

    // MONOPHONIC mode (arp active): release all
    if (arpPattern > 0 && arpIntervalRef.current) {
      clearTimeout(arpIntervalRef.current);
      arpIntervalRef.current = null;
      pendingGlide.current = null;
      currentPressedRef.current = null;
      activeTouches.current.clear();
      audioEngine.releaseAll();
      setPressedRoot(null);
      setPressedRoots(new Set());
      return;
    }

    // POLYPHONIC mode: release only this touch
    const touch = activeTouches.current.get(touchId);
    if (touch) {
      activeTouches.current.delete(touchId);
      audioEngine.releaseNotesForTouch(touchId);

      // Remove from pressedRoots only if no other touch holds this note
      const stillHeld = [...activeTouches.current.values()].some(t => t.note === touch.note);
      if (!stillHeld) {
        setPressedRoots(prev => { const next = new Set(prev); next.delete(touch.note); return next; });
      }
      if (activeTouches.current.size === 0) {
        setPressedRoot(null);
        currentPressedRef.current = null;
      }
    } else {
      // Fallback: clear everything
      activeTouches.current.clear();
      currentPressedRef.current = null;
      audioEngine.releaseAll();
      setPressedRoot(null);
      setPressedRoots(new Set());
    }
  };

  // User glides to another chord while holding - smooth transition, ahora síncrono
  const handlePanic = () => {
    if (arpIntervalRef.current) { clearTimeout(arpIntervalRef.current); arpIntervalRef.current = null; }
    pendingGlide.current = null;
    currentPressedRef.current = null;
    activeTouches.current.clear();
    keyboardHeldKeys.current.clear();
    audioEngine.releaseAll();
    setPressedRoot(null);
    setPressedRoots(new Set());
  };

  const handleRootGlide = (note: string, isMinor: boolean, touchId: string = 'mouse') => {
    const existingTouch = activeTouches.current.get(touchId);
    if (existingTouch?.note === note) return;
    lastPlayedRootRef.current = { note, isMinor };

    // Throttle per touch ID
    const now = performance.now();
    const lastTime = lastGlideTimes.current.get(touchId) ?? 0;
    if (now - lastTime < 30) return;
    lastGlideTimes.current.set(touchId, now);

    setPressedRoot(note);
    setIsMinorPressed(isMinor);
    currentPressedRef.current = note;

    const apiRoot = isMinor ? getMinorRoot(note) : note;
    const noteFingers = getFingersForNote(note);
    const useVoiceLeading = autoVoicing && instrument !== 'E-Bass';
    const noteInversion = useVoiceLeading ? 0 : getInversionForNote(note);
    const playbackPowerMode = arpPattern > 0 ? 'off' : powerMode;

    // MONOPHONIC mode (arp active)
    if (arpPattern > 0) {
      const baseNotes = calcChordNotes(currentKey, apiRoot, isMinor, style, noteInversion, noteFingers, 'off', contextData?.map)
        .map(n => n + (octave - 3) * 12);
      const adjustedNotes = useVoiceLeading && lastPlayedNotes.current.length > 0
        ? voiceLeadNotes(baseNotes, lastPlayedNotes.current)
        : baseNotes;
      const newArpNotes = getArpPattern(arpPattern, adjustedNotes);
      pendingGlide.current = { note, isMinor, arpNotes: newArpNotes, baseNotes: adjustedNotes };
      setPressedRoots(new Set([note]));
      fetchChordData(currentKey, note, isMinor, noteInversion, style, 'off', noteFingers);
      return;
    }

    // POLYPHONIC mode: update this specific touch
    const oldNote = existingTouch?.note;
    activeTouches.current.set(touchId, { note, isMinor });

    setPressedRoots(prev => {
      const next = new Set(prev);
      if (oldNote) {
        const stillHeld = [...activeTouches.current.entries()]
          .filter(([id]) => id !== touchId)
          .some(([, t]) => t.note === oldNote);
        if (!stillHeld) next.delete(oldNote);
      }
      next.add(note);
      return next;
    });

    const baseNotes = calcChordNotes(currentKey, apiRoot, isMinor, style, noteInversion, noteFingers, playbackPowerMode, contextData?.map)
      .map(n => n + (octave - 3) * 12);
    const adjustedNotes = useVoiceLeading && lastPlayedNotes.current.length > 0
      ? voiceLeadNotes(baseNotes, lastPlayedNotes.current)
      : baseNotes;

    if (strumEnabled) {
      audioEngine.attackNotesStrumForTouch(adjustedNotes, strumSpeed, touchId);
    } else {
      audioEngine.attackNotesForTouch(adjustedNotes, touchId);
    }
    fetchChordData(currentKey, note, isMinor, noteInversion, style, playbackPowerMode, noteFingers);
  };

  // Global mouseup/touchend to catch releases outside the circle
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isHoldRef.current) return;
      const touch = activeTouches.current.get('mouse');
      if (touch) {
        activeTouches.current.delete('mouse');
        audioEngine.releaseNotesForTouch('mouse');
        const stillHeld = [...activeTouches.current.values()].some(t => t.note === touch.note);
        if (!stillHeld) setPressedRoots(prev => { const next = new Set(prev); next.delete(touch.note); return next; });
        if (activeTouches.current.size === 0) { setPressedRoot(null); currentPressedRef.current = null; }
      } else if (pressedRoot !== null) {
        // Fallback for monophonic/arp mode
        if (arpIntervalRef.current) { clearTimeout(arpIntervalRef.current); arpIntervalRef.current = null; }
        pendingGlide.current = null;
        currentPressedRef.current = null;
        audioEngine.releaseAll();
        setPressedRoot(null);
        setPressedRoots(new Set());
      }
    };

    const handleGlobalTouchEnd = (e: TouchEvent) => {
      if (isHoldRef.current) return;
      Array.from(e.changedTouches).forEach(touch => {
        const tid = 'touch-' + touch.identifier;
        const activeTouch = activeTouches.current.get(tid);
        if (activeTouch) {
          activeTouches.current.delete(tid);
          audioEngine.releaseNotesForTouch(tid);
          const stillHeld = [...activeTouches.current.values()].some(t => t.note === activeTouch.note);
          if (!stillHeld) setPressedRoots(prev => { const next = new Set(prev); next.delete(activeTouch.note); return next; });
          if (activeTouches.current.size === 0) { setPressedRoot(null); currentPressedRef.current = null; }
        }
      });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handlePanic();
    };

    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('touchend', handleGlobalTouchEnd);
    window.addEventListener('touchcancel', handlePanic);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handlePanic);

    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('touchend', handleGlobalTouchEnd);
      window.removeEventListener('touchcancel', handlePanic);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handlePanic);
    };
  }, [pressedRoot, isHold]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };

    const handleKeyboardDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handlePanic();
        return;
      }

      if (isEditableTarget(e.target)) return;
      const mapped = KEYBOARD_MAP[e.code];
      if (!mapped) return;
      if (keyboardHeldKeys.current.has(e.code)) return;

      keyboardHeldKeys.current.add(e.code);
      handleRootPress(mapped.note, e.shiftKey ? true : mapped.isMinor, `keyboard-${e.code}`);
      e.preventDefault();
    };

    const handleKeyboardUp = (e: KeyboardEvent) => {
      const mapped = KEYBOARD_MAP[e.code];
      if (!mapped) return;
      if (!keyboardHeldKeys.current.has(e.code)) return;

      keyboardHeldKeys.current.delete(e.code);
      handleRootRelease(`keyboard-${e.code}`);
      e.preventDefault();
    };

    window.addEventListener('keydown', handleKeyboardDown);
    window.addEventListener('keyup', handleKeyboardUp);
    return () => {
      window.removeEventListener('keydown', handleKeyboardDown);
      window.removeEventListener('keyup', handleKeyboardUp);
    };
  }, [handleRootPress, handleRootRelease, handlePanic]);

  // User changes inversion
  const handleInversionChange = (inv: number) => {
    setInversion(inv);
  };

  // Style change - NO sound (just visual update)
  const handleStyleChange = (newStyle: string) => {
    setStyle(newStyle.toLowerCase() as FivoStyle);
  };

  const handleOctaveChange = (delta: number) => {
    setOctave(prev => Math.max(1, Math.min(7, prev + delta)));
    if (lastPlayedNotes.current.length > 0) {
      lastPlayedNotes.current = lastPlayedNotes.current.map(n => n + delta * 12);
    }
  };

  return (
    <div className="app-container">
      {/* Error Banner - Fixed top */}
      {errorMsg && <div className="error-banner">{errorMsg}</div>}

      {/* Main Layout - Object Centric */}
      {/* Main Layout - Grid: Left | Center | Right */}
      <div className="main-layout">

        {/* COL 1: LEFT TOOLS */}
        <div className="tools-left-container">
          <ToolsLeft
            liteMode={LITE_MODE}
            strumEnabled={strumEnabled}
            attackOn={attackOn}
            releaseOn={releaseOn}
            colorOn={colorOn}
            expressionOn={expressionOn}
            effectLevel={effectLevel}
            onStrumToggle={() => setStrumEnabled(prev => !prev)}
            onAttackToggle={() => setAttackOn(prev => !prev)}
            onReleaseToggle={() => setReleaseOn(prev => !prev)}
            onColorToggle={() => setColorOn(prev => !prev)}
            onExpressionToggle={() => setExpressionOn(prev => !prev)}
            onEffectLevelChange={setEffectLevel}
          />
        </div>

        {/* COL 2: CENTER PANEL */}
        <div className="center-panel">
          <CircleOfFifths
            currentKey={currentKey}
            pressedRoots={pressedRoots}
            onRootPress={handleRootPress}
            onRootRelease={handleRootRelease}
            onRootGlide={handleRootGlide}
            contextMap={contextData?.map}
            minorContextMap={contextData?.minorMap}
            fingersPerNote={fingersPerNote}
            majorKeys={MAJOR_NOTES}
            minorKeys={MINOR_NOTES}
            onKeyChange={handleKeyChange}
          />

          {/* Bottom row: Key + Acordes + Octave */}
          <div className="wheel-bottom-row">
            <OctaveControl
              octave={octave}
              onOctaveChange={handleOctaveChange}
            />
            <button
              type="button"
              className={`hold-btn btn-chords ${chordMode ? 'active' : ''}`}
              aria-pressed={chordMode}
              aria-label="Acordes"
              title="Acordes"
              onClick={() => setChordMode(prev => !prev)}
            >
              <span className="btn-label">acordes</span>
              <svg className="btn-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <rect x="2" y="3"  width="12" height="2" rx="1" />
                <rect x="4" y="7"  width="8"  height="2" rx="1" />
                <rect x="2" y="11" width="12" height="2" rx="1" />
              </svg>
            </button>
            <button
              type="button"
              className={`hold-btn btn-hold ${isHold ? 'active' : ''}`}
              aria-pressed={isHold}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleHold();
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                e.stopPropagation();
                toggleHold();
              }}
              aria-label="Hold"
              title="Hold"
            >
              <span className="btn-label">hold</span>
              <svg className="btn-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <rect x="3" y="7" width="10" height="7" rx="2" />
                <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
            {fullscreenAvailable && (
              <button
                type="button"
                className={`hold-btn fullscreen-toggle btn-full ${isFullscreen ? 'active' : ''}`}
                aria-pressed={isFullscreen}
                aria-label={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
                onClick={toggleFullscreen}
                title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
              >
                <span className="btn-label">{isFullscreen ? 'exit' : 'full'}</span>
                <svg className="btn-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"
                        fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* COL 3: RIGHT TOOLS */}
        <div className="tools-right-container">
          <Arpeggiator
            liteMode={LITE_MODE}
            value={arpPattern}
            swing={arpSwing}
            tempo={arpTempo}
            onValueChange={handleArpPatternChange}
            onSwingChange={setArpSwing}
            onTempoChange={setArpTempo}
          />
          {/* FULL VERSION: metronome is hidden in the demo.
          <Metronome
            active={metronomeActive}
            volume={metronomeVolume}
            muted={metronomeMuted}
            timeSignature={timeSignature}
            beat={metronomeBeat}
            accent={metronomeAccent}
            clickSound={metronomeClickSound}
            tempo={arpTempo}
            onToggle={() => setMetronomeActive(!metronomeActive)}
            onVolumeChange={setMetronomeVolume}
            onMuteToggle={() => setMetronomeMuted(!metronomeMuted)}
            onTimeSignatureChange={setTimeSignature}
            onClickSoundChange={(sound) => { setMetronomeClickSound(sound); }}
            onTempoChange={setArpTempo}
          />
          */}
          <div className="rec-instrument-row">
            {/* FULL VERSION: REC and LOOP are hidden in the demo.
            <RecLoopHold
              isHold={isHold}
              onHoldChange={updateHold}
              activeModal={activeModal}
              onModalFocus={setActiveModal}
            />
            */}
            <InstrumentSelector
              instrument={instrument}
              onInstrumentChange={setInstrument}
            />
            {LITE_MODE ? (
              // LITE: un solo switch Jazzy (off='pop', on='jazz').
              <div className="jazzy-control">
                <span className="jazzy-label">Jazzy</span>
                <button
                  type="button"
                  role="switch"
                  aria-label="Activar estilo Jazzy"
                  aria-checked={style === 'jazz'}
                  className={`jazzy-switch ${style === 'jazz' ? 'on' : ''}`}
                  onClick={() => setStyle(prev => prev === 'jazz' ? 'pop' : 'jazz')}
                >
                  <span className="jazzy-switch-thumb" aria-hidden="true" />
                </button>
                <span className="jazzy-state">{style === 'jazz' ? 'ON' : 'OFF'}</span>
              </div>
            ) : (
              // FULL: selector completo Pop/Rock/Jazz/Bossa + toggle auto voicing
              <>
                <StyleSelector
                  style={style.charAt(0).toUpperCase() + style.slice(1)}
                  onStyleChange={handleStyleChange}
                />
                <button
                  className={`hold-btn ${autoVoicing ? 'active' : ''}`}
                  onClick={() => setAutoVoicing(prev => !prev)}
                >
                  auto voicing
                </button>
              </>
            )}
          </div>
        </div>

      </div>

      {/* Minimal Branding - Bottom Center */}
      <header className="app-header">
        <h1>Fivo</h1>
      </header>

      {/* Minimal Chord Display - Bottom Left */}
      <div className="bottom-left-corner">
        <ResultPanel chordData={chordData} />
      </div>

      {/* Quick Fingers Selector - Bottom Right (DISABLED) */}
      {/* <div className="quick-fingers">
        <div className="quick-fingers-row">
          <div className="quick-fingers-center">
            <div className="quick-fingers-btns">
              {[1, 2, 3].map(f => (
                <button
                  key={f}
                  className="quick-finger-btn"
                  onClick={() => setAllFingers(f)}
                  title={`Todos a ${f} dedo${f > 1 ? 's' : ''}`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <button
            className={`fingers-config-btn ${showFingersPanel ? 'active' : ''}`}
            onClick={() => {
              const newShow = !showFingersPanel;
              setShowFingersPanel(newShow);
              if (newShow) setActiveModal('fingers');
            }}
            title="Configure fingers per note"
          >
            ✋
          </button>
        </div>
      </div> */}


      {/* Fingers Configuration Panel */}
      {showFingersPanel && (
          <div
            className="fingers-panel"
            onMouseDown={() => setActiveModal('fingers')}
            style={{
              width: fingersPanelSize.w,
              height: fingersPanelSize.h,
              zIndex: activeModal === 'fingers' ? 900 : 500,
              ...(fingersPanelPos ? { right: 'auto', left: fingersPanelPos.x, top: fingersPanelPos.y, transform: 'none' } : {})
            }}
          >
            {/* Resize handles */}
            <div className="resize-handle nw" onMouseDown={handleResizeStart('nw')} onTouchStart={handleResizeStart('nw')} />
            <div className="resize-handle ne" onMouseDown={handleResizeStart('ne')} onTouchStart={handleResizeStart('ne')} />
            <div className="resize-handle sw" onMouseDown={handleResizeStart('sw')} onTouchStart={handleResizeStart('sw')} />
            <div className="resize-handle se" onMouseDown={handleResizeStart('se')} onTouchStart={handleResizeStart('se')} />
            <div className="resize-handle n" onMouseDown={handleResizeStart('n')} onTouchStart={handleResizeStart('n')} />
            <div className="resize-handle s" onMouseDown={handleResizeStart('s')} onTouchStart={handleResizeStart('s')} />
            <div className="resize-handle w" onMouseDown={handleResizeStart('w')} onTouchStart={handleResizeStart('w')} />
            <div className="resize-handle e" onMouseDown={handleResizeStart('e')} onTouchStart={handleResizeStart('e')} />

            <div
              className="fingers-panel-header"
              onMouseDown={handlePanelDragStart}
              onTouchStart={handlePanelDragStart}
            >
              <h3>Fingers per Note</h3>
              <button className="fingers-panel-close" onClick={() => setShowFingersPanel(false)}>×</button>
            </div>
            <div className="fingers-panel-content">
              <div className="fingers-section">
                <h4>Major</h4>
                <div className="fingers-grid">
                  {MAJOR_PANEL.map(note => {
                    const fingers = fingersPerNote[note] ?? 1;
                    const inv = inversionPerNote[note] ?? 0;
                    return (
                      <div key={note} className="fingers-note-row">
                        <span className="note-label">{note}</span>
                        <RotaryKnob
                          value={inv}
                          onChange={(val) => handleInversionPerNoteChange(note, val)}
                          min={0}
                          max={2}
                          step={1}
                          label=""
                          formatValue={(v) => v === 0 ? 'Root' : v === 1 ? '1st' : '2nd'}
                        />
                        <div className="fingers-btns">
                          {[1, 2, 3].map(f => (
                            <button
                              key={f}
                              className={`finger-btn ${fingers === f ? 'active' : ''}`}
                              onClick={() => handleFingersChange(note, f)}
                            >
                              {f}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="fingers-section">
                <h4>Minor</h4>
                <div className="fingers-grid">
                  {MINOR_PANEL.map(note => {
                    const fingers = fingersPerNote[note] ?? 1;
                    const inv = inversionPerNote[note] ?? 0;
                    return (
                      <div key={note} className="fingers-note-row">
                        <span className="note-label">{note}</span>
                        <RotaryKnob
                          value={inv}
                          onChange={(val) => handleInversionPerNoteChange(note, val)}
                          min={0}
                          max={2}
                          step={1}
                          label=""
                          formatValue={(v) => v === 0 ? 'Root' : v === 1 ? '1st' : '2nd'}
                        />
                        <div className="fingers-btns">
                          {[1, 2, 3].map(f => (
                            <button
                              key={f}
                              className={`finger-btn ${fingers === f ? 'active' : ''}`}
                              onClick={() => handleFingersChange(note, f)}
                            >
                              {f}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
      )}
    </div>
  );
}

function App() {
  return <FivoWorkspace />;
}

export default App;
