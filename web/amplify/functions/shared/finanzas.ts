// Clasificación de ingresos y egresos para el balance mensual (la usan el panel y admin-api).

/** Tipos de ingreso. Los cargos nuevos guardan su tipo; los anteriores se clasifican por su id. */
export const TIPOS_INGRESO = [
  { key: 'CUOTA', label: 'Cuotas mensuales' },
  { key: 'MANT_INTERNO', label: 'Mantenimiento interno' },
  { key: 'MANT_EXTERNO', label: 'Mantenimiento externo' },
  { key: 'RECAUDACION', label: 'Recaudación especial' },
  { key: 'RESERVA', label: 'Amenidades' },
  { key: 'RECARGO', label: 'Recargos por pago tardío' },
  { key: 'MULTA', label: 'Multa o sanción' },
  { key: 'AHORRO', label: 'Fondo de ahorro' },
  { key: 'CARTERA', label: 'Adeudo anterior (cartera vencida heredada)' },
  { key: 'OTRO', label: 'Otros ingresos' },
] as const;

/** Tipos que el administrador elige al crear un cargo extraordinario (además de las categorías propias, «P-…»). */
export const TIPOS_CARGO_MANUAL = ['RECAUDACION', 'MANT_INTERNO', 'MANT_EXTERNO', 'MULTA', 'AHORRO', 'CARTERA', 'OTRO'] as const;

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
  if (c.tipo && (TIPOS_INGRESO.some((t) => t.key === c.tipo) || esPropia(c.tipo))) return c.tipo;
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

// ---------- Categorías de ingreso ----------
// Cómo se reporta cada peso que entra: cuota corriente del mes, recuperación de cartera vencida, cuotas extraordinarias,
// multas y sanciones, amenidades, fondo de ahorro u otros. Las marcadas como «fondo» son guardaditos: se acumulan mes
// con mes, tienen sus propias salidas (egresos con fondo = la categoría) y no cuentan como disponible para el gasto del mes.
// Cada condominio puede agregar categorías propias (Condominio.categoriasIngreso, llave «P-…»).
export type CategoriaIngreso = { key: string; label: string; corto: string; color: string; fondo: boolean; propia?: boolean };

export const CATEGORIAS_INGRESO: CategoriaIngreso[] = [
  { key: 'CORRIENTE', label: 'Cuota corriente de mantenimiento', corto: 'Cuota corriente', color: '#0d7c74', fondo: false },
  { key: 'RECUPERACION', label: 'Recuperación de cartera vencida', corto: 'Recuperación de cartera', color: '#2563eb', fondo: false },
  { key: 'EXTRAORDINARIA', label: 'Cuotas extraordinarias', corto: 'Extraordinarias', color: '#7c3aed', fondo: false },
  { key: 'MULTAS', label: 'Multas y sanciones', corto: 'Multas y sanciones', color: '#dc2626', fondo: true },
  { key: 'AMENIDADES', label: 'Amenidades', corto: 'Amenidades', color: '#d97706', fondo: true },
  { key: 'AHORRO', label: 'Fondo de ahorro', corto: 'Fondo de ahorro', color: '#0891b2', fondo: true },
  { key: 'OTRO', label: 'Otros ingresos', corto: 'Otros', color: '#64748b', fondo: false },
];
/** Colores para las categorías propias del condominio (en orden). */
const COLORES_PROPIAS = ['#be185d', '#4d7c0f', '#9333ea', '#b45309', '#0369a1', '#15803d'];
export const MAX_CATEGORIAS_PROPIAS = 10;
export const esPropia = (key?: string | null) => !!key && /^P-[a-z0-9]{4,12}$/i.test(key);

/** Lista guardada como JSON (a veces como texto dos veces). */
function jsonLista(v: unknown): any[] {
  let x = v;
  for (let k = 0; k < 2 && typeof x === 'string'; k++) {
    try {
      x = JSON.parse(x);
    } catch {
      return [];
    }
  }
  return Array.isArray(x) ? x : [];
}

