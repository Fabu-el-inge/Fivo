# MIDI en Fivo (versión de prueba)

Abrí **https://fivo.subestatica.com/?midi=1**. Arriba a la derecha aparece el botón **MIDI**.

## Grabar y descargar un archivo MIDI (funciona en todos lados)

1. Tocá **MIDI** → **● Grabar**.
2. Tocá en Fivo como siempre. Podés cerrar el panel con el mismo botón **MIDI** y la grabación sigue:
   el punto naranja indica que está grabando.
3. **■ Parar** → **Descargar .mid**. En iPhone/iPad aparece también **Compartir**, que manda el archivo
   directo a GarageBand, a Archivos o por AirDrop. Usalo si Fivo está agregado a la pantalla de
   inicio, porque ahí la descarga directa puede no hacer nada.

Si grabás de nuevo, la toma anterior sigue disponible hasta que termines la nueva.

El archivo trae las notas que sonaron, con la octava y el instrumento elegidos. El tempo es el del
arpegiador (120 por defecto), así cae en la grilla de la DAW.

- **GarageBand en Mac:** arrastrá el `.mid` a una pista. Se crea una pista de instrumento de software
  y elegís el sonido.
- **GarageBand en iPhone/iPad:** el archivo queda en *Archivos* → *Descargas*. En GarageBand, vista de
  pistas → botón de bucles → *Archivos* → *Explorar ítems desde la app Archivos*. Se importa como
  región MIDI.
- **Logic, Ableton, FL, Reaper, etc.:** arrastrar el archivo a la línea de tiempo.

## Mandar MIDI en vivo a una DAW (Chrome o Edge en la compu)

Safari no tiene MIDI en vivo, en ningún dispositivo de Apple. Para tocar en vivo hace falta Chrome o
Edge.

**Mac + GarageBand o Logic (una sola vez):**
1. Abrí *Configuración de Audio MIDI*. Si no ves la ventana, menú *Ventana* → *Mostrar estudio MIDI*.
2. Doble clic en **IAC Driver** → marcá **"El dispositivo está en línea"** → Aplicar.

**Cada vez:**
1. En Chrome: **MIDI** → **Conectar MIDI**. Aceptá el permiso y elegí **IAC Driver Bus 1**.
2. En GarageBand, creá una pista de instrumento de software y armala para grabar.
   Lo que toques en Fivo suena con el instrumento de GarageBand y se puede grabar ahí.

**Windows:** instalar un puerto virtual (por ejemplo, loopMIDI), elegirlo en Fivo y como entrada en
la DAW.

Al quitar la salida o cerrar la página, Fivo apaga las notas que hayan quedado sonando en la DAW.
