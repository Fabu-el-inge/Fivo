#pragma once

#include <cstdint>

#ifdef __cplusplus
extern "C" {
#endif

// --- Basic Music Data Types ---

typedef enum {
    NOTE_C = 0,
    NOTE_CS = 1,
    NOTE_D = 2,
    NOTE_DS = 3,
    NOTE_E = 4,
    NOTE_F = 5,
    NOTE_FS = 6,
    NOTE_G = 7,
    NOTE_GS = 8,
    NOTE_A = 9,
    NOTE_AS = 10,
    NOTE_B = 11
} FivoNote;

typedef enum {
    CHORD_MAJOR = 0,
    CHORD_MINOR = 1,
    CHORD_DIMINISHED = 2,
    CHORD_AUGMENTED = 3,
    CHORD_DOM7 = 4,
    CHORD_MAJ7 = 5,
    CHORD_MIN7 = 6,
    CHORD_POWER5 = 7,
    CHORD_DOM9 = 8,
    CHORD_MAJ9 = 9,
    CHORD_MIN9 = 10
} FivoChordType;

typedef struct {
    uint8_t midi_value; // 0-127
    uint8_t velocity;   // 0-127
    uint32_t channel;   // 0-15
} FivoMidiNote;

typedef struct {
    FivoMidiNote notes[8]; // Max 8 notes per chord for now
    uint8_t count;
} FivoChordResult;

// --- Visual/UI Data Types ---

typedef enum {
    COLOR_RED = 0,    // Unsafe / Clash
    COLOR_ORANGE = 1, // Tension / Interesting
    COLOR_GREEN = 2,  // Safe / Consonant
    COLOR_BLUE = 3    // Active Selection
} FivoColorCode;

typedef enum {
    STYLE_POP = 0,
    STYLE_ROCK = 1,
    STYLE_JAZZ = 2,
    STYLE_BOSSA = 3
} FivoStyle;

// Extended chord options
typedef struct {
    int fingers;           // 1, 2, or 3 notes (0 = auto/full chord)
    int use_voice_leading; // 1 = find closest voicing to prev_notes
    uint8_t prev_notes[8]; // Previous chord notes for voice leading
    int prev_count;        // Number of previous notes
} FivoChordOptions;

#ifdef __cplusplus
}
#endif
