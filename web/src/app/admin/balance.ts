// Balance mensual del condominio: saldo inicial (capturado o arrastrado del mes anterior), ingresos de los
// comprobantes aprobados (ordinarios por tipo y, aparte, amenidades por amenidad), egresos por categoría y
// saldo final. El reporte de Excel para la mesa directiva está en reporteFinanzas.ts.
import type { Schema } from '../api';
import { CATEGORIAS_EGRESO, TIPOS_ORDINARIOS, amenidadDeConcepto, tipoDeCargo } from '../../../amplify/functions/shared/finanzas';

type Pago = Schema['Pago']['type'];
type Cargo = Schema['Cargo']['type'];
type Egreso = Schema['Egreso']['type'];
type SaldoMensual = Schema['SaldoMensual']['type'];

export type Evidencia = { path: string; nombre: string; tipo?: string; tamano?: number };
export type DatosFinanzas = { pagos: Pago[]; cargos: Cargo[]; egresos: Egreso[]; saldos: SaldoMensual[] };

export const redondear = (n: number) => Math.round(n * 100) / 100;
export const fechaMX = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(iso));

/** Día en que cuenta el ingreso: la fecha de pago del comprobante (o el día en que se aprobó). */
export const fechaIngreso = (p: Pago) => p.fecha || (p.validadoEn ? fechaMX(p.validadoEn) : fechaMX(p.createdAt));

export function evidenciasDe(e: Egreso): Evidencia[] {
  let v: unknown = e.evidencias;
  for (let k = 0; k < 2 && typeof v === 'string'; k++) {
    try {
      v = JSON.parse(v);
    } catch {
      v = [];
    }
  }
  return Array.isArray(v) ? (v as Evidencia[]) : [];
}

