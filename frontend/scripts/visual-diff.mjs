// Regresion visual: compara pixel a pixel el front actual contra un commit de
// referencia (el aprobado) en una matriz de pantallas, y mide problemas de
// layout (solapamientos, controles fuera de vista, desbordes).
//
//   npm run test:visual [-- --base <commit>] [--only 390x844,1280x800] [--out dir]
//
// Sin --base compara contra APPROVED_REF: el ultimo estado aprobado por el
// cliente. Cuando se apruebe un cambio visual, actualizar APPROVED_REF.
//
// Necesita Google Chrome instalado (playwright-core usa el canal "chrome").
// Las pantallas marcadas `approved` tienen que dar 0 pixeles con cambio fuerte.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { CONTEXT_TABLE } from '../src/api/contextTable.ts';

const FRONTEND = fileURLToPath(new URL('..', import.meta.url));
const REPO = resolve(FRONTEND, '..');

// [nombre, ancho, alto, tactil, aprobada]
export const VIEWPORTS = [
  ['375x667', 375, 667, true, false],
  ['390x844', 390, 844, true, true],
  ['430x932', 430, 932, true, true],
  ['390x664-barras-safari', 390, 664, true, false],
  ['667x375', 667, 375, true, false],
  ['844x390', 844, 390, true, false],
  ['932x430', 932, 430, true, false],
  ['744x1133', 744, 1133, true, true],
  ['768x1024', 768, 1024, true, true],
  ['820x1180', 820, 1180, true, true],
  ['1024x1366', 1024, 1366, true, false],
  ['1024x768', 1024, 768, true, true],
  ['1180x820', 1180, 820, true, true],
  ['1366x1024', 1366, 1024, true, false],
  ['1024x1366-mouse', 1024, 1366, false, false],
  ['1366x1024-mouse', 1366, 1024, false, false],
  ['1250x700', 1250, 700, false, false],
  ['1280x800', 1280, 800, false, true],
  ['1440x900', 1440, 900, false, true],
  ['1920x1080', 1920, 1080, false, true],
];

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
// 8773277 = lo publicado en fivo.subestatica.com al 08/10/2026.
const APPROVED_REF = '8773277';
const base = arg('--base') ?? APPROVED_REF;
const only = arg('--only')?.split(',');
const outDir = resolve(arg('--out') ?? join(tmpdir(), 'fivo-visual'));

