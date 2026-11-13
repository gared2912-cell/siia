// Estado financiero mensual que la administración comparte con los residentes al cerrar el mes («Finanzas del
// condominio»). Es una foto de la hoja «Resumen» del Excel del panel: indicadores, ingresos, egresos, estado de
// resultados, cobranza y las dos gráficas. Se guarda en CierreMes.datos; el residente lo ve y lo descarga en PDF.

export type EstadoFinanciero = {
  version: 1;
  condominio: string;
  periodo: string; // AAAA-MM
  elaborado: string; // AAAA-MM-DD
  saldoInicial: number;
  totalIngresos: number;
  totalEgresos: number;
  saldoFinal: number;
  ordinarios: { label: string; monto: number }[];
  totalOrdinarios: number;
  amenidades: { nombre: string; reservas: number; monto: number }[];
  totalAmenidades: number;
  egresos: { categoria: string; monto: number }[];
  movimientosEgreso: number;
  totalReservado: number;
  disponible: number;
  notaSaldoInicial?: string | null;
  cobranza: { emitido: number; cobrado: number; pendiente: number; alCorriente: number; conAdeudo: number };
  /** Ingresos vs. egresos de los últimos 6 meses (el del reporte marcado como actual). */
  serie: { label: string; ingresos: number; egresos: number; actual?: boolean }[];
};

export const nombreMesLargo = (periodo: string) => {
  const [a, m] = periodo.split('-').map(Number);
  const s = new Date(a, m - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const fechaLarga = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });

/** Porcentaje (0–1) de un monto sobre el total, o null si no hay total. */
export const proporcion = (n: number, total: number) => (total ? n / total : null);

/** Filas del estado de resultados (las mismas del Excel). */
export function filasResultados(e: EstadoFinanciero): [string, number, boolean?][] {
  return [
    ['Saldo inicial', e.saldoInicial],
    ['(+) Ingresos ordinarios', e.totalOrdinarios],
    ['(+) Ingresos por amenidades', e.totalAmenidades],
    ['(−) Egresos', -e.totalEgresos || 0],
    ['(=) Saldo final', e.saldoFinal, true],
    ...(e.totalReservado
      ? ([
          ['(−) Fondos y apartados', -e.totalReservado || 0],
          ['(=) Disponible para ejecutar', e.disponible, true],
        ] as [string, number, boolean?][])
      : []),
  ];
}

/** Lee CierreMes.datos (texto JSON, a veces dos veces). */
export function estadoDe(v: unknown): EstadoFinanciero | null {
  let x = v;
  for (let k = 0; k < 2 && typeof x === 'string'; k++) {
    try {
      x = JSON.parse(x);
    } catch {
      return null;
    }
  }
  return x && typeof x === 'object' ? (x as EstadoFinanciero) : null;
}
