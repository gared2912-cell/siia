// Prueba rápida de la clasificación de ingresos (npx tsx scripts/prueba-categorias.ts): regla por fecha, desglose
// manual, fondos (guardaditos), apartados y disponible para ejecutar. No toca ningún ambiente.
import assert from 'node:assert/strict';
import { calcularFondo, categoriaDeCargo, partesDePago, saldoApartado, apartadosDe } from '../amplify/functions/shared/finanzas';
import { calcularBalance } from '../src/app/admin/balance';

const cuota = (periodo: string, monto = 1500) => ({ id: `u1#${periodo}#cuota`, monto, concepto: `Cuota ${periodo}`, periodo, vence: `${periodo}-10`, tipo: 'CUOTA' });

// Regla automática por fecha
assert.equal(categoriaDeCargo(cuota('2026-06'), '2026-06'), 'CORRIENTE');
assert.equal(categoriaDeCargo(cuota('2026-07'), '2026-06'), 'CORRIENTE'); // adelantado
assert.equal(categoriaDeCargo(cuota('2026-05'), '2026-06'), 'RECUPERACION'); // mayo pagado en junio
assert.equal(categoriaDeCargo({ id: 'x', monto: 100, concepto: 'Recargo', tipo: 'RECARGO' }, '2026-06'), 'MULTAS');
assert.equal(categoriaDeCargo({ id: 'reserva#1', monto: 100, concepto: 'Reserva Alberca · 2026-06-01' }, '2026-06'), 'AMENIDADES');
assert.equal(categoriaDeCargo({ id: 'y', monto: 100, concepto: 'Adeudo anterior', tipo: 'CARTERA' }, '2026-06'), 'RECUPERACION');

// Un depósito que cubre junio y mayo: 50/50 automático
const cargos = [cuota('2026-05'), cuota('2026-06'), { id: 'reserva#r1', monto: 500, concepto: 'Reserva Terraza · 2026-06-20 10:00–14:00', tipo: 'RESERVA' }];
const porId = new Map(cargos.map((c) => [c.id, c]));
const pago = { monto: 3000, estado: 'VALIDADO', fecha: '2026-06-05', cargoIds: [cargos[0].id, cargos[1].id] };
const partes = partesDePago(pago, porId);
assert.deepEqual(
  partes.map((x) => [x.categoria, x.monto]),
  [
    ['RECUPERACION', 1500],
    ['CORRIENTE', 1500],
  ],
);

// Desglose manual del ejemplo de la junta: 15,000 = 8,000 corriente + 7,000 cartera vencida
const desglosado = { monto: 15000, estado: 'VALIDADO', fecha: '2026-06-08', cargoIds: [], desglose: JSON.stringify([{ categoria: 'CORRIENTE', monto: 8000 }, { categoria: 'RECUPERACION', monto: 7000 }]) };
assert.deepEqual(partesDePago(desglosado, porId).map((x) => [x.categoria, x.monto]), [['CORRIENTE', 8000], ['RECUPERACION', 7000]]);

// Pago a cuenta sin cargos: va a lo que indicó el residente
assert.equal(partesDePago({ monto: 200, estado: 'VALIDADO', fecha: '2026-06-09', cargoIds: [], categoriaResidente: 'AHORRO' }, porId)[0].categoria, 'AHORRO');

// Fondos y balance
const reserva = { monto: 500, estado: 'VALIDADO', fecha: '2026-06-10', cargoIds: ['reserva#r1'] };
const egresos = [
  { id: 'e1', fecha: '2026-06-15', monto: 200, categoria: 'Mantenimiento de amenidades', concepto: 'Cloro', fondo: 'AMENIDADES' },
  { id: 'e2', fecha: '2026-06-16', monto: 1000, categoria: 'Agua', concepto: 'Macromedidor', fondo: 'A-macro01' },
  { id: 'e3', fecha: '2026-06-20', monto: 2000, categoria: 'Limpieza', concepto: 'Limpieza junio' },
];
const fondo = calcularFondo({ pagos: [reserva], cargos, egresos }, 'AMENIDADES', '2026-06');
assert.equal(fondo.saldo, 300);
assert.equal(fondo.meses.at(-1)!.reservas, 1);

const apartados = JSON.stringify([{ id: 'A-macro01', nombre: 'Macromedidor', activo: true, movimientos: [{ id: 'm1', fecha: '2026-06-01', monto: 5000, nota: 'Ahorro' }] }]);
assert.equal(saldoApartado(apartadosDe(apartados)[0], egresos, '2026-06').saldo, 4000);

const b = calcularBalance(
  { pagos: [pago, desglosado, reserva] as any, cargos: cargos as any, egresos: egresos as any, saldos: [], condo: { apartados } },
  '2026-06',
);
assert.equal(b.totalIngresos, 3000 + 15000 + 500);
assert.equal(b.totalEgresos, 3200);
assert.equal(b.saldoFinal, 18500 - 3200);
assert.equal(b.totalReservado, 300 + 4000);
assert.equal(b.disponible, 15300 - 4300);
// Corriente 1500 + 8000 = 9500; recuperación 1500 + 7000 = 8500
assert.equal(Math.round(b.pctCorriente * 1000), Math.round((9500 / 18000) * 1000));
console.log('OK · categorías, desglose, fondos, apartados y disponible para ejecutar');
console.log({ disponible: b.disponible, reservado: b.totalReservado, corriente: b.pctCorriente.toFixed(3), recuperacion: b.pctRecuperacion.toFixed(3) });
