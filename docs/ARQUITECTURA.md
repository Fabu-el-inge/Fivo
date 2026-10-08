# Arquitectura de Fivo (estado aprobado)

Documenta cómo funciona Fivo hoy, tal como está en producción y aprobado por el cliente.
Es la referencia para cualquier cambio: lo que figura acá como "aprobado" no se cambia sin
consultarlo.

- Relevado el 08/10/2026 sobre el commit `8773277` (rama `fix/ios-audio-sobre-front-nuevo`).
- Ese commit es lo que sirve `https://fivo.subestatica.com`. Se verificó compilando el commit y
  comparando los hashes del build con los del dominio (`index-rJ9pKmvk.js`, `index-DrJVoNHv.css`).
- `main` (`8ddc0f7`) **no** es lo que está en producción.

Los hallazgos, bugs y deuda están en [AUDITORIA-2026-10.md](AUDITORIA-2026-10.md).

---

## 1. Piezas y deploy

| Pieza | Carpeta | Dónde corre | Cómo se publica |
|---|---|---|---|
| Front (React 19 + Vite + TS + Tone.js) | `frontend/` | Vercel, proyecto `fivo-ios-test`, dominio `fivo.subestatica.com` | CLI de Vercel desde `frontend/` (no hay integración con GitHub: un push no publica) |
| Motor de sonido (Surge XT compilado a WASM) | `frontend/public/surge/` | El navegador, en un AudioWorklet | Viaja con el front |
| BFF (Express 5) | `bff/server.js` | Railway, `fivo-backend-production.up.railway.app` | Dockerfile + `railway.toml` |
| Motor musical (C++) | `core/` + `demos/cli_main.cpp` | Dentro del contenedor de Railway, como binario `fivo_demo` | Se compila en el Dockerfile |

El front encuentra al backend por `VITE_API_BASE_URL` (`frontend/.env.production`).

## 2. Qué hace cada parte (el reparto real)

| Responsabilidad | Dónde vive | Nota |
|---|---|---|
| **Colores del círculo** (consonancia por tonalidad y estilo) | **Solo C++**: `core/src/style_manager.cpp`. Llega al front por `GET /api/context` | Sin backend el círculo queda gris (salvo la tónica) |
| **Notas que suenan** | **Solo TS**: `frontend/src/api/chordCalc.ts` (`calcChordNotes`), llamado desde `App.tsx` | Se calculan en el mismo gesto, sin esperar red ("instant notes", `c78549a`) |
| Power chord automático | TS, pero decide con el mapa de colores que manda el backend | Mayor con color naranja/rojo → quinta sola |
| Posiciones, rotación y etiquetas del círculo | Solo front: `CircleOfFifths.tsx` | |
| Voice leading, octava, arpegios, strum | Solo front: `App.tsx` | El voice leading del C++ (`--prev-notes`) no se usa |
| Lectura del acorde (abajo a la izquierda, solo escritorio) | C++ vía `GET /api/chord` → `ResultPanel.tsx` | Informativo; no decide lo que suena |

**Consecuencia:** la lógica musical está repartida entre dos lenguajes. Los colores solo
existen en C++, y lo que suena solo existe en TS. En pop y rock las dos implementaciones dan
las mismas notas. En jazz y bossa no (ver auditoría, H1).

## 3. La cadena de sonido

Esto es lo que produce el sonido aprobado. Todo el resto del código de audio es fallback o
código muerto.

```
gesto (círculo / teclado Z..M, Shift = menor)
  └─ App.tsx: handleRootPress / handleRootGlide / handleRootRelease
       └─ chordCalc.ts: calcChordNotes  →  octava  →  voice leading (36..96)
            └─ AudioEngine (frontend/src/api/audio.ts)
                 └─ SurgeWasmInstrument  →  SurgeWasmHost (un único AudioWorkletNode "fivo-surge")
                      └─ fivo-surge-processor.js  →  Surge XT (WASM)  →  FX internos del preset
                           └─ Tone.Gain 1.85  →  Tone.Filter lowpass  →  Tone.Gain (expresión)
                                └─ Tone.Limiter(-1)  →  parlante
```

- **La reverb y el chorus de Tone.js NO participan del sonido aprobado.** Solo los recibe el
  fallback (`ToneFallbackInstrument`). La reverb, el delay y el rotary que se oyen salen de los
  efectos internos de cada preset de Surge.
