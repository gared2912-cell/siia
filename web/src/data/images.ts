import type { ImageMetadata } from 'astro';

const files = import.meta.glob<{ default: ImageMetadata }>('../assets/fotos/*.{png,webp}', { eager: true });

// Acceso por nombre corto: photo('operativo') → src/assets/fotos/operativo.png (o .webp)
export function photo(name: string): ImageMetadata {
  const file = files[`../assets/fotos/${name}.webp`] ?? files[`../assets/fotos/${name}.png`];
  if (!file) throw new Error(`Foto no encontrada: ${name}`);
  return file.default;
}
