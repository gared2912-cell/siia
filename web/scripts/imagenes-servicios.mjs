// Genera las imágenes del «Aviso de servicios» (public/servicios/*.jpg): la ilustración de cada servicio
// (src/assets/servicios/*.webp) con el logotipo de SIIA (public/marca/siia-horizontal.png, de brand-assets) y el
// nombre del servicio en una franja de marca. Formato 2:1, el que usan las notificaciones con imagen.
//   node scripts/imagenes-servicios.mjs
import sharp from 'sharp';
import fs from 'node:fs';

const W = 1200;
const H = 600;
const FRANJA = 112;
const SERVICIOS = [
  ['basura', 'Basura'],
  ['gas', 'Gas'],
  ['agua', 'Agua (pipa)'],
  ['mantenimiento', 'Mantenimiento'],
  ['administracion', 'Administración'],
  ['rondin', 'Rondín de supervisión'],
  ['jardineria', 'Jardinería'],
  ['general', 'Servicio del condominio'],
];
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

fs.mkdirSync('public/servicios', { recursive: true });
const logo = await sharp('public/marca/siia-horizontal.png').resize({ height: 58 }).png().toBuffer();
const { width: lw } = await sharp(logo).metadata();

for (const [clave, nombre] of SERVICIOS) {
  // Ilustración recortada a 2:1 (se conserva la parte central-baja, donde están el vigilante y el servicio)
  const base = await sharp(`src/assets/servicios/${clave}.webp`)
    .resize(W, H + FRANJA, { fit: 'cover', position: 'centre' })
    .extract({ left: 0, top: 40, width: W, height: H })
    .toBuffer();
  // Logotipo sobre una placa blanca redondeada (arriba a la izquierda)
  const placa = Buffer.from(
    `<svg width="${lw + 40}" height="82"><rect width="${lw + 40}" height="82" rx="18" fill="#ffffff" fill-opacity="0.94"/></svg>`,
  );
  // Franja inferior con el nombre del servicio
  const franja = Buffer.from(
    `<svg width="${W}" height="${FRANJA}">
      <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#007c7d"/><stop offset="1" stop-color="#38cbb9"/></linearGradient></defs>
      <rect width="${W}" height="${FRANJA}" fill="url(#g)" fill-opacity="0.96"/>
      <text x="40" y="44" font-family="Segoe UI, Arial, sans-serif" font-size="26" fill="#d9f6f2" font-weight="600">ACABA DE LLEGAR</text>
      <text x="40" y="92" font-family="Segoe UI, Arial, sans-serif" font-size="46" fill="#ffffff" font-weight="700">${xml(nombre)}</text>
    </svg>`,
  );
  await sharp(base)
    .composite([
      { input: placa, left: 24, top: 22 },
      { input: logo, left: 44, top: 34 },
      { input: franja, left: 0, top: H - FRANJA },
    ])
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(`public/servicios/${clave}.jpg`);
  console.log(`public/servicios/${clave}.jpg`);
}
