// Mascota segura: los registros rechazados salen del listado principal a «Rechazadas», donde la administración
// consulta el motivo. Se borran solos (con su foto) DIAS_RECHAZADA días después del rechazo (Lambda siia-papelera,
// cada hora) o antes, si la administración los borra a mano.
export const DIAS_RECHAZADA = 30;

type ConFechas = { rechazadaEn?: string | null; firmaCambio?: unknown; updatedAt?: string | null };

/** Cuándo se rechazó: rechazadaEn; en registros rechazados antes de que existiera, la última firma o actualización. */
export function rechazadaDesde(m: ConFechas): string {
  if (m.rechazadaEn) return m.rechazadaEn;
  let firma = m.firmaCambio as { en?: string } | null | undefined;
  if (typeof firma === 'string') {
    try {
      firma = JSON.parse(firma);
    } catch {
      firma = null;
    }
  }
  return firma?.en || m.updatedAt || new Date().toISOString();
}

/** Fecha (ISO) en que se borra automáticamente un registro rechazado. */
export function fechaBorradoMascota(m: ConFechas): string {
  return new Date(Date.parse(rechazadaDesde(m)) + DIAS_RECHAZADA * 86_400_000).toISOString();
}

// ---------- Mascota extraviada: avistamientos ----------
// Vecinos y caseta avisan «La vi» (dónde, nota y foto opcional). Se guardan en Mascota.avistamientos (JSON);
// los del extravío actual son los posteriores a extraviadaEn. Cada avistamiento avisa al dueño (campana y push),
// a la administración y a la caseta (notificador).
export const MAX_AVISTAMIENTOS = 50;

export type Avistamiento = {
  id: string;
  en: string;
  /** Quién la vio: nombre del vecino o «Caseta». */
  quien: string;
  /** Casa o departamento de quien la vio, o «Caseta». */
  unidad: string;
  donde: string;
  nota?: string | null;
  fotoPath?: string | null;
};

export function avistamientosDe(m: { avistamientos?: unknown }): Avistamiento[] {
  let x = m.avistamientos;
  for (let k = 0; k < 2 && typeof x === 'string'; k++) {
    try {
      x = JSON.parse(x);
    } catch {
      return [];
    }
  }
  return Array.isArray(x) ? (x as Avistamiento[]) : [];
}

/** Avistamientos del extravío actual (desde que se reportó), del más reciente al más antiguo. */
export function avistamientosActuales(m: { avistamientos?: unknown; extraviadaEn?: string | null }): Avistamiento[] {
  const desde = m.extraviadaEn ?? '';
  return avistamientosDe(m)
    .filter((a) => a.en >= desde)
    .sort((a, b) => b.en.localeCompare(a.en));
}
