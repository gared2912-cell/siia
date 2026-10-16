// Control de accesos: dispositivos o medios de entrada que la administración asigna a cada residente.
// Hasta 6 por residente. Ya registrados no se modifican; solo el superadministrador puede darlos de baja.
// Cada acceso está ACTIVO o SUSPENDIDO (por ejemplo, morosos): se cambia con el Excel de control de accesos.

export const TIPOS_ACCESO = [
  'Llavero de proximidad',
  'Tarjeta de proximidad',
  'Control remoto de portón',
  'Tag vehicular (TAG / RFID)',
  'Calcomanía o engomado vehicular',
  'Código PIN de acceso',
  'Huella digital',
  'Reconocimiento facial',
  'Llave física',
  'Brazalete de alberca o amenidades',
  'Gafete o tarjetón de estacionamiento',
  'Otro',
];

export const MAX_ACCESOS = 6;

export type EstadoAcceso = 'ACTIVO' | 'SUSPENDIDO';
export type Acceso = {
  id: string;
  tipo: string;
  codigo: string;
  alta: string;
  por?: string;
  porNombre?: string | null;
  estado?: EstadoAcceso; // sin estado = ACTIVO
  estadoEn?: string;
  estadoPor?: string;
};
export const ETIQUETA_ESTADO_ACCESO: Record<EstadoAcceso, string> = { ACTIVO: 'Activado', SUSPENDIDO: 'Suspendido' };
export const estadoDeAcceso = (a: Acceso): EstadoAcceso => (a.estado === 'SUSPENDIDO' ? 'SUSPENDIDO' : 'ACTIVO');

export function accesosDe(v: unknown): Acceso[] {
  let x = v;
  for (let k = 0; k < 2 && typeof x === 'string'; k++) {
    try {
      x = JSON.parse(x);
    } catch {
      x = [];
    }
  }
  return Array.isArray(x) ? (x as Acceso[]) : [];
}

/** Clave para detectar el mismo código repetido (sin espacios ni guiones, en mayúsculas). */
export const claveCodigo = (tipo: string, codigo: string) => `${tipo}|${codigo.replace(/[\s-]+/g, '').toUpperCase()}`;
