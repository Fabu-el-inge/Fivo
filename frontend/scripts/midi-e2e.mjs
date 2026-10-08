// Prueba de punta a punta del MIDI (panel con ?midi=1) en Chrome:
//  1. Graba mientras se toca, descarga el .mid y verifica que tenga las mismas
//     notas, en el mismo orden, que los noteOn que recibio el motor de sonido.
//  2. Con un puerto MIDI simulado, verifica que los bytes enviados en vivo
//     correspondan a lo tocado y que al salir no quede nada sonando.
//
//   npm run test:midi [-- --out dir]
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { buildCurrent, cliArgs, serve } from './lib/harness.mjs';

const outDir = resolve(cliArgs()('--out') ?? join(tmpdir(), 'fivo-midi'));
mkdirSync(outDir, { recursive: true });

// Registra lo que llega al worklet y simula un puerto MIDI.
const INIT = () => {
  window.__worklet = [];
  window.__midiOut = [];
  const original = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (msg, ...rest) {
    if (msg && (msg.type === 'noteOn' || msg.type === 'noteOff' || msg.type === 'panic')) {
      window.__worklet.push({ type: msg.type, notes: msg.notes ?? [], velocity: msg.velocity });
    }
    return original.call(this, msg, ...rest);
  };
  const port = { id: 'fake', name: 'Puerto de prueba', send: (data) => window.__midiOut.push([...data]) };
  navigator.requestMIDIAccess = async () => ({ outputs: new Map([['fake', port]]), onstatechange: null });
};

function readMidi(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.slice(0, 4)) !== 'MThd') throw new Error('no es un .mid');
  let p = 22;
  const end = p + dv.getUint32(18);
  const vlq = () => { let v = 0; let b; do { b = bytes[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
  const notes = [];
  let tick = 0;
  let tempo = 0;
  while (p < end) {
    tick += vlq();
    const status = bytes[p++];
    if (status === 0xff) {
      const type = bytes[p++];
      const len = vlq();
      if (type === 0x51) tempo = (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2];
      p += len;
    } else {
      notes.push({ on: (status & 0xf0) === 0x90, note: bytes[p], velocity: bytes[p + 1], tick });
      p += 2;
    }
  }
  return { notes, tempo, ppq: dv.getUint16(12) };
}

async function play(page) {
  for (const [key, ms, shift] of [['z', 400], ['x', 300], ['c', 300, true], ['v', 250], ['b', 350]]) {
    if (shift) await page.keyboard.down('Shift');
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    if (shift) await page.keyboard.up('Shift');
    await page.waitForTimeout(150);
  }
}

const build = buildCurrent();
const server = await serve(build.dist);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
let failed = false;
const check = (ok, label) => { console.log(`${ok ? 'ok   ' : 'FALLA'} ${label}`); if (!ok) failed = true; };

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  await page.goto(`${server.url}?midi=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.circle-svg');

  // Arranca el motor fuera de la grabacion.
  await page.keyboard.down('m');
  await page.waitForFunction(() => window.__worklet.length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.keyboard.up('m');
  await page.waitForTimeout(400);

  await page.click('.midi-panel-toggle');
  await page.screenshot({ path: join(outDir, 'panel.png') });

  // 1. Grabar y descargar
  await page.evaluate(() => { window.__worklet = []; });
  await page.click('text="● Grabar"');
  await play(page);
  await page.click('text="■ Parar"');
  const worklet = await page.evaluate(() => window.__worklet);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('.midi-download')]);
  const file = join(outDir, download.suggestedFilename());
  await download.saveAs(file);
  const midi = readMidi(new Uint8Array(readFileSync(file)));
  const expectedOn = worklet.filter(m => m.type === 'noteOn').flatMap(m => m.notes);
  const fileOn = midi.notes.filter(n => n.on).map(n => n.note);
  check(/^fivo-\d{8}-\d{4}\.mid$/.test(download.suggestedFilename()), `nombre del archivo: ${download.suggestedFilename()}`);
  check(midi.tempo === 500000 && midi.ppq === 480, 'tempo 120 bpm, 480 ticks por negra');
  check(fileOn.length > 0 && JSON.stringify(fileOn) === JSON.stringify(expectedOn), `notas del .mid = noteOn del motor (${fileOn.join(' ')})`);
  check(midi.notes.filter(n => n.on).length === midi.notes.filter(n => !n.on).length, 'cada nota tiene su noteOff');
  check(midi.notes[0]?.tick === 0, 'el archivo arranca en la primera nota');
  await page.screenshot({ path: join(outDir, 'grabado.png') });

  // 2. Salida en vivo
  await page.click('text="Conectar MIDI"');
  await page.selectOption('.midi-select', 'fake');
  await page.evaluate(() => { window.__worklet = []; window.__midiOut = []; });
  await play(page);
  const worklet2 = await page.evaluate(() => window.__worklet);
  const sent = await page.evaluate(() => window.__midiOut);
  const sentOn = sent.filter(b => (b[0] & 0xf0) === 0x90).map(b => b[1]);
  check(JSON.stringify(sentOn) === JSON.stringify(worklet2.filter(m => m.type === 'noteOn').flatMap(m => m.notes)), `bytes en vivo = noteOn del motor (${sentOn.length} notas)`);
  await page.selectOption('.midi-select', '');
  const after = await page.evaluate(() => window.__midiOut);
  check(after.some(b => b[0] === 0xb0 && b[1] === 123), 'al quitar la salida manda "all notes off"');

  // Sin ?midi=1 el panel no existe.
  await page.goto(server.url, { waitUntil: 'networkidle' });
  check(await page.locator('.midi-panel').count() === 0, 'sin ?midi=1 no hay panel');

  // Safari (sin Web MIDI): el panel lo explica en vez de romper.
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx2.addInitScript(() => { delete Navigator.prototype.requestMIDIAccess; });
  const mobile = await ctx2.newPage();
  await mobile.goto(`${server.url}?midi=1`, { waitUntil: 'networkidle' });
  await mobile.click('.midi-panel-toggle');
  check(await mobile.locator('text=Safari no lo soporta').count() === 1, 'sin Web MIDI se explica y se ofrece el archivo');
  await mobile.screenshot({ path: join(outDir, 'mobile.png') });
} finally {
  await browser.close();
  server.close();
  build.cleanup();
}
console.log(`\ncapturas y .mid en ${outDir}`);
process.exit(failed ? 1 : 0);