export const nombreMes = (periodo: string) => {
  const [a, m] = periodo.split('-').map(Number);
  const s = new Date(a, m - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const mesCorto = (periodo: string) => {
  const [a, m] = periodo.split('-').map(Number);
  const s = new Date(a, m - 1, 1).toLocaleDateString('es-MX', { month: 'short' }).replace('.', '');
  return `${s.charAt(0).toUpperCase() + s.slice(1)} ${String(a).slice(2)}`;
};
export const mesAnterior = (periodo: string) => {
  const [a, m] = periodo.split('-').map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
};
export const mesSiguiente = (periodo: string) => {
  const [a, m] = periodo.split('-').map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
};

/** Cómo se reparte un pago aprobado entre los cargos que cubre (lo que sobra: otros ingresos). */
export function desglosePago(p: Pago, cargosPorId: Map<string, Cargo>) {
  const cubiertos = (p.cargoIds ?? []).map((id) => (id ? cargosPorId.get(id) : undefined)).filter((c): c is Cargo => !!c);
  const suma = cubiertos.reduce((s, c) => s + c.monto, 0);
  const factor = suma > 0 ? Math.min(1, p.monto / suma) : 0;
  const partes: { tipo: string; monto: number; concepto: string }[] = cubiertos.map((c) => ({ tipo: tipoDeCargo(c), monto: c.monto * factor, concepto: c.concepto }));
  const resto = p.monto - suma * factor;
  if (resto > 0.004) partes.push({ tipo: 'OTRO', monto: resto, concepto: cubiertos.length ? 'Excedente / pago a cuenta' : 'Pago a cuenta' });
  return partes;
}

export type Balance = {
  periodo: string;
  saldoInicial: number;
  saldoCapturado?: SaldoMensual;
  /** Ingresos ordinarios por tipo (cuotas, mantenimiento, recaudación, recargos, otros). */
  ordinarios: { tipo: string; label: string; monto: number }[];
  totalOrdinarios: number;
  /** Ingresos por amenidades (reservas pagadas y aprobadas), por amenidad. */
  amenidades: { nombre: string; monto: number; reservas: number }[];
  totalAmenidades: number;
  totalIngresos: number;
  egresos: { categoria: string; monto: number }[];
  totalEgresos: number;
  saldoFinal: number;
  pagosMes: Pago[];
  egresosMes: Egreso[];
};

/** Balance del mes. El saldo inicial es el capturado para ese mes o, si no hay, el saldo final del mes anterior. */
export function calcularBalance(d: DatosFinanzas, periodo: string): Balance {
  const cargosPorId = new Map(d.cargos.map((c) => [c.id, c]));
  const validados = d.pagos.filter((p) => p.estado === 'VALIDADO');
  const capturados = new Map(d.saldos.map((s) => [s.periodo, s]));

  const delMes = (mes: string) => {
    const pagosMes = validados.filter((p) => fechaIngreso(p).slice(0, 7) === mes);
    const egresosMes = d.egresos.filter((e) => e.fecha.slice(0, 7) === mes);
    const porTipo = new Map<string, number>();
    const porAmenidad = new Map<string, { monto: number; reservas: number }>();
    for (const p of pagosMes) {
      for (const x of desglosePago(p, cargosPorId)) {
        if (x.tipo === 'RESERVA') {
          const nombre = amenidadDeConcepto(x.concepto);
          const a = porAmenidad.get(nombre) ?? { monto: 0, reservas: 0 };
          porAmenidad.set(nombre, { monto: a.monto + x.monto, reservas: a.reservas + 1 });
        } else porTipo.set(x.tipo, (porTipo.get(x.tipo) ?? 0) + x.monto);
      }
    }
    const porCategoria = new Map<string, number>();
    for (const e of egresosMes) porCategoria.set(e.categoria, (porCategoria.get(e.categoria) ?? 0) + e.monto);
    const ordinarios = TIPOS_ORDINARIOS.map((t) => ({ tipo: t.key, label: t.label, monto: redondear(porTipo.get(t.key) ?? 0) }));
    const amenidades = [...porAmenidad]
      .map(([nombre, a]) => ({ nombre, monto: redondear(a.monto), reservas: a.reservas }))
      .sort((a, b) => b.monto - a.monto || a.nombre.localeCompare(b.nombre));
    const otrasCat = [...porCategoria.keys()].filter((c) => !CATEGORIAS_EGRESO.includes(c));
    const egresos = [...CATEGORIAS_EGRESO, ...otrasCat].map((c) => ({ categoria: c, monto: redondear(porCategoria.get(c) ?? 0) }));
    const totalOrdinarios = redondear(ordinarios.reduce((s, x) => s + x.monto, 0));
    const totalAmenidades = redondear(amenidades.reduce((s, x) => s + x.monto, 0));
    return {
      pagosMes,
      egresosMes,
      ordinarios,
      totalOrdinarios,
      amenidades,
      totalAmenidades,
      totalIngresos: redondear(totalOrdinarios + totalAmenidades),
      egresos,
      totalEgresos: redondear(egresos.reduce((s, x) => s + x.monto, 0)),
    };
  };

  // Primer mes con movimientos o saldo capturado: desde ahí se arrastra el saldo (antes, cero).
  const meses = [
    ...validados.map((p) => fechaIngreso(p).slice(0, 7)),
    ...d.egresos.map((e) => e.fecha.slice(0, 7)),
    ...d.saldos.map((s) => s.periodo),
  ].filter((m) => m <= periodo);
  let mes = meses.length ? meses.reduce((a, b) => (a < b ? a : b)) : periodo;
  let saldo = 0;
  for (;;) {
    const cap = capturados.get(mes);
    const inicial = cap ? cap.saldoInicial : saldo;
    const r = delMes(mes);
    const final = redondear(inicial + r.totalIngresos - r.totalEgresos);
    if (mes === periodo) return { periodo, saldoInicial: redondear(inicial), saldoCapturado: cap, ...r, saldoFinal: final };
    saldo = final;
    mes = mesSiguiente(mes);
  }
}