- Hay un único worklet y un único instrumento activo a la vez. Al cambiar de instrumento, la
  cola del anterior se desvanece en 0,45 s.
- Cuándo se carga cada preset:
  - Escritorio: carga los 4 al arrancar.
  - Mobile: carga EP2 primero y los otros 3 después de que el motor está listo.

### 3.1 Modos de toque

| Situación | Método (`audio.ts`) |
|---|---|
| Polifónico normal (por dedo/touch) | `attackNotesForTouch` / `releaseNotesForTouch` |
| Con strum | `attackNotesStrumForTouch` |
| Hold (latch, monofónico) | `attackNotes`, `attackNotesStrum` |
| Arpegiador | Cadena de `setTimeout` en `App.tsx` → `arpAttackNotes` |

### 3.2 Arranque del audio (iOS incluido)

1. Al primer gesto: `audioSession.type = 'playback'` y se reemplaza el AudioContext de Tone si
   no está `running` (`ensureNativeToneContext`).
2. Se cargan, con `?v=SURGE_ASSET_VERSION`: `fivo-surge-prelude.js`, `fivo-surge-wasm.js` y
   `fivo-surge-processor.js`. Después se crea el nodo y se espera `ready`, con timeout de 45 s en
   escritorio y 15 s en mobile.
3. No hay pantalla de "Activar audio": se sacó en `3af58b3`.

## 4. Parámetros que definen el sonido aprobado (CONGELADOS)

Cambiar cualquiera de estos valores cambia lo que escucha el cliente.

**Motor y archivos.** Surge XT `1.4.main.c3eddc9`, compilado a WASM con Emscripten
(SINGLE_FILE). Los archivos se identifican por md5:

| Archivo | md5 |
|---|---|
| `fivo-surge-wasm.js` | `0773a9da419d5f0b3576d15ea5f0b626` |
| `fivo-surge-processor.js` | `68dc3ad1b45314d0fe3b8bf27938d66f` |
| `fivo-surge-prelude.js` | `f27705855966ed7d734cf980df1815d8` |
| `presets/ep2.fxp` | `3e343532cdfac0acc53d6d77dfd85d51` |
| `presets/messy.fxp` | `7d9bb073c4e7b89dfe6f76a4e76b95db` |
| `presets/canadians.fxp` | `ed6b12ae0ca257595a183389c49f9715` |
| `presets/ebass.fxp` | `a25e4b777caa154bddf7d47df5843d0e` |

**Instrumentos.**
- EP2 (por defecto), Messy y Canadians: una instancia de Surge cada uno. Canadians suena +12
  semitonos.
- E-Bass:
  - Toca solo la raíz, una octava abajo (−12).
  - Usa 8 instancias de una nota cada una, con ganancia por voz de 0,85. Son 8 voces **en todas
    las plataformas**: el sonido no varía entre dispositivos (`3af58b3`).
  - No usa voice leading. En el arpegiador toca con 1 dedo.

**Ganancias y cadena.**

| Parámetro | Valor |
|---|---|
| `SURGE_ENGINE_GAIN` | 0,78 |
| `SURGE_OUTPUT_GAIN` | 1,85 |
| Filtro (lowpass −12 dB/oct, Q=1) | `1200 · (20000/1200)^(x/100)` Hz |
| Ganancia de expresión | `0,85 + 0,15·x/100` |
| Rampas | 50 ms |
| Fader "Expression" por defecto | 50 (≈4,9 kHz, ganancia 0,925) |
| `Tone.Limiter(-1)` | Ratio 20, ataque 3 ms, release 10 ms, knee 30 dB |

**Velocity.**

| Gesto | Velocity |
|---|---|
| Normal | 127 |
| Strum por touch | 102 |
| Strum en hold | 89 |
| noteOff | 64 |

**Hold (auto-ganancia en el worklet, no aplica a E-Bass).** Warmup de 90 ms, RMS objetivo
0,055, piso 0,00035, máximo 7,5×, suavizado de 0,018 al subir y 0,06 al bajar.

**Sustain del E-Bass (en el worklet).**
- Arranca a los 0,85 s y hace un fade de 0,35 s hacia una senoide sintética de nivel 0,032, con
  2.º armónico a 0,16. El sonido original queda al 14%.