/** Categorías propias guardadas en el condominio. */
export function categoriasPropias(v: unknown): CategoriaIngreso[] {
  return jsonLista(v)
    .filter((c) => c && esPropia(c.key) && typeof c.label === 'string' && c.label.trim())
    .slice(0, MAX_CATEGORIAS_PROPIAS)
    .map((c, i) => ({
      key: c.key,
      label: String(c.label).trim().slice(0, 60),
      corto: String(c.label).trim().slice(0, 30),
      color: COLORES_PROPIAS[i % COLORES_PROPIAS.length],
      fondo: !!c.fondo,
      propia: true,
    }));
}

/** Todas las categorías de un condominio: las del sistema y las propias («Otros» siempre al final). */
export function categoriasDe(condominio?: { categoriasIngreso?: unknown } | null): CategoriaIngreso[] {
  const otro = CATEGORIAS_INGRESO.find((c) => c.key === 'OTRO')!;
  return [...CATEGORIAS_INGRESO.filter((c) => c.key !== 'OTRO'), ...categoriasPropias(condominio?.categoriasIngreso), otro];
}
export const etiquetaCategoria = (key: string, cats: CategoriaIngreso[] = CATEGORIAS_INGRESO) => cats.find((c) => c.key === key)?.label ?? 'Otros ingresos';
export const esCategoria = (key: unknown, cats: CategoriaIngreso[]): key is string => typeof key === 'string' && cats.some((c) => c.key === key);

/** Lo que el residente puede indicar al subir su comprobante («¿Qué estás pagando?»). */
export const QUE_PAGA_RESIDENTE: { key: string; label: string }[] = [
  { key: 'CORRIENTE', label: 'Mi cuota del mes' },
  { key: 'RECUPERACION', label: 'Cartera vencida (meses atrasados)' },
  { key: 'EXTRAORDINARIA', label: 'Cuota extraordinaria' },
  { key: 'MULTAS', label: 'Multa o sanción' },
  { key: 'AMENIDADES', label: 'Reserva de amenidad' },
  { key: 'AHORRO', label: 'Fondo de ahorro' },
  { key: 'OTRO', label: 'Otro concepto' },
];

type CargoC = { id: string; monto: number; tipo?: string | null; concepto: string; periodo?: string | null; vence?: string | null };

/**
 * Categoría de un cargo pagado en `mesPago` (AAAA-MM). Regla automática por fecha para las cuotas: el mes pagado dentro
 * de su mes (o por adelantado) es cuota corriente; un mes ya pasado (p. ej. mayo pagado en junio) es recuperación de cartera.
 */
export function categoriaDeCargo(c: CargoC, mesPago: string): string {
  const tipo = tipoDeCargo(c);
  if (esPropia(tipo)) return tipo;
  switch (tipo) {
    case 'CUOTA': {
      const mes = (c.periodo || c.vence || '').slice(0, 7);
      return mes && mesPago && mesPago > mes ? 'RECUPERACION' : 'CORRIENTE';
    }
    case 'CARTERA':
      return 'RECUPERACION';
    case 'RECARGO':
    case 'MULTA':
      return 'MULTAS';
    case 'RESERVA':
      return 'AMENIDADES';
    case 'AHORRO':
      return 'AHORRO';
    case 'RECAUDACION':
    case 'MANT_INTERNO':
    case 'MANT_EXTERNO':
      return 'EXTRAORDINARIA';
    default:
      return 'OTRO';
  }
}

type PagoF = {
  monto: number;
  estado?: string | null;
  fecha?: string | null;
  validadoEn?: string | null;
  createdAt?: string | null;
  cargoIds?: (string | null)[] | null;
  desglose?: unknown;
  categoriaResidente?: string | null;
};
type EgresoF = { fecha: string; monto: number; fondo?: string | null };

