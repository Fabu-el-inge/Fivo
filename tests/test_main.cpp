#include <iostream>
#include <cassert>
#include "fivo.h"

void test_midi_conversion() {
    std::cout << "[Test] MIDI Conversion... ";
    // C0 = 12
    assert(fivo_get_midi_note(NOTE_C, 0) == 12);
    // A4 (440Hz standard) = 69. 
    // Logic: C4=60. A is 9 semitones above C. So 60+9=69.
    assert(fivo_get_midi_note(NOTE_A, 4) == 69);
    std::cout << "PASSED" << std::endl;
}

void test_chord_generation() {
    std::cout << "[Test] Chord Generation... ";
    
    // C Major Triad: C (0), E (4), G (7)
    // C3 maps to C3(48). E3(52), G3(55).
    FivoChordResult c_maj = fivo_get_chord(NOTE_C, CHORD_MAJOR, 0, 3);
    assert(c_maj.count == 3);
    assert(c_maj.notes[0].midi_value == 48); // C3
    assert(c_maj.notes[1].midi_value == 52); // E3
    assert(c_maj.notes[2].midi_value == 55); // G3
    
    // C Major 1st Inversion: E G C(next octave)
    // E3(52), G3(55), C4(60)
    FivoChordResult c_maj_inv1 = fivo_get_chord(NOTE_C, CHORD_MAJOR, 1, 3);
    assert(c_maj_inv1.count == 3);
    assert(c_maj_inv1.notes[0].midi_value == 52); // E3
    assert(c_maj_inv1.notes[1].midi_value == 55); // G3
    assert(c_maj_inv1.notes[2].midi_value == 60); // C4

    std::cout << "PASSED" << std::endl;
}

void test_circle_fifths() {
    std::cout << "[Test] Circle of Fifths... ";
    
    // C -> G (Dominant)
    assert(fivo_circle_get_dominant(NOTE_C) == NOTE_G);
    // C -> F (Subdominant)
    assert(fivo_circle_get_subdominant(NOTE_C) == NOTE_F);
    // C -> A (Relative Minor) - wait, relative minor of C Major is A Minor.
    // C(0) + 9 = 9 (A). Correct.
    assert(fivo_circle_get_relative_minor(NOTE_C) == NOTE_A);

    std::cout << "PASSED" << std::endl;
}

void test_style_manager_pop() {
    std::cout << "[Test] Style Manager (Pop)... ";
    
    // Key of C Major
    // C (I) -> Green
    assert(fivo_style_get_color(NOTE_C, NOTE_C) == COLOR_GREEN);
    // G (V) -> Orange
    assert(fivo_style_get_color(NOTE_C, NOTE_G) == COLOR_ORANGE);
    // F (IV) -> Green
    assert(fivo_style_get_color(NOTE_C, NOTE_F) == COLOR_GREEN);
    // A (vi) -> Green
    assert(fivo_style_get_color(NOTE_C, NOTE_A) == COLOR_GREEN);
    // F# (Tritone) -> Red (Default/Unsafe)
    assert(fivo_style_get_color(NOTE_C, NOTE_FS) == COLOR_RED);

    std::cout << "PASSED" << std::endl;
}

int main() {
    std::cout << "Running Fivo Core Tests..." << std::endl;
    
    test_midi_conversion();
    test_chord_generation();
    test_circle_fifths();
    test_style_manager_pop();
    
    std::cout << "All Tests Passed!" << std::endl;
    return 0;
}
