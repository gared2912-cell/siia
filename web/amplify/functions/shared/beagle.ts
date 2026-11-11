// Sonidos del beagle del semáforo de pendientes (por condominio; solo el SUPERADMIN los configura en
// Condominios › Datos generales). Verde: nada · amarillo: ladra · rojo: gruñe, cada `cadaMin` minutos.
export type VolumenBeagle = 'muy-bajo' | 'bajo' | 'medio';
export type ConfigBeagle = { activo: boolean; cadaMin: number; volumen: VolumenBeagle };

export const BEAGLE_DEFECTO: ConfigBeagle = { activo: true, cadaMin: 120, volumen: 'bajo' };
export const FRECUENCIAS_BEAGLE: [number, string][] = [
  [30, 'Cada 30 minutos'],
  [60, 'Cada hora'],
  [120, 'Cada 2 horas'],
  [180, 'Cada 3 horas'],
  [240, 'Cada 4 horas'],
];
export const VOLUMENES_BEAGLE: [VolumenBeagle, string][] = [
  ['muy-bajo', 'Muy bajo'],
  ['bajo', 'Bajo'],
  ['medio', 'Medio'],
];

/** Configuración guardada en Condominio.beagleSonidos (JSON) con los valores por omisión. */
export function configBeagle(v: unknown): ConfigBeagle {
  let x: unknown = v;
  for (let k = 0; k < 2 && typeof x === 'string'; k++) {
    try {
      x = JSON.parse(x);
    } catch {
      x = null;
    }
  }
  const o = (x && typeof x === 'object' ? x : {}) as Partial<ConfigBeagle>;
  return {
    activo: typeof o.activo === 'boolean' ? o.activo : BEAGLE_DEFECTO.activo,
    cadaMin: FRECUENCIAS_BEAGLE.some(([m]) => m === o.cadaMin) ? (o.cadaMin as number) : BEAGLE_DEFECTO.cadaMin,
    volumen: VOLUMENES_BEAGLE.some(([k]) => k === o.volumen) ? (o.volumen as VolumenBeagle) : BEAGLE_DEFECTO.volumen,
  };
}