- Topes: RMS 0,026 y pico 0,055.

**Musical.**
- Raíz en MIDI 48. Octava 3 por defecto (rango 1 a 7).
- Modo LITE: 3 dedos, auto-voicing siempre activo e inversión 0.

**Strum.**
- Sin hold: 80 ms con curva cuadrática y rotación de inversión.
- Con hold: 80 ms por nota con jitter de ±60%.

**Arpegiador.**
- Corchea = `30000 / BPM` ms (120 por defecto), swing 0.
- Cada nota dura el 80% del paso (mínimo 40 ms) y el arranque se alinea a la grilla.
- Patrones: Up, Down, Up-Down, Down-Up y Random.

**Gestos.**
- Un toque dura como mínimo 140 ms.
- Si el dedo se suelta antes de que el motor esté listo, la nota suena igual, 160 ms.

## 5. Decisiones de producto tomadas (no revertir)

| # | Decisión | Origen |
|---|---|---|
| 1 | **LITE_MODE = true** (decisión Daniel, 06/05/2026), viaja hasta el C++ como `--lite`. Incluye: switch Jazzy, auto-voicing siempre ON, "acordes" ON, un solo fader de expresión, arpegiador direccional y Eb (bIII) sin color en pop | `f7fed19`, `frontend/src/config.ts` |
| 2 | Sonido por **Surge XT en WASM**. Se descartaron los WAV/samples y los sintes de Tone | `db56283` (31/07) |
| 3 | Instrumentos EP2 / Messy / Canadians / E-Bass, con EP2 por defecto y octava 3 | `db56283`, `7b75dcc` |
| 4 | Notas calculadas en el navegador, al instante ("instant notes") | `c78549a` |
| 5 | Colores POPPY en menor: F (bVI) verde en Am; A y D naranja | `01a65ac` |
| 6 | Pads sin hover, `touch-action: none` | `c78549a` |
| 7 | Arpegiador sin solapamiento de notas y alineado a la grilla de corcheas | `06090a8`, `db56283` |
| 8 | Metrónomo y REC/LOOP ocultos en esta versión (el código sigue, la UI está comentada) | `db56283` |
| 9 | Mismo sonido en todas las plataformas (E-Bass con 8 voces) y sin pantalla de "Activar audio" | `3af58b3` |
| 10 | Rediseño FIVO: círculo intacto, botón "acordes" conservado, composición por orientación y no por ancho | `f5067c2`, `b9b0145` |

**Abierto, a decidir con el cliente:** con Jazzy, lo que suena no coincide con los voicings jazz
del C++ (ver auditoría, H1). Lo que el cliente escuchó y aprobó es lo que suena hoy.

## 6. Layout (modelo actual)

- **Un solo árbol DOM, pensado para escritorio.** `.main-layout` es un grid de tres columnas:
  `.tools-left-container`, `.center-panel` y `.tools-right-container`.
  - En vertical, los tres contenedores pasan a `display: contents` y los módulos se reubican con
    `grid-template-areas`.
  - La marca (`.app-header`) es `position: fixed`.
- **El círculo** es un SVG con `viewBox` de 500×500. Su tamaño lo fija `.circle-wrapper` con
  `aspect-ratio: 1`, usando fórmulas atadas al viewport (`100dvh - Npx`).
- `App.css` son 7 capas apiladas (base → MK1 → tablet viejo → ajustes 09/09 → rediseño
  10/09 → mobile/tablet 10/09 → base responsive), con 393 `!important`.
- Pantallas verificadas que se ven bien:
  - Vertical: 390×844, 430×932, 768×1024, 744×1133 y 820×1180.
  - Escritorio: 1280×800, 1440×900 y 1920×1080.
  - Tablet apaisada: 1024×768 y 1180×820.

## 7. Cómo verificar qué está en línea

```bash
cd frontend && npm ci && npm run build
grep -oE '/assets/index-[^"]+' dist/index.html
curl -s https://fivo.subestatica.com/ | grep -oE '/assets/index-[^"]+'
```

Si los nombres coinciden, el commit compilado es el que está publicado. Vite pone en el nombre
un hash del contenido, así que cualquier diferencia de código cambia el nombre.
