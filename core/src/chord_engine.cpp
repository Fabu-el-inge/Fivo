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
        case CHORD_POWER5:
            intervals.push_back(7); // Perfect 5th only (no 3rd)
            break;
        case CHORD_DOM9:
            intervals.push_back(4);
            intervals.push_back(7);
            intervals.push_back(10);
            intervals.push_back(14); // Major 9th
            break;
        case CHORD_MAJ9:
            intervals.push_back(4);
            intervals.push_back(7);
            intervals.push_back(11);
            intervals.push_back(14); // Major 9th
            break;
        case CHORD_MIN9:
            intervals.push_back(3);
            intervals.push_back(7);
            intervals.push_back(10);
            intervals.push_back(14); // Major 9th
            break;
        // --- Jazz extended voicings ---
        case CHORD_DOM13:
            intervals.push_back(4);  // 3
            intervals.push_back(7);  // 5
            intervals.push_back(10); // b7
            intervals.push_back(21); // 13 (octave + M6)
            break;
        case CHORD_DOM7_FLAT13:
            intervals.push_back(4);
            intervals.push_back(7);
            intervals.push_back(10);
            intervals.push_back(20); // b13 (octave + m6)
            break;
        case CHORD_DOM7_SHARP9:
            intervals.push_back(4);
            intervals.push_back(7);
            intervals.push_back(10);
            intervals.push_back(15); // #9
            break;
        case CHORD_MAJ7_ADD6:
            intervals.push_back(4);  // 3
            intervals.push_back(7);  // 5
            intervals.push_back(9);  // 6
            intervals.push_back(11); // maj7
            break;
        case CHORD_MIN7_ADD11:
            intervals.push_back(3);
            intervals.push_back(7);
            intervals.push_back(10);
            intervals.push_back(17); // 11 (octave + P4)
            break;
        case CHORD_MIN11:
            intervals.push_back(3);
            intervals.push_back(7);
            intervals.push_back(10);
            intervals.push_back(14); // 9
            intervals.push_back(17); // 11
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

// Helper: calculate total distance between two sets of notes
static int calculate_voice_distance(const std::vector<int>& notes, const uint8_t* prev_notes, int prev_count) {
    if (prev_count == 0) return 0;

    int total = 0;
    // For each note in the new chord, find minimum distance to any prev note
    for (int note : notes) {
        int min_dist = 127;
        for (int i = 0; i < prev_count; i++) {
            int dist = std::abs(note - (int)prev_notes[i]);
            if (dist < min_dist) min_dist = dist;
        }
        total += min_dist;
    }
    return total;
}

