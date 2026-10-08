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

**Windows (Chrome o Edge):** Windows no trae un puerto MIDI virtual como el IAC de Mac.
1. Una sola vez: instalar **loopMIDI** (gratis, de Tobias Erichsen), abrirlo y tocar **+** para crear
   un puerto ("loopMIDI Port"). Tiene que estar abierto mientras se usa.
2. En Fivo: **MIDI** → **Conectar MIDI** → elegir **loopMIDI Port**.
3. En la DAW, habilitar ese puerto como entrada (ver abajo).

## Habilitar la entrada en cada DAW

El esquema es siempre el mismo: Fivo manda por un puerto MIDI (IAC en Mac, loopMIDI en Windows) y
la DAW lo escucha como si fuera un teclado. Cambia solo dónde se habilita la entrada:

| DAW | Dónde |
|---|---|
| Logic, GarageBand | Nada: escuchan todas las entradas. Pista de instrumento de software armada |
| Ableton Live | *Settings → Link, Tempo & MIDI → MIDI Ports*: en la entrada del puerto activar **Track**. Pista MIDI con monitor en *Auto* o *In* |
| Pro Tools | *Setup → MIDI → Input Devices* (Mac) o *MIDI Input Enable* (Windows): marcar el puerto. Pista de instrumento con entrada *All* o el puerto |
| FL Studio | *Options → MIDI settings → Input*: seleccionar el puerto y **Enable** |
| Reaper | *Preferences → Audio → MIDI Devices*: habilitar la entrada del puerto. Pista armada con entrada MIDI |
| Cubase | *Studio → Studio Setup → MIDI Port Setup*: marcar el puerto en *In 'All MIDI Inputs'* |

Si hay un sinte o un teclado MIDI conectado a la compu por USB, también aparece en la lista de
Fivo y se puede mandar directo a él.

## Si algo no anda

- **La lista de salidas está vacía:** falta el puerto virtual (IAC en línea en Mac, loopMIDI abierto
  en Windows). Después de crearlo, recargá Fivo.
- **"El navegador bloqueó el MIDI":** tocá el candado de la barra de direcciones → *Dispositivos
  MIDI* → *Permitir* → recargá.
- **La DAW no suena:** la pista tiene que estar armada o en monitoreo, y la entrada habilitada
  (tabla de arriba).
- **"La salida MIDI dejó de responder":** se desconectó el dispositivo o se cerró loopMIDI. Volvé a
  elegir la salida. Fivo sigue sonando igual.
- **Notas duplicadas o que se realimentan:** la DAW está mandando su salida MIDI de vuelta al mismo
  puerto (por ejemplo, una pista con salida a IAC). Desactivá esa salida.
- **Safari (Mac, iPhone, iPad):** no tiene MIDI en vivo. Usá Chrome o Edge, o grabá y descargá el
  archivo, que funciona en todos lados.
- **Firefox:** tiene MIDI en vivo, pero lo pide como un complemento de permisos del sitio. Aceptalo
  y recargá.

Al quitar la salida o cerrar la página, Fivo apaga las notas que hayan quedado sonando en la DAW.
