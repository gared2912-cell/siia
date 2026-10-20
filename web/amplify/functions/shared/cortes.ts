// Registro de activaciones (Panel › Residentes): cortes de accesos por morosidad para el técnico.
// - Al hacer un corte se elige qué accesos se desactivan (llaveros, controles…), si cuentan los cargos
//   extraordinarios y desde cuántas cuotas vencidas es moroso.
// - Cada acceso sale con su acción para el técnico: POR_DESACTIVAR (moroso) o POR_ACTIVAR (ya pagó).
// - El siguiente corte da por hecho lo anterior: POR_DESACTIVAR → DESACTIVADO y POR_ACTIVAR → ACTIVO
//   (se aplica al estado del acceso en SIIA). Lo suspendido por un corte lleva motivo MOROSIDAD.
// - En la base se guardan todos los cortes; el Excel muestra el actual y los dos anteriores.

export type EstadoCorte = 'POR_DESACTIVAR' | 'DESACTIVADO' | 'POR_ACTIVAR' | 'ACTIVO';
export const ETIQUETA_CORTE: Record<EstadoCorte, string> = {
  POR_DESACTIVAR: 'Por desactivar (técnico)',
  DESACTIVADO: 'Desactivado',
  POR_ACTIVAR: 'Por activar (técnico)',
  ACTIVO: 'Activo',
};

export type CriterioCorte = {
  tipos: string[]; // tipos de acceso que se desactivan por morosidad
  extraordinarios: boolean; // también cuentan los cargos extraordinarios vencidos
  minCuotas: number; // cuotas (o cargos) vencidas para ser moroso
};

export type AccesoCorte = { id: string; tipo: string; codigo: string; estado: EstadoCorte; manual?: boolean };
/** Un renglón por residente (o por casa sin residente). Solo se guardan morosos y quien tiene accesos sin activar. */
export type FilaCorte = {
  unidadId: string;
  unidad: string;
  userId: string | null;
  residente: string;
  moroso: boolean;
  cuotas: number; // cuotas de mantenimiento vencidas
  extras: number; // cargos extraordinarios vencidos (si cuentan)
  monto: number; // adeudo vencido que cuenta (más recargos)
  accesos: AccesoCorte[];
};
export type ResumenCorte = { morosos: number; monto: number; porDesactivar: number; porActivar: number; desactivados: number; aplicados: number };
export type Corte = {
  id: string;
  condominioId: string;
  numero: number;
  fecha: string;
  porNombre?: string | null;
  criterio: CriterioCorte;
  resumen: ResumenCorte;
  filas?: FilaCorte[];
};

export const MIN_CUOTAS_DEFECTO = 2;

/** JSON guardado como texto (a veces dos veces). */
export function jsonCorte<T>(v: unknown, defecto: T): T {
  let x = v;
  for (let k = 0; k < 2 && typeof x === 'string'; k++) {
    try {
      x = JSON.parse(x);
    } catch {
      return defecto;
    }
  }
  return (x ?? defecto) as T;
}

/** Texto corto del criterio: «2 o más cuotas vencidas · cuotas y cargos extraordinarios · Llaveros, Controles». */
export function textoCriterio(c: CriterioCorte) {
  const cuenta = c.extraordinarios ? 'cuotas de mantenimiento y cargos extraordinarios' : 'solo cuotas de mantenimiento';
  const tipos = c.tipos.length ? c.tipos.join(', ') : 'ninguno';
  return `Moroso: ${c.minCuotas} o más vencidas (${cuenta}) · Accesos a desactivar: ${tipos}`;
}
