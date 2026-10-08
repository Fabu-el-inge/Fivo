# Fivo

Círculo de quintas interactivo: acordes coloreados por consonancia, estilos (pop / Jazzy),
arpegiador y strum, con sonido de Surge XT compilado a WebAssembly.

- **En línea:** https://fivo.subestatica.com
- **Arquitectura y lo que está aprobado:** [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md)
- **Auditoría y plan:** [docs/AUDITORIA-2026-10.md](docs/AUDITORIA-2026-10.md)

## Partes

| Carpeta | Qué es |
|---|---|
| `frontend/` | React + Vite + TS. Toda la lógica que suena y el motor Surge (`public/surge/`) |
| `core/`, `demos/`, `tests/` | Motor musical en C++ (colores por estilo, voicings), CLI `fivo_demo` y tests. Es la fuente de verdad; el front usa derivados verificados (`contextTable.ts`, `engine.ts`) |
| `bff/` | Express que expone el binario por HTTP. Solo para desarrollo: producción no usa backend |

## Desarrollo

```bash
cd frontend
npm ci
npm run dev            # http://localhost:5173
```

No hace falta levantar ningún backend. En Windows, `start.bat` compila el core y levanta el BFF, por
si se quiere comparar contra el binario.

## Antes de cada cambio

```bash
cd frontend
npm test                    # notas, colores y sonido real de Surge (Node)
npm run test:audio-trace    # lo que se le manda al motor, contra el commit aprobado
npm run test:visual         # 20 pantallas + estados, pixel a pixel contra el aprobado
```

Las dos últimas necesitan Google Chrome instalado. Si algo cambia lo que suena o se ve en una
pantalla aprobada, el test falla: eso es lo que protege lo que el cliente ya aprobó.

## Deploy

- **Front:** Vercel, proyecto `fivo-ios-test` (`frontend/.vercel/`), por CLI desde `frontend/`.
  Antes de publicar, comprobar que el build sea el esperado (ver
  [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md), sección 8).
- **Backend:** no hay. Fivo corre entero en el navegador (desde el 08/10/2026). El `Dockerfile` y
  `railway.toml` siguen en el repo por si hiciera falta volver a exponer el motor por HTTP.
