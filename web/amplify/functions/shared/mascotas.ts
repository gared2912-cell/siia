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
