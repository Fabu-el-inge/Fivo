// Regresion de la logica de audio del host (audio.ts + App.tsx): corre el
// mismo guion de interacciones (mouse, teclado y touch) contra el commit
// aprobado y contra el arbol actual, registra cada mensaje que llega al
// AudioWorklet de Surge (noteOn/noteOff/hold/instrument/panic/gain) y compara
// las secuencias. Junto con tests/audio (que congela lo que el worklet hace
// con esos mensajes) cubre la cadena completa de lo que suena.
//
//   npm run test:audio-trace [-- --base <commit>] [--out dir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { APPROVED_REF, buildBase, buildCurrent, cliArgs, fakeBackend, serve } from './lib/harness.mjs';

const arg = cliArgs();
const base = arg('--base') ?? APPROVED_REF;
const outDir = resolve(arg('--out') ?? join(tmpdir(), 'fivo-audio-trace'));

// Registra lo que se manda al worklet. Corre antes que la app.
const RECORDER = () => {
  window.__trace = [];
  const original = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (msg, ...rest) {
    if (msg && typeof msg.type === 'string' && msg.type !== 'debug') {
      const entry = { type: msg.type };
      for (const k of ['instrument', 'notes', 'velocity', 'enabled', 'value']) if (k in msg) entry[k] = msg[k];
      window.__trace.push(entry);
    }
    return original.call(this, msg, ...rest);
  };
};

const sleep = (page, ms) => page.waitForTimeout(ms);
const mark = (page, label) => page.evaluate((l) => window.__trace.push({ mark: l }), label);

// Punto dentro del segmento [data-note] pedido (el centro del bbox de un arco
// no siempre cae adentro).
async function pointOn(page, note, minor) {
  return page.evaluate(([n, m]) => {
    const group = document.querySelector(`[data-note="${n}"][data-minor="${m}"]`);
    const b = group.getBoundingClientRect();
    for (let fy = 0.5; fy < 1; fy += 0.1) for (let fx = 0.5; fx < 1; fx += 0.1) {
      for (const [x, y] of [[b.left + b.width * fx, b.top + b.height * fy], [b.left + b.width * (1 - fx), b.top + b.height * (1 - fy)]]) {
        if (document.elementFromPoint(x, y)?.closest('[data-note]') === group) return { x, y };
      }
    }
    throw new Error(`sin punto para ${n}`);
  }, [note, String(minor)]);
}

async function mousePlay(page, note, minor, ms) {
  const p = await pointOn(page, note, minor);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await sleep(page, ms);
  await page.mouse.up();
  await sleep(page, 250);
}

async function keyPlay(page, key, ms, shift = false) {
  if (shift) await page.keyboard.down('Shift');
  await page.keyboard.down(key);
  await sleep(page, ms);
  await page.keyboard.up(key);
  if (shift) await page.keyboard.up('Shift');
  await sleep(page, 250);
}

const DESKTOP = async (page) => {
  await mark(page, 'mouse: acorde G');
  await mousePlay(page, 'G', false, 500);
  await mark(page, 'mouse: acorde menor Em');
  await mousePlay(page, 'Em', true, 400);
  await mark(page, 'teclado: z, x, Shift+c');
  await keyPlay(page, 'z', 400);
  await keyPlay(page, 'x', 300);
  await keyPlay(page, 'c', 300, true);
  await mark(page, 'glide C -> G -> D');
  {
    const c = await pointOn(page, 'C', false); const g = await pointOn(page, 'G', false); const d = await pointOn(page, 'D', false);
    await page.mouse.move(c.x, c.y); await page.mouse.down(); await sleep(page, 200);
    await page.mouse.move(g.x, g.y, { steps: 4 }); await sleep(page, 200);
    await page.mouse.move(d.x, d.y, { steps: 4 }); await sleep(page, 200);
    await page.mouse.up(); await sleep(page, 300);
  }
  await mark(page, 'hold on, dos acordes, hold off');
  await page.click('.btn-hold'); await sleep(page, 200);
  await keyPlay(page, 'z', 300);
  await keyPlay(page, 'x', 300);
  await page.click('.btn-hold'); await sleep(page, 400);
  for (const inst of ['Messy', 'Canadians', 'E-Bass', 'EP2']) {
    await mark(page, `instrumento ${inst}`);
    await page.click(`text="${inst}"`); await sleep(page, 300);
    await keyPlay(page, 'z', 400);
    await keyPlay(page, 'v', 300, true);
  }
  await mark(page, 'octava +1');
  await page.click('button:has-text("+")'); await sleep(page, 800);
  await keyPlay(page, 'z', 300);
  await page.click('button:has-text("−"), button:has-text("-")'); await sleep(page, 800);
  await mark(page, 'jazzy');
  await page.click('.jazzy-switch'); await sleep(page, 200);
  await mousePlay(page, 'G', false, 300);
  await mousePlay(page, 'E', false, 300);
  await mousePlay(page, 'Dm', true, 300);
  await page.click('.jazzy-switch'); await sleep(page, 300);
  await mark(page, 'arp: Up a 120, mantener z');
  await page.click('.arp-power-switch'); await sleep(page, 300);
  await page.keyboard.down('z'); await sleep(page, 1600); await page.keyboard.up('z');
  await sleep(page, 400);
  await page.click('.arp-power-switch'); await sleep(page, 300);
};

