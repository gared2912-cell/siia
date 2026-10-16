// Genera los archivos de marca a partir del logotipo vectorial (src/data/logo.ts, fiel a Siia/Logos):
// SVG del logotipo (public/marca), favicon, apple-touch-icon, logo PNG e imagen Open Graph.
import sharp from 'sharp';
import fs from 'node:fs';
import { logoColors, logoSvg, markSvg } from '../src/data/logo.ts';

const TEAL = logoColors.teal;
const render = (svg, width) => sharp(Buffer.from(svg), { density: 600 }).resize({ width });

// Logotipos SVG para <img> (portal, recibos) — nítidos a cualquier tamaño
fs.mkdirSync('public/marca', { recursive: true });
fs.writeFileSync('public/marca/siia-horizontal.svg', logoSvg('horizontal', 'color'));
fs.writeFileSync('public/marca/siia-horizontal-blanco.svg', logoSvg('horizontal', 'white'));
fs.writeFileSync('public/marca/siia-vertical.svg', logoSvg('stacked', 'color'));
fs.writeFileSync('public/marca/siia-vertical-blanco.svg', logoSvg('stacked', 'white'));
fs.writeFileSync('public/marca/isotipo.svg', markSvg(TEAL));
fs.writeFileSync('public/marca/isotipo-blanco.svg', markSvg('#ffffff'));

// Favicon con el isotipo
fs.writeFileSync('public/favicon.svg', markSvg(TEAL));
await render(markSvg(TEAL), 58)
  .resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile('public/favicon.png');

// apple-touch-icon: isotipo blanco sobre el teal de marca (como Logos/5.png)
const apple = await render(markSvg('#ffffff'), 112).toBuffer();
await sharp({ create: { width: 180, height: 180, channels: 4, background: TEAL } })
  .composite([{ input: apple, gravity: 'center' }])
  .png()
  .toFile('public/apple-touch-icon.png');

// Logo PNG para datos estructurados (JSON-LD), sobre blanco como Logos/4.png
const logoPng = await render(logoSvg('stacked', 'color'), 560).toBuffer();
await sharp({ create: { width: 640, height: 640, channels: 4, background: '#ffffff' } })
  .composite([{ input: logoPng, gravity: 'center' }])
  .png()
  .toFile('public/logo-siia.png');

// Logotipo horizontal a color en PNG (fondo transparente) para reportes de Excel del panel
await render(logoSvg('horizontal', 'color'), 900).png().toFile('public/marca/siia-horizontal.png');

// Open Graph 1200×630: foto + logotipo blanco, sin recuadro
const bg = await sharp('src/assets/fotos/acceso-fraccionamiento.webp').resize(1200, 630, { fit: 'cover' }).toBuffer();
const shade = Buffer.from(`<svg width="1200" height="630"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#1f2440" stop-opacity=".88"/><stop offset=".75" stop-color="#1f2440" stop-opacity=".45"/><stop offset="1" stop-color="#1f2440" stop-opacity=".2"/></linearGradient></defs><rect width="1200" height="630" fill="url(#g)"/>
<text x="70" y="440" font-family="Segoe UI, Arial" font-size="46" font-weight="700" fill="#fff">Administración de condominios</text>
<text x="70" y="498" font-family="Segoe UI, Arial" font-size="30" fill="#baf1ed">Transparente · Profesional · Tecnológica</text>
<text x="70" y="568" font-family="Segoe UI, Arial" font-size="26" fill="#ffffff">siia.casa</text></svg>`);
const logo = await render(logoSvg('stacked', 'white'), 260).toBuffer();
await sharp(bg)
  .composite([{ input: shade }, { input: logo, left: 64, top: 60 }])
  .jpeg({ quality: 86 })
  .toFile('public/og-siia.jpg');
console.log('ok');