const sh = (cmd, cmdArgs, cwd) => execFileSync(cmd, cmdArgs, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString();

function buildBase(ref) {
  const dir = mkdtempSync(join(tmpdir(), 'fivo-base-'));
  sh('git', ['worktree', 'add', '--detach', dir, ref], REPO);
  symlinkSync(join(FRONTEND, 'node_modules'), join(dir, 'frontend', 'node_modules'));
  sh('npx', ['vite', 'build', '--outDir', join(dir, 'dist-out'), '--emptyOutDir'], join(dir, 'frontend'));
  return { dist: join(dir, 'dist-out'), cleanup: () => sh('git', ['worktree', 'remove', '--force', dir], REPO) };
}

function buildCurrent() {
  const dist = mkdtempSync(join(tmpdir(), 'fivo-cur-'));
  sh('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir'], FRONTEND);
  return { dist, cleanup: () => rmSync(dist, { recursive: true, force: true }) };
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.fxp': 'application/octet-stream' };
function serve(dist) {
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

// Problemas medibles de layout en la pantalla actual.
function measureIssues() {
  const vh = innerHeight;
  const vw = innerWidth;
  const de = document.documentElement;
  const issues = [];
  if (de.scrollWidth > vw + 1) issues.push(`scroll horizontal (${de.scrollWidth}px)`);
  const docH = Math.max(de.scrollHeight, document.body.scrollHeight);
  if (docH > vh + 1) issues.push(`scroll vertical (${docH - vh}px)`);
  const visible = (e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none';
  const blocks = ['.circle-wrapper', '.wheel-bottom-row', '.effects-box', '.arpeggiator-control', '.rec-instrument-row', '.jazzy-control', '.app-header']
    .map((s) => [s, document.querySelector(s)]).filter(([, e]) => e && visible(e));
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
    const [sa, a] = blocks[i]; const [sb, b] = blocks[j];
    if (a.contains(b) || b.contains(a)) continue;
    const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect();
    const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
    const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (ox > 2 && oy > 2) issues.push(`solapa ${sa} con ${sb} (${Math.round(ox)}x${Math.round(oy)})`);
  }
  const controls = [...document.querySelectorAll('.app-container button, .app-container input, .knob-control, .vfader-track')].filter(visible);
  let below = 0;
  for (const c of controls) if (c.getBoundingClientRect().top > vh) below++;
  if (below) issues.push(`${below} controles bajo el pliegue`);
  return issues;
}

// El backend se responde localmente: las capturas no dependen de la red y no
// gastan el rate limit de produccion (600 pedidos cada 15 min por IP).
// /context sale de la tabla verificada contra el motor C++; /chord no hace
// falta para la pantalla inicial.
async function fakeBackend(route) {
  const url = new URL(route.request().url());
  if (url.pathname.endsWith('/context')) {
    const mode = url.searchParams.get('lite') === 'true' ? 'lite' : 'full';
    const [major, minor] = CONTEXT_TABLE[mode][url.searchParams.get('style')][url.searchParams.get('key')];
    const asMap = (colors) => Object.fromEntries(colors.map((c, i) => [String(i), c]));
    return route.fulfill({ json: { key: 0, style: url.searchParams.get('style'), map: asMap(major), minorMap: asMap(minor) } });
  }
  return route.fulfill({ status: 503, json: { error: 'sin backend en la regresion visual' } });
}

async function shoot(browser, url, [name, w, h, touch]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: touch, hasTouch: touch, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await ctx.route(/\/api\/(context|chord)/, fakeBackend);
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('.circle-svg', { timeout: 20000 });
  // Los colores del circulo pueden llegar tarde (en el commit base vienen del
  // backend): sin esta espera, la captura sale gris y el diff es ruido.
  await page.waitForFunction(() => document.querySelector('.circle-svg')?.outerHTML.includes('--color-safe'), null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  const png = await page.screenshot({ fullPage: true, animations: 'disabled' });
  const issues = await page.evaluate(measureIssues);
  await ctx.close();
  writeFileSync(join(outDir, `${name}.png`), png);
  return { png, issues };
}

async function diffPixels(browser, a, b) {
  const page = await browser.newPage();
  const result = await page.evaluate(async ([pa, pb]) => {
    const STRONG = 80;
    const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = `data:image/png;base64,${src}`; });
    const [ia, ib] = await Promise.all([load(pa), load(pb)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return { size: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}` };
    const data = (img) => { const c = new OffscreenCanvas(img.width, img.height); const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, img.width, img.height).data; };
    const da = data(ia); const db = data(ib);
    let strong = 0;
    let weak = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      if (d > STRONG) strong++;
      else if (d > 8) weak++;
    }
    return { strong, weak, total: da.length / 4 };
  }, [a.toString('base64'), b.toString('base64')]);
  await page.close();
  return result;
}

mkdirSync(join(outDir, 'base'), { recursive: true });
const baseBuild = buildBase(base);
const curBuild = buildCurrent();
const [baseServer, curServer] = await Promise.all([serve(baseBuild.dist), serve(curBuild.dist)]);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let failed = false;
try {
  for (const vp of VIEWPORTS.filter(([name]) => !only || only.includes(name))) {
    const [name, , , , approved] = vp;
    const cur = await shoot(browser, curServer.url, vp);
    const baseShot = await shoot(browser, baseServer.url, vp);
    writeFileSync(join(outDir, 'base', `${name}.png`), baseShot.png);
    writeFileSync(join(outDir, `${name}.png`), cur.png);
    const { strong, weak, total, size } = await diffPixels(browser, baseShot.png, cur.png);
    // El render de texto y degradados mete diferencias de pocos niveles entre
    // dos cargas del mismo codigo: se toleran hasta el 0,1% del area. Un cambio
    // real (algo que se corre o cambia de color) da pixeles "fuertes".
    const bad = approved && (Boolean(size) || strong > 0 || weak > total * 0.001);
    if (bad) failed = true;
    const delta = size ? `tamano distinto ${size}` : `${strong} fuertes, ${weak} leves`;
    console.log(`${bad ? 'FALLA' : approved ? 'ok   ' : '     '} ${name.padEnd(24)} ${delta.padEnd(28)} ${cur.issues.join('; ') || 'sin problemas'}`);
  }
} finally {
  await browser.close();
  baseServer.close();
  curServer.close();
  baseBuild.cleanup();
  curBuild.cleanup();
}
console.log(`\ncapturas en ${outDir} (base/ = ${base})`);
process.exit(failed ? 1 : 0);
