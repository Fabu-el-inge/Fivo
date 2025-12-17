#include "fivo.h"

// The Circle of Fifths:
// C  (0) -> G  (1) -> D  (2) -> A  (3) -> E  (4) -> B  (5) -> F# (6)
// Gb (6) <- Db (5) <- Ab (4) <- Eb (3) <- Bb (2) <- F  (1) <- C  (0)
//
// In terms of semitones from C:
// C=0, G=7, D=2, A=9, E=4, B=11, F#/Gb=6, Db=1, Ab=8, Eb=3, Bb=10, F=5
// 
// Navigation:
// Clockwise (Dominant) = +7 semitones (mod 12)
// Counter-Clockwise (Subdominant) = +5 semitones (or -7) (mod 12)

extern "C" {

// Simple function to get the 5th (Dominant) of a key
FivoNote fivo_circle_get_dominant(FivoNote currentKey) {
    // +7 semitones
    return static_cast<FivoNote>((currentKey + 7) % 12);
}

// Simple function to get the 4th (Subdominant) of a key
FivoNote fivo_circle_get_subdominant(FivoNote currentKey) {
    // +5 semitones
    return static_cast<FivoNote>((currentKey + 5) % 12);
}

// We can add "Relative Minor" logic
// Relative minor is -3 semitones (or +9)
FivoNote fivo_circle_get_relative_minor(FivoNote currentKey) {
    return static_cast<FivoNote>((currentKey + 9) % 12);
}

// Get the relative major of a minor key
// Relative major is +3 semitones (or -9 mod 12)
// e.g., Am -> C Major
FivoNote fivo_circle_get_relative_major(FivoNote minorKey) {
    return static_cast<FivoNote>((minorKey + 3) % 12);
}

// Check if a note is in the scale of the key (Major Scale)
// Major scale interval pattern: W W H W W W H (2 2 1 2 2 2 1)
// C Major: C D E F G A B
// Relative indices: 0, 2, 4, 5, 7, 9, 11
int fivo_is_in_key(FivoNote key, FivoNote note) {
    int diff = (note - key + 12) % 12;
    switch(diff) {
        case 0: // Root
        case 2: // Major 2nd
        case 4: // Major 3rd
        case 5: // Perfect 4th
        case 7: // Perfect 5th
        case 9: // Major 6th
        case 11: // Major 7th
            return 1; // True
        default:
            return 0; // False
    }
}

}
