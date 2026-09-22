// Genera favicon, apple-touch-icon, logo PNG e imagen Open Graph a partir del logotipo vectorial (src/data/logo.ts).
import sharp from 'sharp';
import fs from 'node:fs';

const src = fs.readFileSync('src/data/logo.ts', 'utf8');
// Lee "  clave: valor," dentro del bloque "export const <obj> = { ... };"
const get = (obj, key) => {
  const block = src.split(`export const ${obj} = {`)[1].split('\n};')[0];
  const line = block.split('\n').find((l) => l.trim().startsWith(`${key}:`));
  return line.trim().slice(key.length + 1).trim().replace(/,$/, '').replace(/^'|'$/g, '');
};
const mark = { d: get('mark', 'd'), w: +get('mark', 'w'), h: +get('mark', 'h'), x: +get('mark', 'x'), y: +get('mark', 'y') };
const word = { s: get('wordmark', 's'), fill: get('wordmark', 'fill'), x: 112, y: 557 };

const markSvg = (color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${mark.w} ${mark.h}"><path fill="${color}" d="${mark.d}"/></svg>`;
const stackedSvg = (main, sub) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 50 935 915">
<path transform="translate(${mark.x} ${mark.y})" fill="${main}" d="${mark.d}"/>
<g transform="translate(${word.x} ${word.y})"><path d="${word.s}" fill="none" stroke="${main}" stroke-width="32"/><path d="${word.fill}" fill="${main}" fill-rule="evenodd"/></g>
<text fill="${sub}" font-family="Segoe UI, Arial" font-weight="600" font-size="44" letter-spacing="3" text-anchor="middle"><tspan x="477.5" y="842">SISTEMAS INTEGRALES</tspan><tspan x="477.5" y="898">INMOBILIARIOS Y DE</tspan><tspan x="477.5" y="954">ADMINISTRACIÓN</tspan></text></svg>`;

const render = (svg, width) => sharp(Buffer.from(svg), { density: 300 }).resize({ width });

// Favicon (32/64) y apple-touch-icon con la marca del edificio
await render(markSvg('#38cbb9'), 56)
  .extend({ top: 4, bottom: 4, left: 4, right: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile('public/favicon.png');
fs.writeFileSync('public/favicon.svg', markSvg('#38cbb9'));
const apple = await render(markSvg('#38cbb9'), 132).toBuffer();
await sharp({ create: { width: 180, height: 180, channels: 4, background: '#ffffff' } })
  .composite([{ input: apple, gravity: 'center' }])
  .png()
  .toFile('public/apple-touch-icon.png');

// Logo PNG para datos estructurados (JSON-LD)
await render(stackedSvg('#38cbb9', '#38cbb9'), 600).png().toFile('public/logo-siia.png');

// Open Graph 1200×630
const bg = await sharp('src/assets/fotos/acceso-fraccionamiento.png').resize(1200, 630, { fit: 'cover' }).toBuffer();
const shade = Buffer.from(`<svg width="1200" height="630"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#1f2440" stop-opacity=".9"/><stop offset=".7" stop-color="#0b5c62" stop-opacity=".55"/><stop offset="1" stop-color="#38cbb9" stop-opacity=".35"/></linearGradient></defs><rect width="1200" height="630" fill="url(#g)"/>
<text x="70" y="430" font-family="Segoe UI, Arial" font-size="46" font-weight="700" fill="#fff">Administración de condominios</text>
<text x="70" y="488" font-family="Segoe UI, Arial" font-size="30" fill="#baf1ed">Transparente · Profesional · Tecnológica</text>
<text x="70" y="565" font-family="Segoe UI, Arial" font-size="26" fill="#ffffff">siia.casa</text></svg>`);
const logo = await render(stackedSvg('#ffffff', '#ffffff'), 290).toBuffer();
await sharp(bg).composite([{ input: shade }, { input: logo, left: 64, top: 60 }]).jpeg({ quality: 84 }).toFile('public/og-siia.jpg');
console.log('ok');
