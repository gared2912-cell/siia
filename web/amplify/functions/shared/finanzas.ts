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
  'Otros',
];

export const MAX_EVIDENCIAS_EGRESO = 5;
