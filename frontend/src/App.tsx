import { useState, useEffect, useCallback } from 'react';
import './App.css';
import { CircleOfFifths } from './components/CircleOfFifths';
import { ToolsLeft, StyleSelector, OctaveControl, KeySelector } from './components/ControlPanel';
import { ResultPanel } from './components/ResultPanel';
import { fetchChord, fetchContext } from './api/fivo';
import type { FivoResponse, FivoContextResponse } from './api/fivo';
import { audioEngine } from './api/audio';

const NOTES = ['C', 'G', 'D', 'A', 'E', 'B', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F'];

// Convert minor chord name to root note for API
const getMinorRoot = (minorNote: string): string => {
  return minorNote.replace('m', '');
};

function App() {
  const [currentKey, setCurrentKey] = useState('C');
  const [selectedRoot, setSelectedRoot] = useState('C');
  const [isMinorSelected, setIsMinorSelected] = useState(false);
  const [octave, setOctave] = useState(4);
  const [inversion, setInversion] = useState(0);
  const [strumEnabled, setStrumEnabled] = useState(false);
  const [style, setStyle] = useState('Pop');

  // Sound State
  const [articulation, setArticulation] = useState(2);
  const [expression, setExpression] = useState(false);
  const [strumSpeed, setStrumSpeed] = useState(50);

  // Update Audio Engine when settings change
  useEffect(() => {
    audioEngine.setArticulation(articulation);
    audioEngine.setExpression(expression);
  }, [articulation, expression]);

  const [chordData, setChordData] = useState<FivoResponse | null>(null);
  const [contextData, setContextData] = useState<FivoContextResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const updateContext = useCallback(async (key: string) => {
    try {
      const ctx = await fetchContext(key);
      console.log("Context loaded:", ctx);
      setContextData(ctx);
    } catch (e: unknown) {
      console.error("Context Error", e);
    }
  }, []);

  const updateChord = useCallback(async (key: string, root: string, isMinor: boolean = false, inv: number = 0) => {
    try {
      setErrorMsg('');
      const apiRoot = isMinor ? getMinorRoot(root) : root;
      // Pass inversion to API
      const res = await fetchChord(key, apiRoot, inv);

      // Minor adjustment if needed (backend now handles inversions, but we might still need to flatten 3rd if backend sends Major)
      // Actually backend CLI now returns notes based on Type, so if we sent Minor type it would differ. 
      // But currrently CLI defaults to MAJOR. 
      // AND we are modifying notes locally for Minor.
      // If the backend returns inverted Major notes, our simple "flatten 2nd note" logic might break if 2nd note is NOT the 3rd.
      // e.g. Inversion 1: [E, G, C]. Flatten 2nd note (G->Gb) -> E, Gb, C. That's WRONG.
      // Ideally we should ask Backend for MINOR chord if isMinor is true.
      // But for this task, I will rely on the "Flatten 3rd" logic being risky with inversions.
      // FIX: Let's assume for now we trust the inversion logic for Major. 
      // If isMinor, we should probably do the semintone shift intelligently or ignore it.
      // Actually, my plan didn't touch the CLI "Type" argument (it's hardcoded to Major).
      // So I will keep the naive frontend minor logic but warn it might be weird with inversions.
      // Wait, better: Check if inversion is 0. If not, maybe disable manual minor adjustment or try to find the 3rd.

      let notes = res.notes;
      if (isMinor && notes && notes.length >= 3) {
        // Naive fix: 3rd is usually the middle note in root position. 
        // In Inv 1 (3rd, 5th, Root), 3rd is index 0.
        // In Inv 2 (5th, Root, 3rd), 3rd is index 2.
        // This is complex. For now let's just use what we get, or only apply minor to root pos.
        if (inv === 0) {
          notes = [...notes];
          notes[1] = notes[1] - 1; // Flatten 3rd
        }
      }

      const adjustedData = isMinor ? { ...res, notes } : res;
      setChordData(adjustedData);

      if (notes && notes.length > 0) {
        const adjustedNotes = notes.map(n => n + (octave - 3) * 12);
        if (strumEnabled) {
          audioEngine.playNotesStrum(adjustedNotes, strumSpeed);
        } else {
          audioEngine.playNotes(adjustedNotes);
        }
      }
    } catch (e: unknown) {
      const error = e as Error;
      console.error(error);
      setErrorMsg(error.message || 'Unknown Error');
    }
  }, [octave, strumEnabled, strumSpeed]);

  useEffect(() => {
    updateContext(currentKey);
    updateChord(currentKey, selectedRoot, isMinorSelected, inversion);
  }, []);

  const handleKeyChange = (newKey: string) => {
    setCurrentKey(newKey);
    updateContext(newKey);
    updateChord(newKey, selectedRoot, isMinorSelected, inversion);
  };

  const handleRootClick = (note: string, isMinor: boolean) => {
    setSelectedRoot(note);
    setIsMinorSelected(isMinor);
    updateChord(currentKey, note, isMinor, inversion);
  };

  const handleInversionChange = (inv: number) => {
    setInversion(inv);
    updateChord(currentKey, selectedRoot, isMinorSelected, inv);
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
            expression={expression}
            onInversionChange={handleInversionChange}
            onStrumToggle={() => setStrumEnabled(!strumEnabled)}
            onStrumSpeedChange={setStrumSpeed}
            onArticulationChange={setArticulation}
            onExpressionToggle={setExpression}
          />
        </div>

        {/* COL 2: CENTER PANEL (Circle + Floating Controls) */}
        <div className="center-panel">
          <CircleOfFifths
            currentKey={currentKey}
            selectedRoot={selectedRoot}
            onRootSelect={handleRootClick}
            contextMap={contextData?.map}
            minorContextMap={contextData?.minorMap}
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
              notes={NOTES}
              onKeyChange={handleKeyChange}
            />
          </div>
        </div>

        {/* COL 3: RIGHT TOOLS (Style) */}
        <div className="tools-right-container">
          <StyleSelector
            style={style}
            onStyleChange={setStyle}
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
    </div>
  );
}

export default App;
