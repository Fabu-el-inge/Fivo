#include "fivo.h"
// Contains the implementation of the C API functions 
// that might wrap internal C++ classes in the future.

// Forward declarations of internal logic if needed
uint8_t calculate_midi_id(FivoNote note, int octave);

extern "C" {

uint8_t fivo_get_midi_note(FivoNote note, int octave) {
    return calculate_midi_id(note, octave);
}

// fivo_get_chord is already implemented in chord_engine.cpp with C linkage
// so we don't need a wrapper here if we defined it there purely.
// However, earlier I defined it in chord_engine.cpp without extern "C" block explicitly 
// but using the header. Let's make sure chord_engine.cpp includes fivo.h inside extern "C" 
// OR the function definition matches.
// Actually, in C++, we need to explicitly mark the definition as extern "C" 
// if it's not inside such a block.
// Let's rely on chord_engine.cpp implementing it directly as a C-compatible function.

}