const diaMX = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(iso));
const r2 = (n: number) => Math.round(n * 100) / 100;
const siguiente = (p: string) => {
  const [a, m] = p.split('-').map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
};
/** Día en que cuenta el ingreso: la fecha de pago del comprobante (o el día en que se aprobó). */
export const diaIngreso = (p: PagoF) => p.fecha || (p.validadoEn ? diaMX(p.validadoEn) : p.createdAt ? diaMX(p.createdAt) : '');

export type ParteDesglose = { categoria: string; monto: number };
/** Desglose manual guardado en el pago. */
export function desgloseDe(v: unknown): ParteDesglose[] {
  return jsonLista(v)
    .filter((d) => d && typeof d.categoria === 'string' && Number(d.monto) > 0)
    .map((d) => ({ categoria: d.categoria as string, monto: r2(Number(d.monto)) }));
}

export type PartePago = { categoria: string; tipo: string; monto: number; concepto: string; reserva?: boolean };

/**
 * Cómo se reparte un pago aprobado: por los cargos que cubre (cada uno con su tipo y su categoría por fecha) y lo que
 * sobra a la categoría que indicó el residente (o «Otros»). Si la administración lo desglosó al aprobar, manda su desglose.
 */
export function partesDePago<C extends CargoC>(p: PagoF, cargosPorId: Map<string, C>): PartePago[] {
  const manual = desgloseDe(p.desglose);
  if (manual.length) {
    return manual.map((d) => ({ categoria: d.categoria, tipo: d.categoria === 'AMENIDADES' ? 'RESERVA' : 'OTRO', monto: d.monto, concepto: 'Desglose de la administración' }));
  }
  const mes = diaIngreso(p).slice(0, 7);
  const cubiertos = (p.cargoIds ?? []).map((id) => (id ? cargosPorId.get(id) : undefined)).filter((c): c is C => !!c);
  const suma = cubiertos.reduce((s, c) => s + c.monto, 0);
  const factor = suma > 0 ? Math.min(1, p.monto / suma) : 0;
  const partes: PartePago[] = cubiertos.map((c) => {
    const tipo = tipoDeCargo(c);
    return { categoria: categoriaDeCargo(c, mes), tipo, monto: c.monto * factor, concepto: c.concepto, reserva: tipo === 'RESERVA' };
  });
  const resto = p.monto - suma * factor;
  if (resto > 0.004) {
    const cat = p.categoriaResidente && p.categoriaResidente !== 'AMENIDADES' ? p.categoriaResidente : 'OTRO';
    partes.push({ categoria: cat, tipo: 'OTRO', monto: resto, concepto: cubiertos.length ? 'Excedente / pago a cuenta' : 'Pago a cuenta' });
  }
  return partes;
}

/** Propuesta de categoría para todo un pago sin cargos o para su resto (lo que indicó el residente). */
export const categoriaSugerida = (p: PagoF) => p.categoriaResidente || 'OTRO';

// ---------- Fondos (guardaditos) y apartados ----------
// Fondo de una categoría: lo que entra por esa categoría (pagos aprobados) menos sus salidas (egresos con fondo = la
// categoría), arrastrado mes con mes. Apartado: dinero que la administración separa a mano del saldo (macromedidor,
// fondo de emergencia…) con sus movimientos; sus salidas son egresos con fondo = id del apartado.
export const FONDO_AMENIDADES = 'AMENIDADES';

export type MesFondo = { periodo: string; inicial: number; ingresos: number; reservas: number; gastos: number; final: number };

