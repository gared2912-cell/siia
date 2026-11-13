// Cierre de mes: arma el estado financiero que se comparte con los residentes con el mismo cálculo que la hoja
// «Resumen» del Excel (reporteFinanzas.ts).
import type { EstadoFinanciero } from '../estadoFinanciero';
import { calcularBalance, redondear } from './balance';
import { datosGraficas, type OpcionesReporte } from './reporteFinanzas';

export function armarEstado(o: OpcionesReporte): EstadoFinanciero {
  const b = calcularBalance(o.datos, o.periodo);
  const g = datosGraficas(o, b);
  const cargosMes = o.datos.cargos.filter((c) => c.periodo === o.periodo && c.estado !== 'CANCELADO');
  const emitido = redondear(cargosMes.reduce((s, c) => s + c.monto, 0));
  const cobrado = redondear(cargosMes.filter((c) => c.estado === 'PAGADO').reduce((s, c) => s + c.monto, 0));
  const vencidas = new Set(o.datos.cargos.filter((c) => c.estado === 'PENDIENTE' && c.vence && c.vence < o.hoy).map((c) => c.unidadId));
  const conAdeudo = o.unidades.filter((u) => vencidas.has(u.id)).length;
  return {
    version: 1,
    condominio: o.condominio,
    periodo: o.periodo,
    elaborado: o.hoy,
    saldoInicial: b.saldoInicial,
    totalIngresos: b.totalIngresos,
    totalEgresos: b.totalEgresos,
    saldoFinal: b.saldoFinal,
    ordinarios: b.ordinarios.map((x) => ({ label: x.label, monto: x.monto })),
    totalOrdinarios: b.totalOrdinarios,
    amenidades: b.amenidades.map((a) => ({ nombre: a.nombre, reservas: a.reservas, monto: a.monto })),
    totalAmenidades: b.totalAmenidades,
    egresos: b.egresos.filter((x) => x.monto > 0).sort((a, z) => z.monto - a.monto),
    movimientosEgreso: b.egresosMes.length,
    totalReservado: b.totalReservado,
    disponible: b.disponible,
    notaSaldoInicial: b.saldoCapturado ? `Saldo inicial capturado por la administración${b.saldoCapturado.nota ? `: ${b.saldoCapturado.nota}` : ''}.` : null,
    cobranza: { emitido, cobrado, pendiente: redondear(emitido - cobrado), alCorriente: o.unidades.length - conAdeudo, conAdeudo },
    serie: g.serie,
  };
}
