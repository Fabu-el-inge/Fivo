import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import { CircleOfFifths } from './components/CircleOfFifths';
import { ToolsLeft, StyleSelector, InstrumentSelector, OctaveControl, KeySelector, RotaryKnob, RecLoopHold, Arpeggiator, Metronome } from './components/ControlPanel';
import type { MetronomeClickSound } from './components/ControlPanel';
import { ResultPanel } from './components/ResultPanel';
import { fetchChord, fetchContext } from './api/fivo';
import type { FivoResponse, FivoContextResponse, FivoStyle, PowerMode } from './api/fivo';
import { audioEngine } from './api/audio';
import type { InstrumentName } from './api/audio';

const MAJOR_NOTES = ['C', 'G', 'D', 'A', 'E', 'B', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
const MINOR_NOTES = ['Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm'];

// Panel order: naturals first, then accidentals
const MAJOR_PANEL = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'Db', 'Eb', 'Gb', 'Ab', 'Bb'];
const MINOR_PANEL = ['Cm', 'Dm', 'Em', 'Fm', 'Gm', 'Am', 'Bm', 'C#m', 'Ebm', 'F#m', 'G#m', 'Bbm'];
const ALL_NOTES = [...MAJOR_NOTES, ...MINOR_NOTES];

// Convert minor chord name to root note for API
const getMinorRoot = (minorNote: string): string => {
  return minorNote.replace('m', '');
};

