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
| `bff/` | Express. Ejecuta el binario C++ para la lectura del acorde (`/api/chord`) y `/api/context` |
| `core/`, `demos/`, `tests/` | Motor musical en C++ (colores por estilo, voicings), CLI `fivo_demo` y tests |

## Desarrollo

```bash
cd frontend
npm ci
npm run dev            # http://localhost:5173
```

El BFF es opcional para tocar: los colores salen de `src/api/contextTable.ts`. En Windows,
`start.bat` compila el core y levanta todo.

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
- **Backend:** Railway, con el `Dockerfile` de la raíz. El build corre los tests del C++.
  Variables: `ALLOWED_ORIGINS` y `RATE_LIMIT_MAX` (ver `bff/.env.example`).
