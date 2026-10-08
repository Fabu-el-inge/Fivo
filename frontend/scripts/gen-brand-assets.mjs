// Genera los iconos y la imagen para compartir de Fivo en public/:
//   favicon.svg, favicon.ico (32 px), apple-touch-icon.png (180),
//   icon-192.png, icon-512.png, icon-maskable-512.png, og.png (1200x630).
//
//   node scripts/gen-brand-assets.mjs
//
// El icono es el circulo de quintas en C mayor tal como lo pinta la app
// (tonica azul arriba, vecinos verdes y naranjas, el resto apagado) con una
// F al centro. Los PNG se renderizan con Chrome (playwright-core) para usar
// las tipografias reales de la app en la imagen para compartir.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));

// Colores de App.css (:root).
const C = { bg: '#0c0c0e', panel: '#1c1c20', tonic: '#5694ff', safe: '#4ac878', tension: '#f5a23e', neutral: '#3a3a40', text: '#e8e8ec' };

// Segmentos en orden del circulo desde arriba (C, G, D, A, E, B, Gb, Db, Ab, Eb, Bb, F).
const RING = [C.tonic, C.safe, C.tension, C.tension, C.tension, C.neutral, C.neutral, C.neutral, C.neutral, C.neutral, C.tension, C.safe];

function ringPaths(cx, cy, rOut, rIn, gapDeg) {
  const pt = (r, deg) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)].map(n => n.toFixed(2)).join(' ');
  };
  return RING.map((color, i) => {
    const a0 = i * 30 - 15 + gapDeg / 2;
    const a1 = i * 30 + 15 - gapDeg / 2;
    return `<path d="M${pt(rOut, a0)} A${rOut} ${rOut} 0 0 1 ${pt(rOut, a1)} L${pt(rIn, a1)} A${rIn} ${rIn} 0 0 0 ${pt(rIn, a0)} Z" fill="${color}"/>`;
  }).join('');
}

// F geometrica (sin depender de una fuente), centrada en (cx, cy).
const letterF = (cx, cy, h, color) => {
  const w = h * 0.62;
  const s = h * 0.17;
  const x = cx - w / 2 + s * 0.15;
  const y = cy - h / 2;
  return `<path d="M${x} ${y}h${w}v${s}h${-(w - s)}v${h * 0.28}h${w * 0.82 - s}v${s}h${-(w * 0.82 - s)}v${h - s - h * 0.28 - s}h${-s}z" fill="${color}"/>`;
};

// size: lado del lienzo; pad: margen (para maskable); bg: fondo cuadrado o redondeado.
// compact: para la pestana (16-32 px): anillo mas grueso y F mas grande.
function iconSvg({ size = 64, pad = 0, rounded = true, compact = false } = {}) {
  const inner = size - pad * 2;
  const cx = size / 2;
  const rOut = inner * (compact ? 0.47 : 0.44);
  const rIn = inner * (compact ? 0.27 : 0.285);
  const bg = rounded
    ? `<rect width="${size}" height="${size}" rx="${size * 0.22}" fill="${C.bg}"/>`
    : `<rect width="${size}" height="${size}" fill="${C.bg}"/>`;
  const ring = ringPaths(cx, cx, rOut, rIn, compact ? 7 : 4);
  const center = compact ? '' : `<circle cx="${cx}" cy="${cx}" r="${rIn - inner * 0.035}" fill="${C.panel}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${bg}${ring}${center}${letterF(cx, cx, inner * (compact ? 0.36 : 0.27), C.text)}</svg>`;
}

const OG_HTML = `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=DM+Mono:wght@400&display=block" rel="stylesheet">
<style>
  html,body{margin:0;width:1200px;height:630px;background:${C.bg};overflow:hidden}
  body{display:flex;align-items:center;justify-content:center;gap:72px;font-family:'Space Grotesk',sans-serif;
       background:radial-gradient(ellipse 70% 90% at 30% 50%, #17171b 0%, ${C.bg} 70%)}
  .ring{width:340px;height:340px;filter:drop-shadow(0 0 40px rgba(86,148,255,.18))}
  .txt{display:flex;flex-direction:column;gap:18px}
  h1{margin:0;font-size:150px;line-height:.9;font-weight:600;letter-spacing:.16em;color:${C.text}}
  p{margin:0;font-family:'DM Mono',monospace;font-size:24px;letter-spacing:.32em;color:#84848e}
  .bar{width:64px;height:4px;border-radius:2px;background:#ff7a3c}
</style></head><body>
  <div class="ring">${iconSvg({ size: 340, rounded: false }).replace(`<rect width="340" height="340" fill="${C.bg}"/>`, '')}</div>
  <div class="txt"><div class="bar"></div><h1>FIVO</h1><p>HARMONIC INSTRUMENT · MK1</p></div>
</body></html>`;

// ICO con un PNG adentro (valido desde Windows Vista y en todos los navegadores).
function pngToIco(png, size) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(size >= 256 ? 0 : size, 6);
  header.writeUInt8(size >= 256 ? 0 : size, 7);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const shot = async (html, w, h, transparent = false) => {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  return page.screenshot({ type: 'png', omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
};
// Fondo transparente: las esquinas redondeadas no quedan con un cuadrado atras.
const raster = (svg, size) => shot(`<html><body style="margin:0;background:transparent">${svg}</body></html>`, size, size, true);

writeFileSync(PUBLIC + 'favicon.svg', iconSvg({ size: 64, compact: true }) + '\n');
writeFileSync(PUBLIC + 'favicon.ico', pngToIco(await raster(iconSvg({ size: 32, compact: true }), 32), 32));
writeFileSync(PUBLIC + 'apple-touch-icon.png', await raster(iconSvg({ size: 180, rounded: false }), 180));
writeFileSync(PUBLIC + 'icon-192.png', await raster(iconSvg({ size: 192 }), 192));
writeFileSync(PUBLIC + 'icon-512.png', await raster(iconSvg({ size: 512 }), 512));
writeFileSync(PUBLIC + 'icon-maskable-512.png', await raster(iconSvg({ size: 512, pad: 512 * 0.1, rounded: false }), 512));
writeFileSync(PUBLIC + 'og.png', await shot(OG_HTML, 1200, 630));
await browser.close();
console.log('listo: favicon.svg, favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png, icon-maskable-512.png, og.png');
