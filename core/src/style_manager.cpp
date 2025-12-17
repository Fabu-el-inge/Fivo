#include "fivo.h"
#include "fivo_types.h"

extern "C" {

// Get Color/Safety for a specific chord root relative to the current key
// In Pop style:
// I (Tonic) -> Green (Home)
// IV (Subdominant) -> Green/Orange (Safe, slightly away)
// V (Dominant) -> Orange (Tension)
// vi (Relative Minor) -> Green (Safe alternative home)
// Others -> Red/Yellow depending on context.

FivoColorCode fivo_style_get_color(FivoNote key, FivoNote targetRoot) {
    int diff = (targetRoot - key + 12) % 12;
    
    switch(diff) {
        case 0: // I (Tonic)
            return COLOR_GREEN;
        case 5: // IV (Subdominant)
            return COLOR_GREEN;
        case 7: // V (Dominant)
            return COLOR_ORANGE;
        case 9: // vi (Relative Minor)
            return COLOR_GREEN; // Often considered very safe in pop
        case 2: // ii (Supertonic) - common in jazz/pop ii-V-I
            return COLOR_ORANGE; 
        case 4: // iii (Mediant)
            return COLOR_ORANGE;
        default:
            return COLOR_RED;
    }
}

// Get Color/Safety for a MINOR chord root relative to the current key
// In Pop style (C Major context):
// Am (vi) -> Green (relative minor, very safe)
// Em (iii) -> Orange (mediant minor)
// Dm (ii) -> Orange (supertonic, common ii-V-I)
// Bm (viio/natural 7) -> Red (leading tone chord)
// Others -> Red (outside diatonic)
FivoColorCode fivo_style_get_minor_color(FivoNote key, FivoNote minorRoot) {
    int diff = (minorRoot - key + 12) % 12;
    
    switch(diff) {
        case 9: // vi - Relative Minor (e.g., Am in C)
            return COLOR_GREEN;
        case 4: // iii - Mediant Minor (e.g., Em in C)
            return COLOR_ORANGE;
        case 2: // ii - Supertonic Minor (e.g., Dm in C)
            return COLOR_ORANGE;
        case 7: // v - Minor dominant (e.g., Gm in C) - used in modal interchange
            return COLOR_ORANGE;
        case 0: // i - Parallel minor of tonic (e.g., Cm in C)
            return COLOR_ORANGE; // Modal interchange
        default:
            return COLOR_RED;
    }
}

}
