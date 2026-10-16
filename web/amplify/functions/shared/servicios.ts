// Imagen de cada servicio del condominio para el «Aviso de servicios» (la generan scripts/imagenes-servicios.mjs en
// public/servicios). Los servicios propios del condominio usan la imagen general.

export const IMAGENES_SERVICIO: { clave: string; nombre: string; titulo: string }[] = [
  { clave: 'basura', nombre: 'Basura', titulo: 'Llegó el camión de la basura' },
  { clave: 'gas', nombre: 'Gas', titulo: 'Llegó el gas' },
  { clave: 'agua', nombre: 'Agua (pipa)', titulo: 'Llegó la pipa de agua' },
  { clave: 'mantenimiento', nombre: 'Mantenimiento', titulo: 'Llegó el servicio de mantenimiento' },
  { clave: 'administracion', nombre: 'Administración', titulo: 'Llegó la administración' },
  { clave: 'rondin', nombre: 'Rondín de supervisión', titulo: 'Llegó el rondín de supervisión' },
  { clave: 'jardineria', nombre: 'Jardinería', titulo: 'Llegó el servicio de jardinería' },
];

const clave = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)/g, '')
    .trim();

/** Ruta pública de la imagen del servicio (por su nombre configurado en el condominio). */
export function imagenServicio(nombre: string): string {
  const k = clave(nombre);
  const s = IMAGENES_SERVICIO.find((x) => clave(x.nombre) === k || k.startsWith(x.clave));
  return `/servicios/${s?.clave ?? 'general'}.jpg`;
}
