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
    }

    // 2. Limit by fingers
    // For 7th/9th chords: prioritize root, 7th, 3rd, 9th (drop 5th - jazz voicing)
    // For triads: prioritize root, 5th, 3rd
    bool is7thOrMore = (type == CHORD_DOM7 || type == CHORD_MAJ7 || type == CHORD_MIN7 ||
                        type == CHORD_DOM9 || type == CHORD_MAJ9 || type == CHORD_MIN9);
    bool is9th = (type == CHORD_DOM9 || type == CHORD_MAJ9 || type == CHORD_MIN9);

    std::vector<int> limited_intervals;

    if (is7thOrMore) {
        // Jazz voicing priority: root, 3rd, 7th, 9th (drop 5th)
        // intervals layout for 7th: [0=root, 1=3rd, 2=5th, 3=7th]
        // intervals layout for 9th: [0=root, 1=3rd, 2=5th, 3=7th, 4=9th]
        if (fingers >= 1) limited_intervals.push_back(intervals[0]); // root
        if (fingers >= 2 && intervals.size() >= 4) {
            limited_intervals.push_back(intervals[3]); // 7th
        }
        if (fingers >= 3 && intervals.size() >= 2) {
            limited_intervals.push_back(intervals[1]); // 3rd
        }
        // For 9th chords with 3 fingers, also add the 9th
        if (fingers >= 3 && is9th && intervals.size() >= 5) {
            limited_intervals.push_back(intervals[4]); // 9th
        }
    } else {
        // Triad priority: root, 5th, 3rd
        if (fingers >= 1) limited_intervals.push_back(intervals[0]); // root
        if (fingers >= 2 && intervals.size() > 1) {
            if (intervals.size() >= 3) {
                limited_intervals.push_back(intervals[2]); // 5th
            } else if (intervals.size() >= 2) {
                limited_intervals.push_back(intervals[1]);
            }
        }
        if (fingers >= 3 && intervals.size() >= 3) {
            limited_intervals.push_back(intervals[1]); // 3rd
        }
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
