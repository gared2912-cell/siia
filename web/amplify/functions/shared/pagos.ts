// Cómo se aplica un pago a los cargos que cubre: completo, parcial (la diferencia queda pendiente o se condona) o con
// excedente (saldo a favor de la unidad u otro ingreso). La usan admin-api al aprobar y las pantallas para la vista previa.

export const AJUSTES_PAGO = {
  COMPLETO: 'Pago completo',
  PARCIAL: 'Pago parcial',
  CONDONADO: 'Diferencia condonada',
  SALDO_FAVOR: 'Saldo a favor',
  EXCEDENTE: 'Excedente como otro ingreso',
} as const;
export type AjustePago = keyof typeof AJUSTES_PAGO;

/** Qué hacer con lo que falta (PENDIENTE: nuevo cargo con la diferencia) y con lo que sobra. */
export type Faltante = 'PENDIENTE' | 'CONDONAR';
export type Excedente = 'SALDO_FAVOR' | 'INGRESO';

export const SUFIJO_PENDIENTE = ' · saldo pendiente';

type CargoP = { id: string; monto: number; vence?: string | null; concepto: string };

export const r2 = (n: number) => Math.round(n * 100) / 100;
const CENTAVO = 0.004;

/**
 * Reparte lo disponible (monto recibido + saldo a favor usado) entre los cargos, primero los que vencen antes.
 * `pagados` se liquidan completos; `parcial` es el cargo que se parte; `sinCubrir` siguen pendientes tal cual.
 */
export function repartirPago<C extends CargoP>(cargos: C[], disponible: number) {
  const orden = [...cargos].sort((a, b) => String(a.vence ?? '9999').localeCompare(String(b.vence ?? '9999')) || a.id.localeCompare(b.id));
  let resto = r2(disponible);
  const pagados: C[] = [];
  const sinCubrir: C[] = [];
  let parcial: { cargo: C; pagado: number; pendiente: number } | null = null;
  for (const c of orden) {
    if (resto >= c.monto - CENTAVO) {
      pagados.push(c);
      resto = r2(resto - c.monto);
    } else if (resto > CENTAVO && !parcial) {
      parcial = { cargo: c, pagado: resto, pendiente: r2(c.monto - resto) };
      resto = 0;
    } else sinCubrir.push(c);
  }
  const total = r2(cargos.reduce((s, c) => s + c.monto, 0));
  return { total, diferencia: r2(disponible - total), pagados, parcial, sinCubrir, pendiente: r2(Math.max(0, total - disponible)) };
}

/** Saldo a favor que conviene usar: solo lo necesario para completar los cargos. */
export const favorAUsar = (saldoFavor: number, totalCargos: number, monto: number) => r2(Math.max(0, Math.min(saldoFavor, totalCargos - monto)));

/** Tipo de ajuste según la diferencia y lo que eligió la administración. */
export function ajusteDe(diferencia: number, faltante: Faltante, excedente: Excedente): AjustePago {
  if (Math.abs(diferencia) <= CENTAVO) return 'COMPLETO';
  if (diferencia < 0) return faltante === 'CONDONAR' ? 'CONDONADO' : 'PARCIAL';
  return excedente === 'INGRESO' ? 'EXCEDENTE' : 'SALDO_FAVOR';
}

/** Concepto del cargo con la diferencia (sin repetir el sufijo si ya era un saldo pendiente). */
export const conceptoPendiente = (concepto: string) => (concepto.endsWith(SUFIJO_PENDIENTE) ? concepto : `${concepto}${SUFIJO_PENDIENTE}`).slice(0, 200);
