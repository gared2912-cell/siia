// Reglas de la cuota completa (shared/cuotas.ts, acordadas el 11 nov 2026). Uso: npx tsx scripts/prueba-cuotas.ts
import { sinCuotaCompleta } from '../amplify/functions/shared/cuotas';
import { periodoDeCuota } from '../amplify/functions/shared/finanzas';

let fallas = 0;
const es = (nombre: string, real: unknown, esperado: unknown) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallas++;
  console.log(`${ok ? 'OK ' : 'MAL'} ${nombre}${ok ? '' : ` → ${JSON.stringify(real)}, se esperaba ${JSON.stringify(esperado)}`}`);
};

const nov = '2026-11';
const auto = { fechaCargo: '2026-11-05' };
const vieja = { id: 'u', createdAt: '2026-10-27T18:00:00Z' };

// Mes del cargo manual
es('«Cuota proporcional octubre» que vence en nov es de octubre', periodoDeCuota({ concepto: 'Cuota proporcional octubre', periodo: nov }), '2026-10');
es('«Cuota Noviembre» es de noviembre', periodoDeCuota({ concepto: 'Cuota Noviembre', periodo: nov }), nov);
es('Sin mes en el concepto: su periodo', periodoDeCuota({ concepto: 'Cuota de mantenimiento', periodo: nov }), nov);
es('«Cuota diciembre» capturada en enero es del año anterior', periodoDeCuota({ concepto: 'Cuota diciembre', periodo: '2027-01' }), '2026-12');

// Regla 1: entrega
es('Unidad sin fecha de entrega: completa', sinCuotaCompleta(vieja, [], nov, auto), null);
es('Entregada el 1 de nov: completa', sinCuotaCompleta({ ...vieja, fechaEntrega: '2026-11-01' }, [], nov, auto), null);
es('Entregada el 7 de nov: sin completa', sinCuotaCompleta({ ...vieja, fechaEntrega: '2026-11-07' }, [], nov, auto), 'entrega');
es('Entregada el 7 de nov: en diciembre ya completa', sinCuotaCompleta({ ...vieja, fechaEntrega: '2026-11-07' }, [], '2026-12', { fechaCargo: '2026-12-05' }), null);
es('Entrega futura (enero): sin completa en nov', sinCuotaCompleta({ ...vieja, fechaEntrega: '2027-01-15' }, [], nov, auto), 'entrega');

// Regla 2: cargo manual (casos reales de Laula en producción)
const manual = (concepto: string, periodo = nov, extra = {}) => ({ id: 'm', tipo: 'MANT_INTERNO', estado: 'PENDIENTE', concepto, periodo, ...extra });
es('Depto 161/444: «Cuota de mantenimiento noviembre 2026» manual', sinCuotaCompleta(vieja, [manual('Cuota de mantenimiento noviembre 2026')], nov, auto), 'manual');
es('Depto 368: «Cuota Noviembre» manual', sinCuotaCompleta(vieja, [manual('Cuota Noviembre')], nov, auto), 'manual');
es('Proporcional de octubre no bloquea noviembre', sinCuotaCompleta(vieja, [manual('Cuota proporcional octubre', nov)], nov, auto), null);
es('Typo «Cuota proporcinal noviembre»', sinCuotaCompleta(vieja, [manual('Cuota proporcinal noviembre')], nov, auto), 'manual');
es('Tipo PROPORCIONAL de noviembre', sinCuotaCompleta(vieja, [{ id: 'proporcional#u#2026-11', tipo: 'PROPORCIONAL', concepto: 'Cuota proporcional noviembre 2026 (entrega 7 de noviembre)', periodo: nov }], nov, auto), 'manual');
es('Manual cancelado no cuenta', sinCuotaCompleta(vieja, [manual('Cuota Noviembre', nov, { estado: 'CANCELADO' })], nov, auto), null);
es('«Reparación de bomba» (mant. interno) no cuenta', sinCuotaCompleta(vieja, [manual('Reparación de bomba')], nov, auto), null);
es('Multa con «cuota» en el concepto no cuenta', sinCuotaCompleta(vieja, [manual('Multa por no pagar la cuota', nov, { tipo: 'MULTA' })], nov, auto), null);
es('Adeudo heredado (cartera) no cuenta', sinCuotaCompleta(vieja, [manual('Cuota noviembre adeudo', nov, { tipo: 'CARTERA' })], nov, auto), null);

// Regla 3: alta después del día de cargo (solo la automática)
es('Alta el 6 nov, cargo el 5: sin completa (automática)', sinCuotaCompleta({ id: 'u', createdAt: '2026-11-06T17:00:00Z' }, [], nov, auto), 'alta');
es('Alta el 5 nov a las 7 pm (México), cargo el 5: completa', sinCuotaCompleta({ id: 'u', createdAt: '2026-11-06T01:00:00Z' }, [], nov, auto), null);
es('Alta el 6 nov pero entregada el 21 oct (depto 168): completa', sinCuotaCompleta({ id: 'u', createdAt: '2026-11-06T17:00:00Z', fechaEntrega: '2026-10-21' }, [], nov, auto), null);
es('Alta el 6 nov, generación manual de cuotas: completa', sinCuotaCompleta({ id: 'u', createdAt: '2026-11-06T17:00:00Z' }, [], nov), null);

console.log(fallas ? `\n${fallas} falla(s)` : '\nTodo bien');
process.exit(fallas ? 1 : 0);
