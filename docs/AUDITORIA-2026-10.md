# Auditoría técnica de Fivo (octubre 2026)

Se auditó el commit `8773277`, que es lo que está en producción, con un criterio central:
**mejorar sin cambiar nada de lo que el cliente ya aprobó** (sonido, colores, ubicaciones,
lógica de notas, estética). La arquitectura vigente está en [ARQUITECTURA.md](ARQUITECTURA.md).

Cómo leer las etiquetas:

- Evidencia: **[V]** significa verificado (leído, compilado, corrido o medido). **[I]** significa
  inferido.
- Severidad:
  - 🔴 Afecta al usuario o al negocio.
  - 🟡 Bug acotado o riesgo.
  - ⚪ Deuda o suciedad.

---

## 1. Hallazgos

### Lógica musical y backend

**H1 🔴 [V] Jazzy no suena como lo que calcula el motor.**

`chordCalc.ts` (lo que suena) quedó congelado el 25/02 (`c78549a`). Los voicings jazz por grado
y la regla de que "jazz/bossa no usan power chord automático" entraron solo al C++ el 25/05
(`f7fed19`).

Se compararon las 24 tonalidades × 24 acordes × 1–3 dedos:

| Estilo | Combinaciones que difieren |
|---|---|
| pop | 0 de 1728 |
| rock | 0 de 1728 |
| jazz | 1560 de 1728 |
| bossa | 408 de 1728 (con power automático) |

