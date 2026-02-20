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

// Extended chord function with fingers limit and voice leading
FivoChordResult fivo_get_chord_ex(FivoNote root, FivoChordType type, int inversion, int octave, FivoChordOptions* options);

// Get the MIDI ID for a single note
uint8_t fivo_get_midi_note(FivoNote note, int octave);

// --- Circle of Fifths API ---
FivoNote fivo_circle_get_dominant(FivoNote currentKey);
FivoNote fivo_circle_get_subdominant(FivoNote currentKey);
FivoNote fivo_circle_get_relative_minor(FivoNote currentKey);
FivoNote fivo_circle_get_relative_major(FivoNote minorKey);
int fivo_circle_get_fifth_distance(FivoNote from, FivoNote to);
int fivo_is_in_key(FivoNote key, FivoNote note);
int fivo_get_scale_degree(FivoNote key, FivoNote note);

// --- Style API ---
// Legacy functions (default to POP style)
FivoColorCode fivo_style_get_color(FivoNote key, FivoNote targetRoot);
FivoColorCode fivo_style_get_minor_color(FivoNote key, FivoNote minorRoot);

// Style-aware functions
FivoColorCode fivo_style_get_color_with_style(FivoNote key, FivoNote targetRoot, FivoStyle style);
FivoColorCode fivo_style_get_minor_color_with_style(FivoNote key, FivoNote minorRoot, FivoStyle style);

// Minor key context functions
FivoColorCode fivo_style_get_color_minor_key(FivoNote minorKey, FivoNote targetRoot, FivoStyle style);
FivoColorCode fivo_style_get_minor_color_minor_key(FivoNote minorKey, FivoNote targetRoot, FivoStyle style);

#ifdef __cplusplus
}
#endif
