// Íconos de la app instalable (PWA) a partir del isotipo vectorial (src/data/logo.ts):
// icon-192 / icon-512 (fondo teal), icon-maskable-512 (con margen de seguridad), apple-180 (iPhone)
// y badge-96 (monocromo para Android).
import sharp from 'sharp';
import fs from 'node:fs';
import { logoColors, markSvg } from '../src/data/logo.ts';

const svg = (color) => markSvg(color);
// Fondo: teal de marca #38CBB9 (como Logos/5.png)
const TEAL = logoColors.teal;

fs.mkdirSync('public/icons', { recursive: true });

/** Marca blanca centrada sobre fondo teal; `escala` = proporción del lienzo que ocupa la marca. */
async function icono(size, escala, file) {
  const marca = await sharp(Buffer.from(svg('#ffffff')), { density: 600 })
    .resize({ width: Math.round(size * escala), height: Math.round(size * escala), fit: 'inside' })
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: TEAL } })
    .composite([{ input: marca, gravity: 'center' }])
    .png()
    .toFile(file);
}

await icono(192, 0.62, 'public/icons/icon-192.png');
await icono(512, 0.62, 'public/icons/icon-512.png');
await icono(512, 0.5, 'public/icons/icon-maskable-512.png');
// iPhone recorta las esquinas por su cuenta; usa este ícono al agregar a la pantalla de inicio.
await icono(180, 0.6, 'public/icons/apple-180.png');

// Badge de Android: solo la silueta en blanco sobre transparente.
await sharp(Buffer.from(svg('#ffffff')), { density: 600 })
  .resize(72, 72, { fit: 'inside' })
  .extend({ top: 12, bottom: 12, left: 12, right: 12, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .resize(96, 96, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile('public/icons/badge-96.png');
console.log('ok');
