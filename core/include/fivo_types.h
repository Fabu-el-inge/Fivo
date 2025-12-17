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
    CHORD_MIN7 = 6
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
    COLOR_BLUE = 3    // Active Selecion
} FivoColorCode;

#ifdef __cplusplus
}
#endif