function App() {
  const [currentKey, setCurrentKey] = useState('C');
  const [pressedRoot, setPressedRoot] = useState<string | null>(null);
  const [, setIsMinorPressed] = useState(false);
  const [octave, setOctave] = useState(4);
  const [inversion, setInversion] = useState(0);
  const [strumEnabled, setStrumEnabled] = useState(false);
  const [style, setStyle] = useState<FivoStyle>('pop');
  const [powerMode, setPowerMode] = useState<PowerMode>('auto');
  // Fingers per note (default 1 for all)
  const [fingersPerNote, setFingersPerNote] = useState<Record<string, number>>({});
  // Inversion per note (default 0 = Root for all)
  const [inversionPerNote, setInversionPerNote] = useState<Record<string, number>>({});
  // Auto Voicing - automatically choose best inversion for smooth voice leading
  const [autoVoicing, setAutoVoicing] = useState(false);
  const lastPlayedNotes = useRef<number[]>([]); // Track last chord notes for auto voicing
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
  const [articulation, setArticulation] = useState(2);
  const [tempo, setTempo] = useState(120); // BPM
  const [expression, setExpression] = useState(0); // 0-100
  const [strumSpeed, setStrumSpeed] = useState(50);
  const [instrument, setInstrument] = useState<InstrumentName>('Synth');

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
  const arpTempoRef = useRef(120);
  const arpPatternRef = useRef(0);
  const arpBaseNotesRef = useRef<number[]>([]);
  const arpIntervalRef = useRef<number | null>(null);
  const savedFingersRef = useRef<Record<string, number> | null>(null);
  const lastGlideTime = useRef<number>(0); // Throttle glide events
  const arpStartTime = useRef<number>(0);
  const pendingGlide = useRef<{ note: string; isMinor: boolean; arpNotes?: number[]; chordData?: FivoResponse } | null>(null);
  const currentPressedRef = useRef<string | null>(null); // Track current pressed note (avoid state timing issues)

  // Hold State - keeps chord/arp playing after release
  const [isHold, setIsHold] = useState(false);

  // Arpeggio patterns by style
  const getArpPattern = (pattern: number, notes: number[], currentStyle: FivoStyle): number[] => {
    if (notes.length < 2) return notes;
    const root = notes[0];
    const third = notes[1] || root;
    const fifth = notes[2] || third;
    const seventh = root + 10;
    const octave = root + 12;

    if (currentStyle === 'pop') {
      switch (pattern) {
        case 1: return [root, octave, fifth, third];
        case 2: return [root, fifth, octave, third];
        case 3: return [root, third, fifth, third];
        case 4: return [root, fifth, third, fifth];
        case 5: return [root, fifth, octave, fifth];
        default: return notes;
      }
    }
    if (currentStyle === 'jazz') {
      switch (pattern) {
        case 1: return [root, third, fifth, seventh];
        case 2: return [seventh, fifth, third, root];
        case 3: return [root, third, seventh];
        case 4: return [root, third, fifth, seventh, octave];
        case 5: return [root, seventh, third, fifth];
        default: return notes;
      }
    }
    if (currentStyle === 'rock') {
      switch (pattern) {
        case 1: return [root, fifth, root, fifth];
        case 2: return [root, root, fifth, fifth];
        case 3: return [root, root, root, fifth];
        case 4: return [root, fifth, octave, fifth];
        case 5: return [root, octave, root, octave];
        default: return notes;
      }
    }
    if (currentStyle === 'bossa') {
      switch (pattern) {
        case 1: return [root, fifth, third, fifth];
        case 2: return [root, third, fifth, third];
        case 3: return [root, fifth, root, third];
        case 4: return [root, third, fifth, octave, fifth];
        case 5: return [root, fifth, octave, fifth, third];
        default: return notes;
      }
    }
    return notes;
  };

  // Handle arpeggiator pattern change - save/restore fingers
  const handleArpPatternChange = (newPattern: number) => {
    const wasOff = arpPattern === 0;
    const willBeOff = newPattern === 0;

    if (wasOff && !willBeOff) {
      savedFingersRef.current = { ...fingersPerNote };
      const allNotesFingers: Record<string, number> = {};
      ALL_NOTES.forEach(note => { allNotesFingers[note] = 3; });
      setFingersPerNote(allNotesFingers);

      if (isHold && pressedRoot && lastPlayedNotes.current.length > 0) {
        arpPatternRef.current = newPattern;
        arpBaseNotesRef.current = lastPlayedNotes.current;
        audioEngine.releaseNotes();

        let noteIndex = 0;
        let timingIndex = 0;
        let currentArpNotes = getArpPattern(newPattern, lastPlayedNotes.current, style);
        let lastPatternUsed = newPattern;

        const getNextInterval = (timingIdx: number): number => {
          const msPerBeat = 60000 / arpTempoRef.current;
          const eighth = msPerBeat / 2;
          const triplet = msPerBeat / 3;
          let pattern: number[];
          switch (style) {
            case 'jazz': pattern = [triplet * 2, triplet, triplet * 2, triplet]; break;
            case 'bossa': pattern = [eighth * 1.5, eighth * 0.5, eighth, eighth]; break;
            case 'rock': pattern = [eighth * 0.95, eighth * 1.05, eighth * 0.95, eighth * 1.05]; break;
            default: pattern = [eighth, eighth, eighth, eighth];
          }
          return pattern[timingIdx % pattern.length];
        };

        audioEngine.attackNotes([currentArpNotes[noteIndex]]);
        noteIndex++;

        const playNextNote = () => {
          audioEngine.releaseNotes();
          if (arpPatternRef.current === 0) {
            audioEngine.attackNotes(arpBaseNotesRef.current);
            return;
          }
          if (arpPatternRef.current !== lastPatternUsed) {
            lastPatternUsed = arpPatternRef.current;
            currentArpNotes = getArpPattern(arpPatternRef.current, arpBaseNotesRef.current, style);
            noteIndex = 0;
          }
          if (noteIndex >= currentArpNotes.length) noteIndex = 0;
          audioEngine.attackNotes([currentArpNotes[noteIndex]]);
          noteIndex++;
          timingIndex++;
          arpIntervalRef.current = window.setTimeout(playNextNote, getNextInterval(timingIndex));
        };

        arpIntervalRef.current = window.setTimeout(playNextNote, getNextInterval(timingIndex));
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
  useEffect(() => {
    audioEngine.setArticulation(articulation);
    audioEngine.setTempo(tempo);
    audioEngine.setExpression(expression);
  }, [articulation, tempo, expression]);

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

  // Keep arp pattern ref in sync
  useEffect(() => {
    arpPatternRef.current = arpPattern;
  }, [arpPattern]);

  // Update instrument when changed
  useEffect(() => {
    audioEngine.setInstrument(instrument);
  }, [instrument]);

  // Track previous hold state to detect toggle OFF
  const prevHoldRef = useRef(isHold);
  useEffect(() => {
    // Only act when hold is turned OFF (was true, now false)
    if (prevHoldRef.current && !isHold) {
      if (arpIntervalRef.current) {
        clearTimeout(arpIntervalRef.current);
        arpIntervalRef.current = null;
      }
      pendingGlide.current = null;
      currentPressedRef.current = null;
      audioEngine.releaseAll();
      setPressedRoot(null);
    }
    prevHoldRef.current = isHold;
  }, [isHold]);

  const [chordData, setChordData] = useState<FivoResponse | null>(null);
  const [contextData, setContextData] = useState<FivoContextResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

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

  // Initial load - fetch context only
  useEffect(() => {
    updateContext(currentKey, style);
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

  // Get fingers for a specific note (default 1 = Root)
  const getFingersForNote = (note: string): number => {
    return fingersPerNote[note] ?? 1;
  };

  // Set fingers for a specific note
  const handleFingersChange = (note: string, fingers: number) => {
    setFingersPerNote(prev => ({ ...prev, [note]: fingers }));
  };

  // Set ALL notes to same finger count (used by quick-fingers, currently disabled)
  // @ts-expect-error - temporarily unused while quick-fingers is disabled
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

  // Calculate best inversion for smooth voice leading (Auto Voicing)
  const calculateBestInversion = (chordNotes: number[], previousNotes: number[]): number => {
    if (previousNotes.length === 0 || chordNotes.length === 0) {
      return 0; // No previous chord, use root position
    }

    // Generate all inversions of the chord
    const inversions: number[][] = [];
    for (let inv = 0; inv < Math.min(3, chordNotes.length); inv++) {
      const inverted = [...chordNotes];
      for (let i = 0; i < inv; i++) {
        // Move lowest note up an octave
        inverted.push(inverted.shift()! + 12);
      }
      inversions.push(inverted);
    }

    // Calculate total movement for each inversion
    let bestInversion = 0;
    let minMovement = Infinity;

    inversions.forEach((invNotes, invIndex) => {
      let totalMovement = 0;

      // Compare each note to closest note in previous chord
      invNotes.forEach(note => {
        const closestDistance = Math.min(
          ...previousNotes.map(prevNote => Math.abs(note - prevNote))
        );
        totalMovement += closestDistance;
      });

      if (totalMovement < minMovement) {
        minMovement = totalMovement;
        bestInversion = invIndex;
      }
    });

    return bestInversion;
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

  // User presses on a chord - START sound
  const handleRootPress = async (note: string, isMinor: boolean) => {
    // If hold is ON and tapping the same note that's playing, toggle it OFF
    if (isHold && pressedRoot === note) {
      if (arpIntervalRef.current) {
        clearTimeout(arpIntervalRef.current);
        arpIntervalRef.current = null;
      }
      pendingGlide.current = null;
      currentPressedRef.current = null;
      audioEngine.releaseAll();
      setPressedRoot(null);
      return;
    }

    // If Hold is ON and arpeggiator is already running, queue the change (quantized)
    if (isHold && arpPattern > 0 && arpIntervalRef.current) {
      setPressedRoot(note);
      setIsMinorPressed(isMinor);
      currentPressedRef.current = note;

      const noteFingers = getFingersForNote(note);
      const noteInversion = getInversionForNote(note);
      const data = await fetchChordData(currentKey, note, isMinor, noteInversion, style, powerMode, noteFingers);
      if (data?.notes) {
        const adjustedNotes = data.notes.map(n => n + (octave - 3) * 12);
        const newArpNotes = getArpPattern(arpPattern, adjustedNotes, style);
        pendingGlide.current = { note, isMinor, arpNotes: newArpNotes, chordData: data };
      }
      return;
    }

    // Stop any currently playing arpeggiator/notes before starting new one
    if (arpIntervalRef.current) {
      clearTimeout(arpIntervalRef.current);
      arpIntervalRef.current = null;
    }
    pendingGlide.current = null;
    audioEngine.panic(); // Use panic for complete reset

    setPressedRoot(note);
    setIsMinorPressed(isMinor);
    currentPressedRef.current = note; // Sync ref immediately
    const noteFingers = getFingersForNote(note);

    // For auto voicing, first get chord with root position, then calculate best inversion
    let noteInversion = getInversionForNote(note);
    if (autoVoicing && lastPlayedNotes.current.length > 0) {
      const baseData = await fetchChordData(currentKey, note, isMinor, 0, style, powerMode, noteFingers);
      if (baseData?.notes) {
        const baseAdjusted = baseData.notes.map(n => n + (octave - 3) * 12);
        noteInversion = calculateBestInversion(baseAdjusted, lastPlayedNotes.current);
      }
    }

    const data = await fetchChordData(currentKey, note, isMinor, noteInversion, style, powerMode, noteFingers);

    if (data?.notes) {
      const adjustedNotes = data.notes.map(n => n + (octave - 3) * 12);
      lastPlayedNotes.current = adjustedNotes;

      // If arpeggiator is active
      if (arpPattern > 0) {
        arpBaseNotesRef.current = adjustedNotes;
        let arpNotes = getArpPattern(arpPattern, adjustedNotes, style);

        const getNextInterval = (timingIdx: number): number => {
          const msPerBeat = 60000 / arpTempoRef.current;
          const eighth = msPerBeat / 2;
          const triplet = msPerBeat / 3;
          let pattern: number[];
          switch (style) {
            case 'jazz': pattern = [triplet * 2, triplet, triplet * 2, triplet]; break;
            case 'bossa': pattern = [eighth * 1.5, eighth * 0.5, eighth, eighth]; break;
            case 'rock': pattern = [eighth * 0.95, eighth * 1.05, eighth * 0.95, eighth * 1.05]; break;
            default: pattern = [eighth, eighth, eighth, eighth];
          }
          return pattern[timingIdx % pattern.length];
        };

        let noteIndex = 0;
        let timingIndex = 0;
        let lastPatternUsed = arpPattern;

        arpStartTime.current = performance.now();
        audioEngine.attackNotes([arpNotes[noteIndex]]);
        noteIndex++;

        const playNextNote = () => {
          audioEngine.releaseNotes();

          if (arpPatternRef.current !== lastPatternUsed) {
            if (arpPatternRef.current === 0) {
              audioEngine.attackNotes(arpBaseNotesRef.current);
              return;
            }
            lastPatternUsed = arpPatternRef.current;
            arpNotes = getArpPattern(arpPatternRef.current, arpBaseNotesRef.current, style);
            noteIndex = 0;
          }

          if (noteIndex >= arpNotes.length) {
            noteIndex = 0;
            if (pendingGlide.current) {
              const pending = pendingGlide.current;
              pendingGlide.current = null;
              if (pending.arpNotes && pending.chordData) {
                arpBaseNotesRef.current = pending.chordData.notes.map(n => n + (octave - 3) * 12);
                arpNotes = pending.arpNotes;
                setPressedRoot(pending.note);
                setIsMinorPressed(pending.isMinor);
                setChordData(pending.chordData);
              }
            }
          }

          audioEngine.attackNotes([arpNotes[noteIndex]]);
          noteIndex++;
          const interval = getNextInterval(timingIndex);
          timingIndex++;
          arpIntervalRef.current = window.setTimeout(playNextNote, interval);
        };

        const firstInterval = getNextInterval(0);
        arpIntervalRef.current = window.setTimeout(playNextNote, firstInterval);
      } else if (strumEnabled) {
        audioEngine.attackNotesStrum(adjustedNotes, strumSpeed);
      } else {
        audioEngine.attackNotes(adjustedNotes);
      }
    }
  };

  // User releases chord - STOP sound (unless hold is ON)
  const handleRootRelease = () => {
    if (isHold) return;

    setPressedRoot(null);
    currentPressedRef.current = null;
    if (arpIntervalRef.current) {
      clearTimeout(arpIntervalRef.current);
      arpIntervalRef.current = null;
    }
    audioEngine.releaseAll();
  };

  // User glides to another chord while holding - smooth transition with quantization
  const handleRootGlide = (note: string, isMinor: boolean) => {
    if (currentPressedRef.current === note) return;

    const now = performance.now();
    if (now - lastGlideTime.current < 30) return;
    lastGlideTime.current = now;

    setPressedRoot(note);
    setIsMinorPressed(isMinor);
    currentPressedRef.current = note;

    // If arpeggiator is active, queue the change for smooth transition
    if (arpPattern > 0) {
      const noteFingers = getFingersForNote(note);
      const noteInversion = getInversionForNote(note);
      fetchChordData(currentKey, note, isMinor, noteInversion, style, powerMode, noteFingers)
        .then(data => {
          if (data?.notes) {
            const adjustedNotes = data.notes.map(n => n + (octave - 3) * 12);
            const newArpNotes = getArpPattern(arpPattern, adjustedNotes, style);
            pendingGlide.current = { note, isMinor, arpNotes: newArpNotes, chordData: data };
          }
        });
    } else {
      if (arpIntervalRef.current) {
        clearTimeout(arpIntervalRef.current);
        arpIntervalRef.current = null;
      }
      audioEngine.releaseAll();

      const noteFingers = getFingersForNote(note);
      const noteInversion = getInversionForNote(note);
      fetchChordData(currentKey, note, isMinor, noteInversion, style, powerMode, noteFingers)
        .then(data => {
          if (data?.notes && currentPressedRef.current === note) {
            const adjustedNotes = data.notes.map(n => n + (octave - 3) * 12);
            if (strumEnabled) {
              audioEngine.attackNotesStrum(adjustedNotes, strumSpeed);
            } else {
              audioEngine.attackNotes(adjustedNotes);
            }
          }
        });
    }
  };

  // Global mouseup/touchend to catch releases outside the circle
  useEffect(() => {
    const handleGlobalRelease = () => {
      if (isHold) return;

      if (arpIntervalRef.current) {
        clearTimeout(arpIntervalRef.current);
        arpIntervalRef.current = null;
      }
      pendingGlide.current = null;
      currentPressedRef.current = null;
      audioEngine.releaseAll();

      if (pressedRoot !== null) {
        setPressedRoot(null);
      }
    };

    const handlePanic = () => {
      if (arpIntervalRef.current) {
        clearTimeout(arpIntervalRef.current);
        arpIntervalRef.current = null;
      }
      pendingGlide.current = null;
      currentPressedRef.current = null;
      audioEngine.releaseAll();
      setPressedRoot(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handlePanic();
      }
    };

    window.addEventListener('mouseup', handleGlobalRelease);
    window.addEventListener('touchend', handleGlobalRelease);
    window.addEventListener('touchcancel', handleGlobalRelease);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handlePanic);

    return () => {
      window.removeEventListener('mouseup', handleGlobalRelease);
      window.removeEventListener('touchend', handleGlobalRelease);
      window.removeEventListener('touchcancel', handleGlobalRelease);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handlePanic);
    };
  }, [pressedRoot, isHold]);

  // User changes inversion
  const handleInversionChange = (inv: number) => {
    setInversion(inv);
  };

  // Style change - NO sound (just visual update)
  const handleStyleChange = (newStyle: string) => {
    setStyle(newStyle.toLowerCase() as FivoStyle);
  };

  const handleOctaveChange = (delta: number) => {
    setOctave(Math.max(1, Math.min(7, octave + delta)));
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
            inversion={inversion}
            strumEnabled={strumEnabled}
            strumSpeed={strumSpeed}
            articulation={articulation}
            tempo={tempo}
            expression={expression}
            autoVoicing={autoVoicing}
            onInversionChange={handleInversionChange}
            onStrumToggle={() => setStrumEnabled(!strumEnabled)}
            onStrumSpeedChange={setStrumSpeed}
            onArticulationChange={setArticulation}
            onTempoChange={setTempo}
            onExpressionChange={setExpression}
            onAutoVoicingToggle={setAutoVoicing}
          />
        </div>

        {/* COL 2: CENTER PANEL (Circle + Floating Controls) */}
        <div className="center-panel">
          <CircleOfFifths
            currentKey={currentKey}
            pressedRoot={pressedRoot}
            onRootPress={handleRootPress}
            onRootRelease={handleRootRelease}
            onRootGlide={handleRootGlide}
            contextMap={contextData?.map}
            minorContextMap={contextData?.minorMap}
            fingersPerNote={fingersPerNote}
          />

          {/* Bottom Control: Octave */}
          <div className="bottom-center">
            <OctaveControl
              octave={octave}
              onOctaveChange={handleOctaveChange}
            />
          </div>

          {/* 4:00 PM Control: Key Selector */}
          <div className="position-4-oclock">
            <KeySelector
              currentKey={currentKey}
              majorNotes={MAJOR_NOTES}
              minorNotes={MINOR_NOTES}
              onKeyChange={handleKeyChange}
            />
          </div>
        </div>

        {/* COL 3: RIGHT TOOLS (Arpeggiator + Instrument + Rec Loop + Style) */}
        <div className="tools-right-container">
          <Arpeggiator
            value={arpPattern}
            tempo={arpTempo}
            onValueChange={handleArpPatternChange}
            onTempoChange={setArpTempo}
          />
          <InstrumentSelector
            instrument={instrument}
            onInstrumentChange={setInstrument}
          />
          <RecLoopHold
            isHold={isHold}
            onHoldChange={setIsHold}
            activeModal={activeModal}
            onModalFocus={setActiveModal}
          />
          <StyleSelector
            style={style.charAt(0).toUpperCase() + style.slice(1)}
            onStyleChange={handleStyleChange}
          />
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

      {/* Metronome - Bottom Right */}
      <div className="metronome-bottom-right">
        <Metronome
          active={metronomeActive}
          volume={metronomeVolume}
          muted={metronomeMuted}
          timeSignature={timeSignature}
          beat={metronomeBeat}
          accent={metronomeAccent}
          clickSound={metronomeClickSound}
          onToggle={() => setMetronomeActive(!metronomeActive)}
          onVolumeChange={setMetronomeVolume}
          onMuteToggle={() => setMetronomeMuted(!metronomeMuted)}
          onTimeSignatureChange={setTimeSignature}
          onClickSoundChange={(sound) => {
            setMetronomeClickSound(sound);
          }}
        />
      </div>

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

export default App;
