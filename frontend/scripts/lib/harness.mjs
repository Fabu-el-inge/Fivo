// Piezas compartidas por las regresiones (visual-diff, audio-trace): compilar
// un commit de referencia y el arbol actual, servirlos, y simular el backend.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTEXT_TABLE } from '../../src/api/contextTable.ts';

export const FRONTEND = fileURLToPath(new URL('../..', import.meta.url));
const REPO = resolve(FRONTEND, '..');

// 8773277 = lo publicado en fivo.subestatica.com al 08/10/2026. Cuando se
// apruebe un cambio visible, actualizar esta referencia.
export const APPROVED_REF = '8773277';

export const cliArgs = () => {
  const args = process.argv.slice(2);
  return (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
};

const sh = (cmd, cmdArgs, cwd) => execFileSync(cmd, cmdArgs, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString();

export function buildBase(ref) {
  const dir = mkdtempSync(join(tmpdir(), 'fivo-base-'));
  sh('git', ['worktree', 'add', '--detach', dir, ref], REPO);
  symlinkSync(join(FRONTEND, 'node_modules'), join(dir, 'frontend', 'node_modules'));
  sh('npx', ['vite', 'build', '--outDir', join(dir, 'dist-out'), '--emptyOutDir'], join(dir, 'frontend'));
  return { dist: join(dir, 'dist-out'), cleanup: () => sh('git', ['worktree', 'remove', '--force', dir], REPO) };
}

export function buildCurrent() {
  const dist = mkdtempSync(join(tmpdir(), 'fivo-cur-'));
  sh('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir'], FRONTEND);
  return { dist, cleanup: () => rmSync(dist, { recursive: true, force: true }) };
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.fxp': 'application/octet-stream' };
export function serve(dist) {
  return new Promise((ok) => {
    const server = createServer((req, res) => {
      let path = join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!existsSync(path) || !extname(path)) path = join(dist, 'index.html');
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
      res.end(readFileSync(path));
    });
    server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() }));
  });
}

// El backend se responde localmente: las capturas no dependen de la red y no
// gastan el rate limit de produccion (600 pedidos cada 15 min por IP).
// /context sale de la tabla verificada contra el motor C++ (ojo: base y actual
// reciben la misma tabla, asi que esto no compara colores: eso lo hacen
// tests/api y gen-context-table --check). /chord solo responde G mayor.
export async function fakeBackend(route) {
  const url = new URL(route.request().url());
  if (url.pathname.endsWith('/context')) {
    const mode = url.searchParams.get('lite') === 'true' ? 'lite' : 'full';
    const [major, minor] = CONTEXT_TABLE[mode][url.searchParams.get('style')][url.searchParams.get('key')];
    const asMap = (colors) => Object.fromEntries(colors.map((c, i) => [String(i), c]));
    return route.fulfill({ json: { key: 0, style: url.searchParams.get('style'), map: asMap(major), minorMap: asMap(minor) } });
  }
  if (url.pathname.endsWith('/chord') && url.searchParams.get('root') === 'G' && url.searchParams.get('minor') !== 'true') {
    // Respuesta real de produccion para G en C (pop, LITE), para que se dibuje la lectura.
    return route.fulfill({ json: { key: 0, root: 7, isMinor: false, isPower: false, fingers: 3, style: 'Pop', color: 'GREEN (Safe)', colorCode: 2, relation: 'DOMINANT', fifthDistance: 1, notes: [55, 59, 62] } });
  }
  return route.fulfill({ status: 503, json: { error: 'sin backend en la regresion visual' } });
}

