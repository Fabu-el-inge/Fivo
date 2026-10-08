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
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { APPROVED_REF, buildBase, buildCurrent, cliArgs, fakeBackend, serve } from './lib/harness.mjs';

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

// Estados con interaccion, capturados en una pantalla de mobile y una de
// escritorio: cubren el cambio de estilo y de tonalidad (colores del circulo).
const STATES = [
  ['jazzy', async (page) => { await page.click('.jazzy-switch'); }],
  ['tonalidad-Am', async (page) => { await page.click('.circle-center'); await page.click('.key-option.minor >> text="Am"'); }],
  ['tonalidad-Eb-jazzy', async (page) => { await page.click('.jazzy-switch'); await page.click('.circle-center'); await page.click('.key-option:not(.minor) >> text="Eb"'); }],
];
const STATE_VIEWPORTS = ['390x844', '1280x800'];

const arg = cliArgs();
const base = arg('--base') ?? APPROVED_REF;
const only = arg('--only')?.split(',');
const outDir = resolve(arg('--out') ?? join(tmpdir(), 'fivo-visual'));

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

async function shoot(browser, url, [name, w, h, touch], action) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: touch, hasTouch: touch, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await ctx.route(/\/api\/(context|chord)/, fakeBackend);
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('.circle-svg', { timeout: 20000 });
  // Los colores del circulo pueden llegar tarde (en el commit base vienen del
  // backend): sin esta espera, la captura sale gris y el diff es ruido.
  await page.waitForFunction(() => document.querySelector('.circle-svg')?.outerHTML.includes('--color-safe'), null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  // Sin transiciones: se comparan estados finales, no el momento exacto de
  // una animacion (un switch a mitad de camino daba diferencias sueltas).
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  if (action) {
    await action(page);
    await page.mouse.click(1, 1);
  }
  await page.waitForTimeout(800);
  const png = await page.screenshot({ fullPage: true, animations: 'disabled' });
  const issues = await page.evaluate(measureIssues);
  await ctx.close();
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
  const runs = VIEWPORTS.map((vp) => ({ vp, name: vp[0], approved: vp[4] }));
  for (const [state, action] of STATES) for (const vpName of STATE_VIEWPORTS) {
    runs.push({ vp: VIEWPORTS.find(([n]) => n === vpName), name: `${vpName}-${state}`, approved: true, action });
  }
  for (const { vp, name, approved, action } of runs.filter(({ name }) => !only || only.some((o) => name.startsWith(o)))) {
    const cur = await shoot(browser, curServer.url, vp, action);
    const baseShot = await shoot(browser, baseServer.url, vp, action);
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
