// ============================================================================
// LITE_MODE: versión demo simplificada (decisión Daniel 2026-05-06).
//   true  → Lite/Free: Jazzy switch, auto-voicing siempre ON, "acordes" ON
//           por default, un solo fader de expresión, arpegiador direccional,
//           Eb (bIII) va sin color en pop.
//   false → versión completa: 4 estilos, toggles individuales, voicing
//           patterns, Eb naranja como antes.
// Este flag se propaga al backend vía query param para no requerir rebuild.
// ============================================================================
export const LITE_MODE = true;