Ejemplos en C mayor con Jazzy:
- G suena G9, pero el motor calcula G7(13).
- E suena **power chord de 2 notas**, pero el motor calcula E7(#9). Lo mismo pasa con B, Gb, Db y
  Ab.
- En escritorio, el panel de lectura muestra unas notas mientras suenan otras.

**El cliente aprobó lo que escuchó, o sea la versión TS.** Hay que preguntar cuál es la correcta
antes de unificar.

**H2 🔴 [V] Los colores existen solo en el backend.**

Si Railway se cae o tarda:
- El círculo queda gris.
- Desaparecen los power chords automáticos, así que en pop cambia lo que suena.
- Aparece un banner de error.
- El contexto no se reintenta.

Además, cada toque lanza un proceso C++ en Railway, con un rate limit de 600 cada 15 minutos
por IP. Detrás de una NAT compartida (un aula, por ejemplo) se puede llegar al límite.

Los colores son una tabla finita (24 tonalidades × 4 estilos × lite). Se pueden congelar como
datos verificados contra el C++, sin tocar la lógica.

**H3 🟡 [V] Los tests de C++ fallan y nadie se entera.**

`tests/test_main.cpp:89` aborta: los asserts de pop responden a una lógica vieja. El Dockerfile
los compila pero no los corre. No hay tests de voicings jazz, de tonalidades menores ni de
equivalencia entre C++ y TS.

**H4 🟡 [V] CORS abierto.**

`server.js` usa `cors({ origin: true, credentials: true })`. `DEPLOYMENT.md` y `.env.example`
documentan `ALLOWED_ORIGINS` y `RATE_LIMIT_MAX`, pero el código no los lee. El riesgo es bajo
porque no hay auth, pero cualquier sitio puede usar la API.

**H5 🟡 [V] Otros problemas del backend y su cliente.**
- `root=g` (raíz en minúscula) devuelve C sin avisar.
- Hay logs `[DEBUG]` en cada request.
- El prefetch de `fivo.ts` pide acordes de 1 dedo, pero en LITE se tocan con 3: nunca acierta en
  la caché y son 24 llamadas desperdiciadas por carga.
- No hay protección contra respuestas que llegan desordenadas al cambiar de tonalidad.
- `ResultPanel` muestra siempre "Major".

### Audio

**H6 🔴 [V] El fallback cambia el sonido sin avisar.**

Si falta el AudioWorklet, el contexto no es seguro (http) o Surge no carga en 15 s (mobile) o
45 s (escritorio), la app pasa a osciladores crudos (`ToneFallbackInstrument`): triangle, saw,
sine y square. No muestra ningún aviso. En un teléfono lento el cliente puede escuchar "otro
Fivo".

**H7 🟡 [V] Nota colgada al soltar durante la primera carga.**

Pasa en escritorio con mouse o teclado: si se suelta antes de que termine de bajar el WASM
(7,4 MB), el release no queda registrado (`audio.ts`, `releaseNotesForTouch`). La nota queda
sonando hasta el próximo toque o un pánico. Con touch sí se registra.

**H8 🟡 [V] En mobile, un instrumento puede quedar mudo.**

Si se elige antes de que llegue su preset, el worklet descarta las notas y emite un warning por
cada una. Si el fetch del preset falla, ese instrumento queda mudo toda la sesión. En
escritorio, en cambio, un preset fallido manda todo al fallback.

**H9 🟡 [V] Problemas de la carga del WASM.**
- Un timeout del WASM no se reintenta en la sesión.
- El nodo sigue vivo consumiendo CPU después del timeout.
- Un error dentro de `process()` deja silencio permanente, y solo se reporta por `console.warn`.

**H10 🟡 [V] Pánicos mal dirigidos.**
- `releaseEveryInstrument(true)` manda 4 `panic`, y el worklet apaga todo cada vez.
- `handleRootPress` hace un pánico justo antes de arrancar el arpegio, aunque el propio código
  advierte que "Surge can mute the next attack after panic". [I] Puede dejar muda la primera
  nota del arpegio.

**H11 🟡 Bugs de menor alcance.**
- **[V]** `attackNotesStrum` no respeta el token de cancelación.
- **[V]** El sustain del E-Bass usa un estado global: con dos bajos sostenidos, la cola sintética
  toma la altura de la nota vieja.
- **[I]** Cargar un preset en el hilo de audio (mobile) puede producir un corte audible.

**H12 🔴 [V] El WASM no se puede reconstruir.**

No están en el repo ni el wrapper C de Surge (`fivo_surge_*`) ni el script de build. Tampoco la
versión de emsdk; la de Surge (`1.4.main.c3eddc9`) se pudo leer porque quedó adentro del
binario. Si se pierde la máquina donde se compiló, no hay forma de regenerarlo ni de agregarle
nada, por ejemplo una salida MIDI desde el motor.

**H13 🔴 [I] Licencia.**

Surge XT es GPL-3.0 y va distribuido dentro del front. El repo es público y no tiene archivo
LICENSE ni el código fuente del build. Si se va a cobrar la versión completa (`LITE_MODE`),
hay que resolverlo antes.

### Front: layout

**H14 🔴 [V] iPad Pro 12.9"/13" en vertical se rompe por completo.**

Todo queda apilado en una columna de 300 px en una esquina, con unos 1000 px vacíos arriba y
28 solapamientos.

Causa: matchean a la vez las reglas de escritorio (`min-width:900px and min-height:600px`, que no
excluyen el vertical) y las de vertical, y gana por cascada un `!important` de escritorio.

**H15 🔴 [V] El teléfono apaisado no tiene diseño.**

Medido en 667×375, 844×390 y 932×430:
- Cae en las capas viejas del CSS.
- Hay 108–163 px de scroll obligatorio, y la barra inferior queda fuera de vista.
- La marca FIVO, fija, queda encima de la lista de instrumentos.

**No hay un diseño aprobado para este caso: hay que definirlo con el cliente.**

**H16 🟡 [V] Otros problemas de layout.**
- La marca `position: fixed` choca con la tarjeta Jazzy en pantallas de hasta 700 px de alto.
- El mismo tamaño (1366×1024) da dos composiciones distintas según sea táctil o con mouse.
- Hay botones táctiles chicos: −/+ de octava de 11–20 px de ancho, switch del arpegiador de
  30×16.

**Causa raíz del layout ⚪ [V].**
- `App.css` tiene 6648 líneas en 7 capas apiladas, cada una ganando por orden de cascada.
- Hay 393 `!important`, 51 bloques `@media` y 18 condiciones distintas que se solapan.
- 163 selectores se definen más de una vez: `.circle-wrapper` declara `width` 19 veces y
  `.main-layout` declara `grid-template-columns` 13 veces.
- El círculo se dimensiona restando altos estimados del viewport en vez de medir el espacio que
  tiene.

Cada arreglo nuevo es una capa más y rompe algún tamaño que no se probó.

### Código muerto y confuso ⚪ [V]

- **Audio:**
  - `LoopingSampler`, resto de la etapa de samples, nunca se instancia.
  - `playNotes`, `playNotesStrum`, `releaseNotes`, `getAudioContext` y `getDirectOutput` no
    tienen llamadas.
  - Los setters de envolvente no hacen nada con Surge.
  - El metrónomo se construye pero no tiene UI.
  - La reverb y el chorus de Tone se reconfiguran en cada cambio de instrumento sin oírse.
- **Pantalla de "Activar audio":** quedó muerta, con su estado, su handler, su listener de
  resize y su CSS.
- **UI:**
  - `RecLoopHold` (unas 780 líneas) y `Metronome` existen, pero no se renderizan.
  - El panel de dedos es inalcanzable.
  - `KeySelector` se importa y no se usa.
  - Hay unas 1400 líneas de CSS que no estilan nada.
- **Componentes gigantes:** `FivoWorkspace` (`App.tsx`) tiene unas 1440 líneas, 45 `useState` y
  mezcla audio, arpegiador, teclado y layout. `ControlPanel.tsx` tiene 12 componentes.
- **Nombres y comentarios que mienten:**
  - `ep2Sampler` no es un sampler.
  - `useMobileFallback` en realidad significa "es mobile".
  - Los comentarios dan rangos de filtro de 200 Hz y 500 Hz, pero el real empieza en 1200 Hz.
  - Un comentario dice que el fader manda CC1/CC11/CC74, y no es así.
- **Backend:**
  - `bff/debug_server.js` y `bff/test_path.js` sobran.
  - `fivo_api.cpp` está vacío.
  - `internal_get_midi` no se usa.
- **Scripts:**
  - `build.sh` está roto en Unix: tiene CRLF en el shebang.
  - `build.bat` es legacy.
  - `build_manual.sh` corre los tests que fallan.
- **Repo:**
  - Hay fines de línea mezclados (CRLF y LF en el mismo archivo) en `App.tsx`,
    `ControlPanel.tsx` y `CircleOfFifths.tsx`. No hay `.gitattributes`.
  - No hay README propio; el de `frontend/` es la plantilla de Vite.
  - `DEPLOYMENT.md` describe cosas que no existen.
- **Debug en producción:** `?audioDebug` expone el motor en `window`, y quedan `console.log` en
  producción.

### Historia y regresiones [V]

- Entre `main` y producción **no se perdió nada aprobado**. El único cambio audible fue E-Bass,
  que en mobile pasó de 3 a 8 voces para sonar igual que en escritorio (`3af58b3`).
- La etapa de samples (WAV) nunca se commiteó; solo queda `LoopingSampler`. El tooling vivía
  fuera del repo (`tools/` está en `.gitignore`).
- La rama `fix/ios-audio-arranque` tiene dos cosas que valen la pena y no están en producción:
  - los errores del motor se muestran en pantalla, en lugar de un fallback silencioso;
  - el timeout de carga en mobile es de 45 s.
- `main` no es producción, y producción se publica desde una rama sin PR. **El próximo deploy
  desde `main` revierte todo el rediseño mobile.**

---

## 2. Plan propuesto

El orden importa. Cada paso deja una red que protege al siguiente.

### Fase 0: asegurar lo aprobado

Sin cambios visibles ni audibles.

1. **Unificar ramas:** mergear el estado de producción a `main` y publicar siempre desde `main`.
   Idealmente, conectar Vercel a GitHub.
2. **Rescatar la receta del WASM** de la máquina de Fabián: wrapper C, script de build y
   versiones de emsdk y Surge. Versionarla en el repo.
3. **Tests que congelan la lógica:**
   - Snapshot de las notas de `calcChordNotes` para las 24 tonalidades × 4 estilos × dedos ×
     power.
   - Snapshot de los colores del C++ (`/api/context` para todas las combinaciones).
   - Arreglar o actualizar `tests/test_main.cpp` y correrlo en el Dockerfile.
4. **Test de sonido:** renderizar offline (OfflineAudioContext o el WASM en Node) unos acordes
   por instrumento y guardar el hash o la envolvente. Cualquier cambio de código que altere el
   audio rompe el test.
5. **Test visual:** la matriz de viewports de esta auditoría, como regresión. El criterio es
   diff 0 en las pantallas aprobadas y 0 solapamientos en el resto.
6. Agregar `.gitattributes` (LF) y normalizar los fines de línea en un commit propio, sin otros
   cambios.

### Fase 1: limpiar sin cambiar comportamiento

Cada paso se valida con los tests de la fase 0.

- Borrar el código muerto: `LoopingSampler`, el gate de audio, `RecLoopHold`/`Metronome` si se
  confirma que no vuelven, el CSS sin uso, los scripts legacy y los archivos de debug.
- Partir `FivoWorkspace` en hooks: audio, arpegiador, teclado y layout.
- Corregir los nombres y comentarios que mienten.
- Arreglar los bugs H7–H11, que no cambian el sonido aprobado.
- Hacer visible el fallback (H6): avisar en pantalla en lugar de cambiar de sonido en silencio.
- Cerrar el CORS a los dominios propios.

### Fase 2: layout robusto con la misma estética

- Pocos modos de layout, excluyentes: vertical, apaisado/escritorio y tablet compacta.
- Tokens con los valores que hoy ganan la cascada.
- El círculo dimensionado por su contenedor (container queries) en lugar de `100dvh - Npx`.
- La marca dentro del grid.
- Reescribir `App.css` por componente, sin `!important`.
- Arreglar H14 y, una vez definido con el cliente, H15.

### Fase 3: decisiones con el cliente

- **Jazzy (H1):** ¿suena como hoy o como los voicings del C++?
- **Teléfono apaisado (H15):** ¿qué diseño lleva?
- **Licencia GPL (H13)** antes de cobrar.
- **Backend:** ¿se mantiene, o los colores pasan a una tabla en el front (H2)? Esto elimina la
  dependencia de Railway para tocar.

### Base para MIDI y DAW (después de la fase 1)

Todas las notas pasan por `AudioEngine` (`noteOn`/`noteOff` hacia el worklet). Ese es el punto
único para agregar una salida MIDI (Web MIDI API) sin tocar el sonido: un emisor en paralelo al
worklet. Conviene hacerlo con `AudioEngine` ya separado y con los tests de la fase 0 en verde.
