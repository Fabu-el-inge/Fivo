#include "fivo.h"
#include <algorithm>

// Internal helper for MIDI Note ID
uint8_t calculate_midi_id(FivoNote note, int octave) {
    // MIDI Note 0 is C-1 (approx). 
    // Unity/Standard usually maps Middle C (C4) to 60.
    // So C0 = 12, C1 = 24...
    // Let's assume standard MIDI mapping where C0 is note 12.
    // note enum: C=0 ... B=11
    
    // Safety clamp octave
    if (octave < -1) octave = -1;
    if (octave > 9) octave = 9;

    int base = 12 * (octave + 1);
    return static_cast<uint8_t>(base + note);
}

// In the future this file can contain more complex theory helpers
// like Interval calculations, Scale lookups, etc.