// Touch real por CDP (start / move / end con identificadores).
const MOBILE = async (page) => {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const pt = async (note, minor, id) => ({ ...(await pointOn(page, note, minor)), id });
  await mark(page, 'touch: acorde C');
  await touch('touchStart', [await pt('C', false, 1)]); await sleep(page, 400);
  await touch('touchEnd', []); await sleep(page, 300);
  await mark(page, 'touch: toque corto G (minimo 140 ms)');
  await touch('touchStart', [await pt('G', false, 2)]); await sleep(page, 30);
  await touch('touchEnd', []); await sleep(page, 400);
  await mark(page, 'touch: dos dedos C + Am');
  const a = await pt('C', false, 3); const b = await pt('Am', true, 4);
  await touch('touchStart', [a]); await sleep(page, 50);
  await touch('touchStart', [a, b]); await sleep(page, 400);
  await touch('touchEnd', [a]); await sleep(page, 100);
  await touch('touchEnd', []); await sleep(page, 300);
  await mark(page, 'touch: glide F -> C -> G');
  const f = await pt('F', false, 5); const c = await pt('C', false, 5); const g = await pt('G', false, 5);
  await touch('touchStart', [f]); await sleep(page, 200);
  await touch('touchMove', [c]); await sleep(page, 200);
  await touch('touchMove', [g]); await sleep(page, 200);
  await touch('touchEnd', []); await sleep(page, 300);
};

async function trace(browser, url, { name, viewport, touch, script }) {
  const ctx = await browser.newContext({ viewport, isMobile: touch, hasTouch: touch });
  await ctx.route(/\/api\/(context|chord)/, fakeBackend);
  await ctx.addInitScript(RECORDER);
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('.circle-svg');
  // Primer gesto: arranca el audio y carga Surge. Se descarta del registro.
  await page.keyboard.down('m'); await sleep(page, 100); await page.keyboard.up('m');
  await page.waitForFunction(() => window.__trace.some((m) => m.type === 'gain'), null, { timeout: 30000 });
  await sleep(page, touch ? 6000 : 3000);
  await page.evaluate(() => { window.__trace = []; });
  await script(page);
  await sleep(page, 500);
  const result = await page.evaluate(() => window.__trace);
  await ctx.close();
  return result;
}

const SUITES = [
  { name: 'escritorio', viewport: { width: 1280, height: 800 }, touch: false, script: DESKTOP },
  { name: 'mobile', viewport: { width: 390, height: 844 }, touch: true, script: MOBILE },
];

const fmt = (m) => (m.mark ? `## ${m.mark}` : JSON.stringify(m));

// Las secciones "arp:" dependen de timers: se compara la secuencia de las
// primeras 4 notas del arpegio (el arranque se alinea a una grilla global, asi que en el mismo tiempo entran 5 o 6 pasos), no la cantidad exacta de pasos.
function normalize(lines) {
  const out = [];
  let arp = null;
  for (const l of lines) {
    if (l.startsWith('## ')) {
      if (arp) out.push(`arp noteOn: ${arp.slice(0, 4).join(' ')}`);
      arp = l.startsWith('## arp:') ? [] : null;
      out.push(l);
    } else if (arp) {
      if (l.includes('"noteOn"')) arp.push(JSON.parse(l).notes.join('.'));
    } else out.push(l);
  }
  if (arp) out.push(`arp noteOn: ${arp.slice(0, 4).join(' ')}`);
  return out;
}

mkdirSync(outDir, { recursive: true });
const baseBuild = buildBase(base);
const curBuild = buildCurrent();
const [baseServer, curServer] = await Promise.all([serve(baseBuild.dist), serve(curBuild.dist)]);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
let failed = false;
try {
  for (const suite of SUITES) {
    const curRaw = (await trace(browser, curServer.url, suite)).map(fmt);
    const refRaw = (await trace(browser, baseServer.url, suite)).map(fmt);
    writeFileSync(join(outDir, `${suite.name}.actual.txt`), curRaw.join('\n') + '\n');
    writeFileSync(join(outDir, `${suite.name}.base.txt`), refRaw.join('\n') + '\n');
    const cur = normalize(curRaw);
    const ref = normalize(refRaw);
    const notes = cur.filter((l) => l.includes('"noteOn"')).length;
    let first = -1;
    for (let i = 0; i < Math.max(cur.length, ref.length); i++) if (cur[i] !== ref[i]) { first = i; break; }
    if (first < 0) {
      console.log(`ok    ${suite.name}: ${cur.length} mensajes iguales (${notes} noteOn)`);
    } else {
      failed = true;
      console.log(`FALLA ${suite.name}: difiere en el mensaje ${first}`);
      console.log(`  base:   ${ref[first] ?? '(fin)'}`);
      console.log(`  actual: ${cur[first] ?? '(fin)'}`);
    }
  }
} finally {
  await browser.close();
  baseServer.close();
  curServer.close();
  baseBuild.cleanup();
  curBuild.cleanup();
}
console.log(`\ntrazas en ${outDir}`);
process.exit(failed ? 1 : 0);
