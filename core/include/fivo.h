#pragma once

#include "fivo_types.h"

#ifdef __cplusplus
extern "C" {
#endif

// --- Core API ---

// Calculate a chord
// inversion: 0 = root pos, 1 = 1st inv, etc.
// octave: base octave for the root (e.g. 3, 4, 5)
FivoChordResult fivo_get_chord(FivoNote root, FivoChordType type, int inversion, int octave);

// Get the MIDI ID for a single note
uint8_t fivo_get_midi_note(FivoNote note, int octave);

// --- Circle of Fifths API ---
FivoNote fivo_circle_get_dominant(FivoNote currentKey);
FivoNote fivo_circle_get_subdominant(FivoNote currentKey);
FivoNote fivo_circle_get_relative_minor(FivoNote currentKey);
FivoNote fivo_circle_get_relative_major(FivoNote minorKey);

// --- Style API ---
FivoColorCode fivo_style_get_color(FivoNote key, FivoNote targetRoot);
FivoColorCode fivo_style_get_minor_color(FivoNote key, FivoNote minorRoot);

#ifdef __cplusplus
}
#endif