// Extended chord function with fingers and voice leading
FivoChordResult fivo_get_chord_ex(FivoNote root, FivoChordType type, int inversion, int octave, FivoChordOptions* options) {
    FivoChordResult result = {0};

    int fingers = (options && options->fingers > 0) ? options->fingers : 3;
    bool use_voice_leading = options && options->use_voice_leading && options->prev_count > 0;

    // 1. Build base intervals
    std::vector<int> intervals;
    intervals.push_back(0); // Root always

    switch (type) {
        case CHORD_MAJOR:
            intervals.push_back(4);
            intervals.push_back(7);
            break;
        case CHORD_MINOR:
            intervals.push_back(3);
            intervals.push_back(7);
            break;
        case CHORD_DIMINISHED:
            intervals.push_back(3);
            intervals.push_back(6);
            break;
        case CHORD_AUGMENTED:
            intervals.push_back(4);
            intervals.push_back(8);
            break;
        case CHORD_DOM7:
            intervals.push_back(4);
            intervals.push_back(7);
            intervals.push_back(10);
            break;
        case CHORD_MAJ7:
            intervals.push_back(4);
            intervals.push_back(7);
            intervals.push_back(11);
            break;
        case CHORD_MIN7:
            intervals.push_back(3);
            intervals.push_back(7);
            intervals.push_back(10);
            break;
        case CHORD_POWER5:
            intervals.push_back(7);
            break;
        case CHORD_DOM9:
            intervals.push_back(4);
            intervals.push_back(7);
            intervals.push_back(10);
            intervals.push_back(14);
            break;
        case CHORD_MAJ9:
            intervals.push_back(4);
            intervals.push_back(7);
            intervals.push_back(11);
            intervals.push_back(14);
            break;
        case CHORD_MIN9:
            intervals.push_back(3);
            intervals.push_back(7);
            intervals.push_back(10);
            intervals.push_back(14);
            break;
        // --- Jazz extended voicings ---
        case CHORD_DOM13:
            intervals.push_back(4);
            intervals.push_back(7);
            intervals.push_back(10);
            intervals.push_back(21);
            break;
        case CHORD_DOM7_FLAT13:
            intervals.push_back(4);
            intervals.push_back(7);
            intervals.push_back(10);
            intervals.push_back(20);
            break;
        case CHORD_DOM7_SHARP9:
            intervals.push_back(4);
            intervals.push_back(7);
            intervals.push_back(10);
            intervals.push_back(15);
            break;
        case CHORD_MAJ7_ADD6:
            intervals.push_back(4);
            intervals.push_back(7);
            intervals.push_back(9);
            intervals.push_back(11);
            break;
        case CHORD_MIN7_ADD11:
            intervals.push_back(3);
            intervals.push_back(7);
            intervals.push_back(10);
            intervals.push_back(17);
            break;
        case CHORD_MIN11:
            intervals.push_back(3);
            intervals.push_back(7);
            intervals.push_back(10);
            intervals.push_back(14);
            intervals.push_back(17);
            break;
    }

    // 2. Limit by fingers — priorities per tipo de acorde
    //    para preservar la nota "color" característica (7, 9, 13, b13, #9, 11, etc.)
    //    en lugar de la quinta (que se suele dropear en jazz voicing).
    std::vector<int> limited_intervals;
    auto pick = [&](std::initializer_list<int> priority) {
        int i = 0;
        for (int iv : priority) {
            if (i++ >= fingers) break;
            limited_intervals.push_back(iv);
        }
    };

    switch (type) {
        case CHORD_MAJOR:       pick({0, 7, 4});            break;
        case CHORD_MINOR:       pick({0, 7, 3});            break;
        case CHORD_DIMINISHED:  pick({0, 6, 3});            break;
        case CHORD_AUGMENTED:   pick({0, 8, 4});            break;
        case CHORD_POWER5:      pick({0, 7});               break;
        case CHORD_DOM7:        pick({0, 10, 4, 7});        break;
        case CHORD_MAJ7:        pick({0, 11, 4, 7});        break;
        case CHORD_MIN7:        pick({0, 10, 3, 7});        break;
        case CHORD_DOM9:        pick({0, 10, 4, 14, 7});    break;
        case CHORD_MAJ9:        pick({0, 11, 4, 14, 7});    break;
        case CHORD_MIN9:        pick({0, 10, 3, 14, 7});    break;
        // Jazz extended: extension (13, b13, #9, 6, 11) viene antes que la 5ta
        case CHORD_DOM13:       pick({0, 10, 4, 21, 7});    break;
        case CHORD_DOM7_FLAT13: pick({0, 10, 4, 20, 7});    break;
        case CHORD_DOM7_SHARP9: pick({0, 10, 4, 15, 7});    break;
        case CHORD_MAJ7_ADD6:   pick({0, 11, 4, 9, 7});     break;
        case CHORD_MIN7_ADD11:  pick({0, 10, 3, 17, 7});    break;
        case CHORD_MIN11:       pick({0, 10, 3, 17, 14, 7}); break;
    }

    // Sort to keep proper order
    std::sort(limited_intervals.begin(), limited_intervals.end());

    int root_base = 12 * (octave + 1) + root;

    // 3. Voice leading: find best inversion
    int best_inversion = inversion;
    if (use_voice_leading) {
        int best_distance = 9999;
        int max_inv = (int)limited_intervals.size();

        for (int inv = 0; inv < max_inv; inv++) {
            // Build notes for this inversion
            std::vector<int> test_intervals = limited_intervals;
            for (int i = 0; i < inv; i++) {
                if (!test_intervals.empty()) {
                    int bottom = test_intervals[0];
                    test_intervals.erase(test_intervals.begin());
                    test_intervals.push_back(bottom + 12);
                }
            }

            std::vector<int> test_notes;
            for (int interval : test_intervals) {
                test_notes.push_back(root_base + interval);
            }

            int dist = calculate_voice_distance(test_notes, options->prev_notes, options->prev_count);
            if (dist < best_distance) {
                best_distance = dist;
                best_inversion = inv;
            }
        }
    }

    // 4. Apply the chosen inversion
    std::vector<int> final_intervals = limited_intervals;
    for (int i = 0; i < best_inversion; i++) {
        if (!final_intervals.empty()) {
            int bottom = final_intervals[0];
            final_intervals.erase(final_intervals.begin());
            final_intervals.push_back(bottom + 12);
        }
    }

    // 5. Build result
    int count = 0;
    for (int interval : final_intervals) {
        if (count >= 8) break;

        int midi_val = root_base + interval;
        if (midi_val < 0) midi_val = 0;
        if (midi_val > 127) midi_val = 127;

        result.notes[count].midi_value = static_cast<uint8_t>(midi_val);
        result.notes[count].velocity = 100;
        result.notes[count].channel = 1;
        count++;
    }
    result.count = static_cast<uint8_t>(count);

    return result;
}

} // extern "C"
