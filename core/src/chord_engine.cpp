#include "fivo.h"
#include <vector>
#include <algorithm>

extern "C" {

// Internal Helper from music_theory.cpp (re-declared here for now or we could use an internal header)
// For simplicity in this structure, let's keep it self-contained or create an internal header later.
static uint8_t internal_get_midi(FivoNote note, int octave) {
    // Quick re-impl for now to avoid linking issues without internal headers yet
    int base = 12 * (octave + 1);
    return static_cast<uint8_t>(base + note);
}

FivoChordResult fivo_get_chord(FivoNote root, FivoChordType type, int inversion, int octave) {
    FivoChordResult result = {0};
    
    // 1. Define Intervals based on ChordType
    // Root is always 0
    std::vector<int> intervals;
    intervals.push_back(0); // Root

    switch (type) {
        case CHORD_MAJOR:
            intervals.push_back(4); // Major 3rd
            intervals.push_back(7); // Perfect 5th
            break;
        case CHORD_MINOR:
            intervals.push_back(3); // Minor 3rd
            intervals.push_back(7); // Perfect 5th
            break;
        case CHORD_DIMINISHED:
            intervals.push_back(3); // Minor 3rd
            intervals.push_back(6); // Diminished 5th
            break;
        case CHORD_AUGMENTED:
            intervals.push_back(4); // Major 3rd
            intervals.push_back(8); // Augmented 5th
            break;
        case CHORD_DOM7:
            intervals.push_back(4);
            intervals.push_back(7);
            intervals.push_back(10); // Minor 7th
            break;
        case CHORD_MAJ7:
            intervals.push_back(4);
            intervals.push_back(7);
            intervals.push_back(11); // Major 7th
            break;
        case CHORD_MIN7:
            intervals.push_back(3);
            intervals.push_back(7);
            intervals.push_back(10); // Minor 7th
            break;
    }

    // 2. Apply Inversion
    // For 1st inversion, the root (index 0) goes up +12 semitones
    // For 2nd inversion, the next note (index 1) goes up +12 semitones, etc.
    // A simple way is to treat them as relative semitones from root.
    
    // Adjust intervals for inversion
    // This is a naive inversion logic: moving the bottom notes up an octave.
    // e.g. C Major (0, 4, 7). Inv 1 -> (4, 7, 12). Inv 2 -> (7, 12, 16).
    
    // Use a copy to manipulate
    std::vector<int> current_intervals = intervals;
    
    for (int i = 0; i < inversion; ++i) {
        // Take the lowest note, add 12 to it, then resorting isn't strictly necessary for sound 
        // but helpful for linearity.
        // Actually, standard inversion rotates the array: [R, 3, 5] -> [3, 5, R+12]
        if (!current_intervals.empty()) {
            int bottom = current_intervals[0];
            current_intervals.erase(current_intervals.begin());
            current_intervals.push_back(bottom + 12);
        }
    }

    // 3. Construct Result
    // Root MIDI value
    int root_base = 12 * (octave + 1) + root; 
    
    int count = 0;
    for (int interval : current_intervals) {
        if (count >= 8) break;
        
        int midi_val = root_base + interval;
        
        // Clamp to MIDI range 0-127
        if (midi_val < 0) midi_val = 0;
        if (midi_val > 127) midi_val = 127;
        
        result.notes[count].midi_value = static_cast<uint8_t>(midi_val);
        result.notes[count].velocity = 100; // Default velocity
        result.notes[count].channel = 1;    // Default channel
        count++;
    }
    result.count = static_cast<uint8_t>(count);

    return result;
}

} // extern "C"
