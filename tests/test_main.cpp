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
    // C -> A (Relative Minor)
    assert(fivo_circle_get_relative_minor(NOTE_C) == NOTE_A);

    std::cout << "PASSED" << std::endl;
}

void test_fifth_distance() {
    std::cout << "[Test] Fifth Distance... ";

    // C to C = 0 fifths
    assert(fivo_circle_get_fifth_distance(NOTE_C, NOTE_C) == 0);
    // C to G = 1 fifth (clockwise)
    assert(fivo_circle_get_fifth_distance(NOTE_C, NOTE_G) == 1);
    // C to F = 1 fifth (counter-clockwise, or 11 clockwise -> min is 1)
    assert(fivo_circle_get_fifth_distance(NOTE_C, NOTE_F) == 1);
    // C to D = 2 fifths
    assert(fivo_circle_get_fifth_distance(NOTE_C, NOTE_D) == 2);
    // C to Bb = 2 fifths (counter-clockwise)
    assert(fivo_circle_get_fifth_distance(NOTE_C, NOTE_AS) == 2);
    // C to A = 3 fifths
    assert(fivo_circle_get_fifth_distance(NOTE_C, NOTE_A) == 3);
    // C to Eb = 3 fifths (counter-clockwise)
    assert(fivo_circle_get_fifth_distance(NOTE_C, NOTE_DS) == 3);
    // C to E = 4 fifths
    assert(fivo_circle_get_fifth_distance(NOTE_C, NOTE_E) == 4);
    // C to Ab = 4 fifths (counter-clockwise)
    assert(fivo_circle_get_fifth_distance(NOTE_C, NOTE_GS) == 4);
    // C to B = 5 fifths
    assert(fivo_circle_get_fifth_distance(NOTE_C, NOTE_B) == 5);
    // C to Db = 5 fifths (counter-clockwise)
    assert(fivo_circle_get_fifth_distance(NOTE_C, NOTE_CS) == 5);
    // C to F# = 6 fifths (tritone - max distance)
    assert(fivo_circle_get_fifth_distance(NOTE_C, NOTE_FS) == 6);

    std::cout << "PASSED" << std::endl;
}

void test_style_manager_pop() {
    std::cout << "[Test] Style Manager (Pop)... ";

    // Key of C Major - NEW LOGIC based on circle of fifths + diatonic function
    // Primary diatonic (I, IV, V, vi) = GREEN
    assert(fivo_style_get_color(NOTE_C, NOTE_C) == COLOR_GREEN);  // I  - Tonic
    assert(fivo_style_get_color(NOTE_C, NOTE_F) == COLOR_GREEN);  // IV - Subdominant
    assert(fivo_style_get_color(NOTE_C, NOTE_G) == COLOR_GREEN);  // V  - Dominant (was ORANGE, now GREEN)
    assert(fivo_style_get_color(NOTE_C, NOTE_A) == COLOR_GREEN);  // vi - Relative minor

    // Secondary diatonic (ii, iii, vii) = ORANGE
    assert(fivo_style_get_color(NOTE_C, NOTE_D) == COLOR_ORANGE); // ii  - Supertonic
    assert(fivo_style_get_color(NOTE_C, NOTE_E) == COLOR_ORANGE); // iii - Mediant
    assert(fivo_style_get_color(NOTE_C, NOTE_B) == COLOR_ORANGE); // vii - Leading tone

    // bVII common in pop = ORANGE
    assert(fivo_style_get_color(NOTE_C, NOTE_AS) == COLOR_ORANGE); // bVII (Bb)

    // Non-diatonic far = RED
    assert(fivo_style_get_color(NOTE_C, NOTE_FS) == COLOR_RED);   // #IV/bV - Tritone
    assert(fivo_style_get_color(NOTE_C, NOTE_CS) == COLOR_RED);   // bII
    assert(fivo_style_get_color(NOTE_C, NOTE_GS) == COLOR_RED);   // bVI
    assert(fivo_style_get_color(NOTE_C, NOTE_DS) == COLOR_RED);   // bIII

    std::cout << "PASSED" << std::endl;
}

void test_style_manager_rock() {
    std::cout << "[Test] Style Manager (Rock)... ";

    // Rock has more modal interchange - bVII is GREEN, bIII and bVI are ORANGE
    assert(fivo_style_get_color_with_style(NOTE_C, NOTE_AS, STYLE_ROCK) == COLOR_GREEN);  // bVII GREEN in rock
    assert(fivo_style_get_color_with_style(NOTE_C, NOTE_DS, STYLE_ROCK) == COLOR_ORANGE); // bIII ORANGE in rock
    assert(fivo_style_get_color_with_style(NOTE_C, NOTE_GS, STYLE_ROCK) == COLOR_ORANGE); // bVI ORANGE in rock

    std::cout << "PASSED" << std::endl;
}

void test_style_manager_jazz() {
    std::cout << "[Test] Style Manager (Jazz)... ";

    // Jazz is very permissive - most things are at least ORANGE
    assert(fivo_style_get_color_with_style(NOTE_C, NOTE_D, STYLE_JAZZ) == COLOR_GREEN);   // ii is GREEN in jazz
    assert(fivo_style_get_color_with_style(NOTE_C, NOTE_AS, STYLE_JAZZ) == COLOR_GREEN);  // bVII GREEN in jazz
    assert(fivo_style_get_color_with_style(NOTE_C, NOTE_DS, STYLE_JAZZ) == COLOR_GREEN);  // bIII GREEN in jazz
    assert(fivo_style_get_color_with_style(NOTE_C, NOTE_CS, STYLE_JAZZ) == COLOR_ORANGE); // bII ORANGE in jazz
    assert(fivo_style_get_color_with_style(NOTE_C, NOTE_GS, STYLE_JAZZ) == COLOR_ORANGE); // bVI ORANGE in jazz

    std::cout << "PASSED" << std::endl;
}

int main() {
    std::cout << "Running Fivo Core Tests..." << std::endl;

    test_midi_conversion();
    test_chord_generation();
    test_circle_fifths();
    test_fifth_distance();
    test_style_manager_pop();
    test_style_manager_rock();
    test_style_manager_jazz();

    std::cout << "All Tests Passed!" << std::endl;
    return 0;
}
