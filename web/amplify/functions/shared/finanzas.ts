// Clasificación de ingresos y egresos para el balance mensual (la usan el panel y admin-api).

/** Tipos de ingreso. Los cargos nuevos guardan su tipo; los anteriores se clasifican por su id. */
export const TIPOS_INGRESO = [
  { key: 'CUOTA', label: 'Cuotas mensuales' },
  { key: 'MANT_INTERNO', label: 'Mantenimiento interno' },
  { key: 'MANT_EXTERNO', label: 'Mantenimiento externo' },
  { key: 'RECAUDACION', label: 'Recaudación especial' },
  { key: 'RESERVA', label: 'Amenidades' },
  { key: 'RECARGO', label: 'Recargos por pago tardío' },
  { key: 'OTRO', label: 'Otros ingresos' },
] as const;

/** Tipos que el administrador elige al crear un cargo extraordinario. */
export const TIPOS_CARGO_MANUAL = ['RECAUDACION', 'MANT_INTERNO', 'MANT_EXTERNO', 'OTRO'] as const;

/** Ingresos ordinarios del condominio; las amenidades (RESERVA) se reportan aparte, por amenidad. */
export const TIPOS_ORDINARIOS = TIPOS_INGRESO.filter((t) => t.key !== 'RESERVA');

/** Amenidad de un cargo de reserva: «Reserva <amenidad>[ · <principal>] · <fecha> <horario>». */
export function amenidadDeConcepto(concepto: string): string {
  const sin = concepto.replace(/^Reserva\s+/i, '');
  const partes = sin.split(' · ');
  return (partes.length > 1 ? partes.slice(0, -1).reverse().join(' · ') : sin).trim() || 'Amenidades';
}

export const etiquetaIngreso = (tipo: string) => TIPOS_INGRESO.find((t) => t.key === tipo)?.label ?? 'Otros ingresos';

/** Tipo de ingreso de un cargo: el guardado o, en cargos anteriores, el que indica su id. */
export function tipoDeCargo(c: { id: string; tipo?: string | null }): string {
  if (c.tipo && TIPOS_INGRESO.some((t) => t.key === c.tipo)) return c.tipo;
  if (c.id.endsWith('#cuota')) return 'CUOTA';
  if (c.id.endsWith('#recargo')) return 'RECARGO';
  if (c.id.startsWith('reserva#')) return 'RESERVA';
  if (c.id.startsWith('extra#')) return 'RECAUDACION';
  return 'OTRO';
}

export const CATEGORIAS_EGRESO = [
  'Poda y jardinería',
  'Mantenimiento de cisternas',
  'Recolección de basura',
  'Gas',
  'Agua',
  'Luz',
  'Servicios de mantenimiento',
  'Limpieza',
  'Vigilancia',
  'Administración',
  'Mantenimiento de amenidades',
  'Mobiliario y equipo',
  'Otros',
];

export const MAX_EVIDENCIAS_EGRESO = 5;

// ---------- Fondo de amenidades ----------
// Ahorro de amenidades: lo cobrado por reservas (pagos aprobados) menos lo que la administración registra como
// gasto del fondo (egresos con fondo = AMENIDADES). El saldo de cada mes se arrastra al siguiente.
export const FONDO_AMENIDADES = 'AMENIDADES';

type CargoF = { id: string; monto: number; tipo?: string | null; concepto: string };
type PagoF = { monto: number; estado?: string | null; fecha?: string | null; validadoEn?: string | null; createdAt?: string | null; cargoIds?: (string | null)[] | null };
type EgresoF = { fecha: string; monto: number; fondo?: string | null };

const diaMX = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(iso));
const r2 = (n: number) => Math.round(n * 100) / 100;
const siguiente = (p: string) => {
  const [a, m] = p.split('-').map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
};

export type MesFondo = { periodo: string; inicial: number; ingresos: number; reservas: number; gastos: number; final: number };

/** Movimientos del fondo mes por mes, desde el primer movimiento hasta `hasta` (AAAA-MM). */
export function calcularFondoAmenidades(d: { pagos: PagoF[]; cargos: CargoF[]; egresos: EgresoF[] }, hasta: string) {
  const cargos = new Map(d.cargos.map((c) => [c.id, c]));
  const ingresos = new Map<string, { monto: number; reservas: number }>();
  for (const p of d.pagos) {
    if (p.estado !== 'VALIDADO') continue;
    const cubiertos = (p.cargoIds ?? []).map((id) => (id ? cargos.get(id) : undefined)).filter((c): c is CargoF => !!c);
    const suma = cubiertos.reduce((s, c) => s + c.monto, 0);
    const factor = suma > 0 ? Math.min(1, p.monto / suma) : 0;
    const mes = (p.fecha || (p.validadoEn ? diaMX(p.validadoEn) : p.createdAt ? diaMX(p.createdAt) : '')).slice(0, 7);
    for (const c of cubiertos) {
      if (tipoDeCargo(c) !== 'RESERVA' || !mes) continue;
      const x = ingresos.get(mes) ?? { monto: 0, reservas: 0 };
      ingresos.set(mes, { monto: x.monto + c.monto * factor, reservas: x.reservas + 1 });
    }
  }
  const gastos = new Map<string, number>();
  for (const e of d.egresos) if (e.fondo === FONDO_AMENIDADES) gastos.set(e.fecha.slice(0, 7), (gastos.get(e.fecha.slice(0, 7)) ?? 0) + e.monto);
  const meses: MesFondo[] = [];
  const todos = [...ingresos.keys(), ...gastos.keys()].filter((m) => m <= hasta).sort();
  let saldo = 0;
  for (let m = todos[0] ?? hasta; m <= hasta; m = siguiente(m)) {
    const i = ingresos.get(m) ?? { monto: 0, reservas: 0 };
    const g = gastos.get(m) ?? 0;
    const final = r2(saldo + i.monto - g);
    meses.push({ periodo: m, inicial: r2(saldo), ingresos: r2(i.monto), reservas: i.reservas, gastos: r2(g), final });
    saldo = final;
  }
  return {
    meses,
    saldo: r2(saldo),
    totalIngresos: r2(meses.reduce((s, x) => s + x.ingresos, 0)),
    totalGastos: r2(meses.reduce((s, x) => s + x.gastos, 0)),
    desde: meses[0]?.periodo ?? hasta,
  };
}