/** Movimientos del fondo de una categoría mes por mes, desde el primer movimiento hasta `hasta` (AAAA-MM). */
export function calcularFondo<C extends CargoC>(d: { pagos: PagoF[]; cargos: C[]; egresos: EgresoF[] }, clave: string, hasta: string) {
  const cargos = new Map(d.cargos.map((c) => [c.id, c]));
  const ingresos = new Map<string, { monto: number; reservas: number }>();
  for (const p of d.pagos) {
    if (p.estado !== 'VALIDADO') continue;
    const mes = diaIngreso(p).slice(0, 7);
    if (!mes) continue;
    for (const x of partesDePago(p, cargos)) {
      if (x.categoria !== clave) continue;
      const v = ingresos.get(mes) ?? { monto: 0, reservas: 0 };
      ingresos.set(mes, { monto: v.monto + x.monto, reservas: v.reservas + (x.reserva ? 1 : 0) });
    }
  }
  const gastos = new Map<string, number>();
  for (const e of d.egresos) if (e.fondo === clave) gastos.set(e.fecha.slice(0, 7), (gastos.get(e.fecha.slice(0, 7)) ?? 0) + e.monto);
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

/** Fondo de amenidades (lo que se cobra por reservas, menos sus gastos). */
export const calcularFondoAmenidades = <C extends CargoC>(d: { pagos: PagoF[]; cargos: C[]; egresos: EgresoF[] }, hasta: string) =>
  calcularFondo(d, FONDO_AMENIDADES, hasta);

export type MovimientoApartado = { id: string; fecha: string; monto: number; nota?: string | null; porNombre?: string | null; en?: string };
export type Apartado = { id: string; nombre: string; descripcion?: string | null; activo: boolean; movimientos: MovimientoApartado[] };
export const MAX_APARTADOS = 20;
export const esApartado = (id?: string | null) => !!id && /^A-[a-z0-9]{4,12}$/i.test(id);

export function apartadosDe(v: unknown): Apartado[] {
  return jsonLista(v)
    .filter((a) => a && esApartado(a.id) && typeof a.nombre === 'string')
    .map((a) => ({
      id: a.id,
      nombre: a.nombre,
      descripcion: a.descripcion ?? null,
      activo: a.activo !== false,
      movimientos: (Array.isArray(a.movimientos) ? a.movimientos : [])
        .filter((m: any) => m && typeof m.fecha === 'string' && Number.isFinite(Number(m.monto)))
        .map((m: any) => ({ ...m, monto: r2(Number(m.monto)) })),
    }));
}

/** Saldo de un apartado al cierre de `hasta` (AAAA-MM): lo apartado menos lo liberado y sus salidas. */
export function saldoApartado(a: Apartado, egresos: EgresoF[], hasta: string) {
  const apartado = r2(a.movimientos.filter((m) => m.fecha.slice(0, 7) <= hasta).reduce((s, m) => s + m.monto, 0));
  const gastado = r2(egresos.filter((e) => e.fondo === a.id && e.fecha.slice(0, 7) <= hasta).reduce((s, e) => s + e.monto, 0));
  return { apartado, gastado, saldo: r2(apartado - gastado) };
}

type CondoFondos = { categoriasIngreso?: unknown; apartados?: unknown } | null | undefined;

/** Fondo al que puede cargarse un egreso: una categoría con fondo o un apartado del condominio. */
export function fondoValido(fondo: unknown, condominio: CondoFondos): string | null {
  if (typeof fondo !== 'string' || !fondo) return null;
  if (categoriasDe(condominio).some((c) => c.fondo && c.key === fondo)) return fondo;
  if (apartadosDe(condominio?.apartados).some((a) => a.id === fondo)) return fondo;
  return null;
}

/** Nombre del fondo o apartado de un egreso, para mostrarlo. */
export function nombreFondo(fondo: string | null | undefined, condominio: CondoFondos): string | null {
  if (!fondo) return null;
  const cat = categoriasDe(condominio).find((c) => c.key === fondo);
  if (cat) return cat.key === FONDO_AMENIDADES ? 'Fondo de amenidades' : `Fondo: ${cat.label}`;
  const a = apartadosDe(condominio?.apartados).find((x) => x.id === fondo);
  return a ? `Apartado: ${a.nombre}` : 'Fondo';
}
