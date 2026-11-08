// Balance mensual del condominio: saldo inicial (capturado o arrastrado del mes anterior), ingresos de los
// comprobantes aprobados (ordinarios por tipo y, aparte, amenidades por amenidad), egresos por categoría y
// saldo final. El reporte de Excel para la mesa directiva está en reporteFinanzas.ts.
import type { Schema } from '../api';
import {
  CATEGORIAS_EGRESO,
  amenidadDeConcepto,
  apartadosDe,
  calcularFondo,
  categoriasDe,
  partesDePago,
  saldoApartado,
  type CategoriaIngreso,
} from '../../../amplify/functions/shared/finanzas';

type Pago = Schema['Pago']['type'];
type Cargo = Schema['Cargo']['type'];
type Egreso = Schema['Egreso']['type'];
type SaldoMensual = Schema['SaldoMensual']['type'];

export type Evidencia = { path: string; nombre: string; tipo?: string; tamano?: number };
/** `condo`: categorías propias y apartados del condominio (Condominio.categoriasIngreso / apartados). */
export type DatosFinanzas = { pagos: Pago[]; cargos: Cargo[]; egresos: Egreso[]; saldos: SaldoMensual[]; condo?: { categoriasIngreso?: unknown; apartados?: unknown } | null };

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

/** Cómo se reparte un pago aprobado entre categorías (shared/finanzas.ts: cargos, regla por fecha o desglose manual). */
export const desglosePago = (p: Pago, cargosPorId: Map<string, Cargo>) => partesDePago(p, cargosPorId);

export type Balance = {
  periodo: string;
  saldoInicial: number;
  saldoCapturado?: SaldoMensual;
  /** Ingresos por categoría, sin amenidades (cuota corriente, recuperación de cartera, extraordinarias, multas, ahorro…). */
  ordinarios: { tipo: string; label: string; monto: number; color: string; fondo: boolean }[];
  /** Todas las categorías con su monto y su porcentaje del ingreso del mes (distribución en los recuadros). */
  categorias: (CategoriaIngreso & { monto: number; pct: number })[];
  /** Del ingreso por cuotas: qué parte es cuota corriente y qué parte recuperación de cartera (0 a 1). */
  pctCorriente: number;
  pctRecuperacion: number;
  /** Fondos (guardaditos) al cierre del mes: entradas y salidas del mes y saldo acumulado. */
  fondos: { key: string; label: string; color: string; ingresos: number; gastos: number; saldo: number }[];
  /** Apartados manuales al cierre del mes. */
  apartados: { id: string; nombre: string; saldo: number; activo: boolean }[];
  /** Fondos + apartados: lo que no está disponible para el gasto del mes. */
  totalReservado: number;
  /** Saldo final − fondos − apartados. */
  disponible: number;
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
  const cats = categoriasDe(d.condo);
  const validados = d.pagos.filter((p) => p.estado === 'VALIDADO');
  const capturados = new Map(d.saldos.map((s) => [s.periodo, s]));

  const delMes = (mes: string) => {
    const pagosMes = validados.filter((p) => fechaIngreso(p).slice(0, 7) === mes);
    const egresosMes = d.egresos.filter((e) => e.fecha.slice(0, 7) === mes);
    const porCategoria = new Map<string, number>();
    const porAmenidad = new Map<string, { monto: number; reservas: number }>();
    for (const p of pagosMes) {
      for (const x of desglosePago(p, cargosPorId)) {
        const cat = cats.some((c) => c.key === x.categoria) ? x.categoria : 'OTRO';
        if (cat === 'AMENIDADES') {
          const nombre = x.reserva ? amenidadDeConcepto(x.concepto) : 'Amenidades (desglose de la administración)';
          const a = porAmenidad.get(nombre) ?? { monto: 0, reservas: 0 };
          porAmenidad.set(nombre, { monto: a.monto + x.monto, reservas: a.reservas + (x.reserva ? 1 : 0) });
        } else porCategoria.set(cat, (porCategoria.get(cat) ?? 0) + x.monto);
      }
    }
    const porEgreso = new Map<string, number>();
    for (const e of egresosMes) porEgreso.set(e.categoria, (porEgreso.get(e.categoria) ?? 0) + e.monto);
    const ordinarios = cats
      .filter((c) => c.key !== 'AMENIDADES')
      .map((c) => ({ tipo: c.key, label: c.label, monto: redondear(porCategoria.get(c.key) ?? 0), color: c.color, fondo: c.fondo }));
    const amenidades = [...porAmenidad]
      .map(([nombre, a]) => ({ nombre, monto: redondear(a.monto), reservas: a.reservas }))
      .sort((a, b) => b.monto - a.monto || a.nombre.localeCompare(b.nombre));
    const otrasCat = [...porEgreso.keys()].filter((c) => !CATEGORIAS_EGRESO.includes(c));
    const egresos = [...CATEGORIAS_EGRESO, ...otrasCat].map((c) => ({ categoria: c, monto: redondear(porEgreso.get(c) ?? 0) }));
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
    if (mes === periodo) return { periodo, saldoInicial: redondear(inicial), saldoCapturado: cap, ...r, saldoFinal: final, ...reservado(d, cats, r, periodo, final) };
    saldo = final;
    mes = mesSiguiente(mes);
  }
}

/** Distribución por categoría, fondos, apartados y lo disponible para ejecutar al cierre del mes. */
function reservado(
  d: DatosFinanzas,
  cats: CategoriaIngreso[],
  r: { ordinarios: { tipo: string; monto: number }[]; totalAmenidades: number; totalIngresos: number },
  periodo: string,
  saldoFinal: number,
) {
  const montoDe = (key: string) => (key === 'AMENIDADES' ? r.totalAmenidades : (r.ordinarios.find((o) => o.tipo === key)?.monto ?? 0));
  const categorias = cats.map((c) => ({ ...c, monto: montoDe(c.key), pct: r.totalIngresos ? montoDe(c.key) / r.totalIngresos : 0 }));
  const corriente = montoDe('CORRIENTE');
  const recuperacion = montoDe('RECUPERACION');
  const cuotas = corriente + recuperacion;
  const fondos = cats
    .filter((c) => c.fondo)
    .map((c) => {
      const f = calcularFondo(d, c.key, periodo);
      const mes = f.meses.find((x) => x.periodo === periodo);
      return { key: c.key, label: c.label, color: c.color, ingresos: mes?.ingresos ?? 0, gastos: mes?.gastos ?? 0, saldo: mes ? mes.final : f.saldo };
    });
  const apartados = apartadosDe(d.condo?.apartados).map((a) => ({ id: a.id, nombre: a.nombre, activo: a.activo, saldo: saldoApartado(a, d.egresos, periodo).saldo }));
  const totalReservado = redondear(fondos.reduce((s, f) => s + Math.max(0, f.saldo), 0) + apartados.reduce((s, a) => s + Math.max(0, a.saldo), 0));
  return {
    categorias,
    pctCorriente: cuotas ? corriente / cuotas : 0,
    pctRecuperacion: cuotas ? recuperacion / cuotas : 0,
    fondos,
    apartados,
    totalReservado,
    disponible: redondear(saldoFinal - totalReservado),
  };
}
