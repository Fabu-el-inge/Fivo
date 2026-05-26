#include "fivo.h"
#include "fivo_types.h"

// External functions from circle_engine.cpp
extern "C" {
    int fivo_circle_get_fifth_distance(FivoNote from, FivoNote to);
    int fivo_is_in_key(FivoNote key, FivoNote note);
    int fivo_get_scale_degree(FivoNote key, FivoNote note);
}

extern "C" {

// LITE_MODE flag — seteado desde el CLI con --lite, leído por las funciones de color.
// Cuando es 1, ciertos acordes (ej: bIII en pop) caen a RED en vez de ORANGE.
static int g_lite_mode = 0;
void fivo_set_lite_mode(int on) { g_lite_mode = on ? 1 : 0; }

// ============================================================================
// STYLE-BASED COLOR LOGIC FOR CIRCLE OF FIFTHS
// ============================================================================
//
// Color Classification:
//   GREEN  (2) = SAFE - High compatibility, use freely
//   ORANGE (1) = INTERESTING - Adds color/tension, use with purpose
//   RED    (0) = NOT RECOMMENDED - High friction, avoid in style
//
// Logic Priority:
//   1. Diatonic function (I, IV, V, vi = primary functions)
//   2. Distance in fifths (0-1 = close, 2-3 = medium, 4-6 = far)
//   3. Style-specific adjustments
// ============================================================================

// Helper: Check if note is a primary diatonic function (I, IV, V, vi)
static int is_primary_diatonic(int scaleDegree) {
    switch(scaleDegree) {
        case 0:  // I  - Tonic
        case 5:  // IV - Subdominant
        case 7:  // V  - Dominant
        case 9:  // vi - Relative minor
            return 1;
        default:
            return 0;
    }
}

// Helper: Check if note is a secondary diatonic function (ii, iii, vii)
static int is_secondary_diatonic(int scaleDegree) {
    switch(scaleDegree) {
        case 2:  // ii  - Supertonic
        case 4:  // iii - Mediant
        case 11: // vii - Leading tone
            return 1;
        default:
            return 0;
    }
}

// ============================================================================
// POP STYLE
// ============================================================================
// Solo los acordes MAYORES diatónicos son SAFE (verde): I, IV, V
// El resto de mayores son ORANGE o RED
static FivoColorCode get_color_pop(FivoNote key, FivoNote target, int scaleDegree, int fifthDist, int isDiatonic) {
    (void)key; (void)target; (void)fifthDist; (void)isDiatonic; // Unused
    // Solo 3 acordes MAYORES diatónicos en una escala mayor = GREEN
    // I (0), IV (5), V (7)
    switch(scaleDegree) {
        case 0:  // I  - Tónica (C en key C)
        case 5:  // IV - Subdominante (F en key C)
        case 7:  // V  - Dominante (G en key C)
            return COLOR_GREEN;
    }

    // bIII (Eb en C) - en FULL es ORANGE (préstamo menor usado para color),
    // en LITE cae a RED (decisión Daniel 2026-05-06: "va sin color")
    if (scaleDegree == 3) {
        return g_lite_mode ? COLOR_RED : COLOR_ORANGE;
    }

    // Acordes mayores de color comunes en pop = ORANGE
    switch(scaleDegree) {
        case 10: // bVII - Préstamo mixolidio (Bb en C) - muy común en pop
        case 9:  // VI - (A en C) - dominante secundario V/ii
        case 2:  // II - (D en C) - dominante secundario V/V
        case 4:  // III - (E en C) - dominante secundario V/vi → resuelve a Am
            return COLOR_ORANGE;
    }

    // Todo lo demás = RED (evitar en pop)
    // Incluye: VII (11), bII (1), #IV/bV (6), bVI (8)
    return COLOR_RED;
}

// ============================================================================
// ROCK STYLE
// ============================================================================
// Modal interchange friendly: bVII, bIII, bVI are common (borrowed from parallel minor)
static FivoColorCode get_color_rock(FivoNote key, FivoNote target, int scaleDegree, int fifthDist, int isDiatonic) {
    (void)key; (void)target; (void)fifthDist; (void)isDiatonic; // Unused
    // Primary diatonic = GREEN
    if (is_primary_diatonic(scaleDegree)) {
        return COLOR_GREEN;
    }

    // Secondary diatonic = ORANGE
    if (is_secondary_diatonic(scaleDegree)) {
        return COLOR_ORANGE;
    }

    // Modal interchange chords (borrowed from parallel minor) = GREEN/ORANGE
    switch(scaleDegree) {
        case 10: // bVII - Very common in rock (C -> Bb)
            return COLOR_GREEN;
        case 3:  // bIII - Common power chord (C -> Eb)
            return COLOR_ORANGE;
        case 8:  // bVI - Common in rock progressions (C -> Ab)
            return COLOR_ORANGE;
        case 1:  // bII - Neapolitan, less common but used
            return COLOR_RED;
    }

    // vii diminished is less useful in rock
    if (scaleDegree == 11) {
        return COLOR_RED;
    }

    return COLOR_RED;
}

// ============================================================================
// JAZZ STYLE
// ============================================================================
// Very permissive: Almost everything is at least ORANGE
// Secondary dominants, tritone substitutes, modal interchange all welcome
static FivoColorCode get_color_jazz(FivoNote key, FivoNote target, int scaleDegree, int fifthDist, int isDiatonic) {
    (void)key; (void)target; (void)fifthDist; (void)isDiatonic; // Unused
    // Primary diatonic = GREEN
    if (is_primary_diatonic(scaleDegree)) {
        return COLOR_GREEN;
    }

    // ii chord is GREEN in jazz (ii-V-I is fundamental)
    if (scaleDegree == 2) {
        return COLOR_GREEN;
    }

    // bVII and bIII common in jazz = GREEN
    if (scaleDegree == 10 || scaleDegree == 3) {
        return COLOR_GREEN;
    }

    // Most other chords are at least interesting in jazz
    // Only tritone (#IV/bV) might be genuinely awkward
    if (scaleDegree == 6) { // #IV/bV - tritone
        return COLOR_ORANGE;
    }

    // Everything else = ORANGE in jazz (secondary dominants, subs, etc)
    return COLOR_ORANGE;
}

// ============================================================================
// BOSSA NOVA STYLE
// ============================================================================
// Similar to jazz but with some Brazilian flavor
// ii-V-I chains, chromatic approach, but some things are still red
static FivoColorCode get_color_bossa(FivoNote key, FivoNote target, int scaleDegree, int fifthDist, int isDiatonic) {
    (void)key; (void)target; (void)fifthDist; (void)isDiatonic; // Unused
    // Primary diatonic = GREEN
    if (is_primary_diatonic(scaleDegree)) {
        return COLOR_GREEN;
    }

    // ii is GREEN (ii-V-I fundamental in bossa)
    if (scaleDegree == 2) {
        return COLOR_GREEN;
    }

    // Secondary diatonic = ORANGE
    if (is_secondary_diatonic(scaleDegree)) {
        return COLOR_ORANGE;
    }

    // bVII common = ORANGE
    if (scaleDegree == 10) {
        return COLOR_ORANGE;
    }

    // Modal interchange = ORANGE
    if (scaleDegree == 3 || scaleDegree == 8) { // bIII, bVI
        return COLOR_ORANGE;
    }

    // bII (Neapolitan) used in bossa = ORANGE
    if (scaleDegree == 1) {
        return COLOR_ORANGE;
    }

    // Tritone = RED (less common in traditional bossa)
    if (scaleDegree == 6) {
        return COLOR_RED;
    }

    return COLOR_ORANGE;
}

// ============================================================================
// MAIN API FUNCTIONS
// ============================================================================

// Get color for MAJOR chord with style consideration
FivoColorCode fivo_style_get_color_with_style(FivoNote key, FivoNote targetRoot, FivoStyle style) {
    int scaleDegree = (targetRoot - key + 12) % 12;
    int fifthDist = fivo_circle_get_fifth_distance(key, targetRoot);
    int isDiatonic = fivo_is_in_key(key, targetRoot);

    switch(style) {
        case STYLE_POP:
            return get_color_pop(key, targetRoot, scaleDegree, fifthDist, isDiatonic);
        case STYLE_ROCK:
            return get_color_rock(key, targetRoot, scaleDegree, fifthDist, isDiatonic);
        case STYLE_JAZZ:
            return get_color_jazz(key, targetRoot, scaleDegree, fifthDist, isDiatonic);
        case STYLE_BOSSA:
            return get_color_bossa(key, targetRoot, scaleDegree, fifthDist, isDiatonic);
        default:
            return get_color_pop(key, targetRoot, scaleDegree, fifthDist, isDiatonic);
    }
}

// Legacy function - defaults to POP style for backwards compatibility
FivoColorCode fivo_style_get_color(FivoNote key, FivoNote targetRoot) {
    return fivo_style_get_color_with_style(key, targetRoot, STYLE_POP);
}

// ============================================================================
// MINOR CHORD COLORS
// ============================================================================

// ============================================================================
// POP STYLE - MINOR
// ============================================================================
// Los 3 menores diatónicos son GREEN: ii, iii, vi
// Préstamos modales comunes = ORANGE
// El resto = RED
static FivoColorCode get_minor_color_pop(FivoNote key, FivoNote minorRoot, int scaleDegree, int fifthDist) {
    (void)key; (void)minorRoot; (void)fifthDist; // Unused in this style
    switch(scaleDegree) {
        case 9:  // vi - Relativo menor (Am en C) - fundamental
        case 2:  // ii - Supertónica menor (Dm en C) - muy común
        case 4:  // iii - Mediante menor (Em en C) - muy común
            return COLOR_GREEN;
        case 0:  // i - Paralelo menor (Cm en C) - préstamo modal
        case 7:  // v - Dominante menor (Gm en C) - préstamo modal
        case 5:  // iv - Subdominante menor (Fm en C) - préstamo modal
        case 11: // vii - (Bm en C) - poco común pero usable
            return COLOR_ORANGE;
        default:
            return COLOR_RED;
    }
}

// ============================================================================
// ROCK STYLE - MINOR
// ============================================================================
// Similar a pop pero más permisivo con préstamos modales
static FivoColorCode get_minor_color_rock(FivoNote key, FivoNote minorRoot, int scaleDegree, int fifthDist) {
    (void)key; (void)minorRoot; (void)fifthDist; // Unused in this style
    switch(scaleDegree) {
        case 9:  // vi - Relativo menor - fundamental
        case 2:  // ii - Supertónica menor
        case 4:  // iii - Mediante menor
            return COLOR_GREEN;
        case 0:  // i - Paralelo menor - muy usado en rock
        case 7:  // v - Dominante menor
        case 5:  // iv - Subdominante menor
            return COLOR_ORANGE;
        case 11: // vii - Sensible menor
        case 10: // bvii - (Bbm en C)
            return COLOR_ORANGE;
        default:
            return COLOR_RED;
    }
}

// ============================================================================
// JAZZ STYLE - MINOR
// ============================================================================
// Muy permisivo: ii-V-I es fundamental, casi todo es al menos ORANGE
static FivoColorCode get_minor_color_jazz(FivoNote key, FivoNote minorRoot, int scaleDegree, int fifthDist) {
    (void)key; (void)minorRoot; // Unused in this style
    switch(scaleDegree) {
        case 9:  // vi - Relativo menor
        case 2:  // ii - Fundamental en ii-V-I
        case 4:  // iii - Mediante
            return COLOR_GREEN;
        case 0:  // i - Paralelo menor
        case 7:  // v - Dominante menor
        case 5:  // iv - Subdominante menor
        case 11: // vii - Sensible
        case 10: // bvii
        case 3:  // biii
        case 8:  // bvi
        case 1:  // bii - Aproximación cromática
            return COLOR_ORANGE;
        default:
            // En jazz, casi todo es usable
            if (fifthDist <= 3) {
                return COLOR_ORANGE;
            }
            return COLOR_RED;
    }
}

// ============================================================================
// BOSSA NOVA STYLE - MINOR
// ============================================================================
// Similar a jazz, ii-V-I chains fundamentales
static FivoColorCode get_minor_color_bossa(FivoNote key, FivoNote minorRoot, int scaleDegree, int fifthDist) {
    (void)key; (void)minorRoot; // Unused in this style
    switch(scaleDegree) {
        case 9:  // vi - Relativo menor
        case 2:  // ii - Fundamental en ii-V-I
        case 4:  // iii - Mediante
            return COLOR_GREEN;
        case 0:  // i - Paralelo menor
        case 7:  // v - Dominante menor
        case 5:  // iv - Subdominante menor
        case 11: // vii
        case 1:  // bii - Aproximación cromática común en bossa
            return COLOR_ORANGE;
        default:
            if (fifthDist <= 2) {
                return COLOR_ORANGE;
            }
            return COLOR_RED;
    }
}

// ============================================================================
// MAIN API - MINOR CHORDS
// ============================================================================
FivoColorCode fivo_style_get_minor_color_with_style(FivoNote key, FivoNote minorRoot, FivoStyle style) {
    int scaleDegree = (minorRoot - key + 12) % 12;
    int fifthDist = fivo_circle_get_fifth_distance(key, minorRoot);

    switch(style) {
        case STYLE_POP:
            return get_minor_color_pop(key, minorRoot, scaleDegree, fifthDist);
        case STYLE_ROCK:
            return get_minor_color_rock(key, minorRoot, scaleDegree, fifthDist);
        case STYLE_JAZZ:
            return get_minor_color_jazz(key, minorRoot, scaleDegree, fifthDist);
        case STYLE_BOSSA:
            return get_minor_color_bossa(key, minorRoot, scaleDegree, fifthDist);
        default:
            return get_minor_color_pop(key, minorRoot, scaleDegree, fifthDist);
    }
}

// Legacy function - defaults to POP style
FivoColorCode fivo_style_get_minor_color(FivoNote key, FivoNote minorRoot) {
    return fivo_style_get_minor_color_with_style(key, minorRoot, STYLE_POP);
}

// ============================================================================
// MINOR KEY CONTEXT - MAJOR CHORDS
// ============================================================================
// Cuando la tonalidad es MENOR (ej: Am), los acordes mayores tienen diferente función
static FivoColorCode get_color_minor_key_pop(int scaleDegree) {
    switch(scaleDegree) {
        case 3:  // III - Relativo mayor (C en Am) - fundamental
        case 7:  // V  - Dominante mayor (E en Am) - dominante (menor armónica)
        case 8:  // bVI - (F en Am) - diatónico de la menor natural
        case 10: // bVII - (G en Am) - subtónica - MUY común en pop (Am-G-F-E, Am-G-C)
            return COLOR_GREEN;
        case 0:  // I  - Paralelo mayor (A en Am) - préstamo (tiene C#, no diatónico)
        case 5:  // IV - Subdominante (D en Am) - modo dórico (tiene F#, no diatónico)
            return COLOR_ORANGE;
        default:
            return COLOR_RED;
    }
}

static FivoColorCode get_color_minor_key_rock(int scaleDegree) {
    switch(scaleDegree) {
        case 3:  // III - Relativo mayor
        case 7:  // V  - Dominante
        case 10: // VII - Subtónica (muy usado en rock)
            return COLOR_GREEN;
        case 0:  // I  - Paralelo mayor
        case 5:  // IV - Subdominante dórico
        case 8:  // VI - Subdominante
            return COLOR_ORANGE;
        default:
            return COLOR_RED;
    }
}

static FivoColorCode get_color_minor_key_jazz(int scaleDegree) {
    switch(scaleDegree) {
        case 3:  // III - Relativo mayor
        case 7:  // V  - Dominante
        case 5:  // IV - Subdominante
            return COLOR_GREEN;
        case 0:  // I  - Paralelo mayor
        case 8:  // VI - Subdominante
        case 10: // VII - Subtónica
        case 1:  // bII - Napolitano
        case 2:  // II - Dominante secundario
            return COLOR_ORANGE;
        default:
            return COLOR_ORANGE; // Jazz es permisivo
    }
}

static FivoColorCode get_color_minor_key_bossa(int scaleDegree) {
    switch(scaleDegree) {
        case 3:  // III - Relativo mayor
        case 7:  // V  - Dominante
            return COLOR_GREEN;
        case 5:  // IV
        case 8:  // VI
        case 10: // VII
        case 0:  // I
        case 1:  // bII
            return COLOR_ORANGE;
        default:
            return COLOR_RED;
    }
}

FivoColorCode fivo_style_get_color_minor_key(FivoNote minorKey, FivoNote targetRoot, FivoStyle style) {
    int scaleDegree = (targetRoot - minorKey + 12) % 12;
    switch(style) {
        case STYLE_POP:   return get_color_minor_key_pop(scaleDegree);
        case STYLE_ROCK:  return get_color_minor_key_rock(scaleDegree);
        case STYLE_JAZZ:  return get_color_minor_key_jazz(scaleDegree);
        case STYLE_BOSSA: return get_color_minor_key_bossa(scaleDegree);
        default:          return get_color_minor_key_pop(scaleDegree);
    }
}

// ============================================================================
// MINOR KEY CONTEXT - MINOR CHORDS
// ============================================================================
static FivoColorCode get_minor_color_minor_key_pop(int scaleDegree) {
    switch(scaleDegree) {
        case 0:  // i  - Tónica menor (Am en Am) - fundamental
        case 5:  // iv - Subdominante menor (Dm en Am)
        case 7:  // v  - Dominante menor (Em en Am)
            return COLOR_GREEN;
        case 2:  // ii - (Bm en Am) - disminuido normalmente
        case 3:  // iii - (Cm en Am)
        case 10: // vii - (Gm en Am)
            return COLOR_ORANGE;
        default:
            return COLOR_RED;
    }
}

static FivoColorCode get_minor_color_minor_key_rock(int scaleDegree) {
    switch(scaleDegree) {
        case 0:  // i  - Tónica
        case 5:  // iv - Subdominante
        case 7:  // v  - Dominante
            return COLOR_GREEN;
        case 2:  // ii
        case 10: // vii
        case 3:  // iii
            return COLOR_ORANGE;
        default:
            return COLOR_RED;
    }
}

static FivoColorCode get_minor_color_minor_key_jazz(int scaleDegree) {
    switch(scaleDegree) {
        case 0:  // i  - Tónica
        case 5:  // iv - Subdominante
        case 7:  // v  - Dominante
            return COLOR_GREEN;
        default:
            return COLOR_ORANGE; // Jazz permisivo
    }
}

static FivoColorCode get_minor_color_minor_key_bossa(int scaleDegree) {
    switch(scaleDegree) {
        case 0:  // i
        case 5:  // iv
        case 7:  // v
            return COLOR_GREEN;
        case 2:  // ii
        case 10: // vii
            return COLOR_ORANGE;
        default:
            return COLOR_RED;
    }
}

FivoColorCode fivo_style_get_minor_color_minor_key(FivoNote minorKey, FivoNote targetRoot, FivoStyle style) {
    int scaleDegree = (targetRoot - minorKey + 12) % 12;
    switch(style) {
        case STYLE_POP:   return get_minor_color_minor_key_pop(scaleDegree);
        case STYLE_ROCK:  return get_minor_color_minor_key_rock(scaleDegree);
        case STYLE_JAZZ:  return get_minor_color_minor_key_jazz(scaleDegree);
        case STYLE_BOSSA: return get_minor_color_minor_key_bossa(scaleDegree);
        default:          return get_minor_color_minor_key_pop(scaleDegree);
    }
}

}
