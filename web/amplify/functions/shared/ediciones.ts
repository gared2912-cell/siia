// Ediciones de Finanzas (cargos, egresos, gastos del fondo de amenidades y saldo inicial): cada cambio pide un motivo
// y queda en el historial del registro (campo `ediciones`) con quién lo hizo, cuándo, por qué y qué cambió.
// - El historial lo escribe solo el servidor (admin-api): nadie lo puede modificar ni borrar.
// - Un registro que ya fue editado solo lo vuelve a modificar (o cancelar o eliminar) un superadministrador.

export const MOTIVOS_EDICION = [
  { key: 'ERROR_CAPTURA', label: 'Error de captura' },
  { key: 'AJUSTE', label: 'Ajuste' },
  { key: 'DESCUENTO', label: 'Descuento o condonación' },
  { key: 'ACUERDO', label: 'Acuerdo de asamblea o del comité' },
  { key: 'DUPLICADO', label: 'Registro duplicado' },
  { key: 'OTRO', label: 'Otro' },
] as const;
export type MotivoEdicion = (typeof MOTIVOS_EDICION)[number]['key'];

export const etiquetaMotivo = (k?: string | null) => MOTIVOS_EDICION.find((m) => m.key === k)?.label ?? k ?? '';

export type CambioEdicion = { campo: string; antes: unknown; despues: unknown };
export type Edicion = {
  en: string;
  por: { id: string; nombre: string; email?: string | null; rol: string };
  motivo: string;
  detalle?: string | null;
  /** EDITAR, CANCELAR o ELIMINAR */
  accion: string;
  cambios: CambioEdicion[];
};

/** Historial guardado como texto JSON (a veces dos veces). */
export function edicionesDe(v: unknown): Edicion[] {
  let x = v;
  try {
    for (let k = 0; k < 2 && typeof x === 'string'; k++) x = JSON.parse(x);
  } catch {
    return [];
  }
  return Array.isArray(x) ? (x as Edicion[]) : [];
}

/** Nombre de cada campo en el historial. */
export const CAMPOS_EDICION: Record<string, string> = {
  monto: 'Monto',
  concepto: 'Concepto',
  vence: 'Vence',
  tipo: 'Tipo de ingreso',
  estado: 'Estado',
  fecha: 'Fecha',
  categoria: 'Categoría',
  proveedor: 'Proveedor',
  formaPago: 'Forma de pago',
  evidencias: 'Evidencia',
  saldoInicial: 'Saldo inicial',
  nota: 'Nota',
};
