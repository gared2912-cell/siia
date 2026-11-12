// Prueba del match automático con el estado de cuenta (npx tsx scripts/prueba-conciliacion.ts [archivo.xlsx]).
// 1) Casos fijos de lectura (sin AWS). 2) Si se pasa un Excel, lo cruza contra Laula en STAGING (solo lectura).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { conciliar, datosDescripcion, fechaCelda, leerEstadoCuenta, unidadesEnTexto } from '../amplify/functions/shared/conciliacion';

// --- Lectura ---
assert.equal(fechaCelda(46328), '2026-11-02');
assert.equal(fechaCelda('02/11/2026'), '2026-11-02');
assert.equal(fechaCelda('2026-11-02'), '2026-11-02');
const d = datosDescripcion(
  'SPEI Recibido: | Institucion contraparte: SANTANDER Ordenante: JUAN LUIS RAMIREZ TORRES Cuenta Ordenante: 014290568827559153  |  RFC Ordenante: RATJ950703JK0 | Referencia: 311 | Hora: 19:30:02 | Clave de Rastreo: 2026110240014BMOVP000439309350 Concepto del Pago: LAULA | 311 MANTENIMIENTO NOVIEMBRE | Recibo # 282946420',
);
assert.equal(d.ordenante, 'JUAN LUIS RAMIREZ TORRES');
assert.equal(d.banco, 'SANTANDER');
assert.equal(d.cuenta, '9153');
assert.equal(d.referencia, '311');
assert.equal(d.rastreo, '2026110240014BMOVP000439309350');
assert.equal(d.recibo, '282946420');
assert.equal(d.concepto, 'LAULA | 311 MANTENIMIENTO NOVIEMBRE');

// --- Unidades en el concepto ---
const us = ['104', '107', '113', '26', '306', '311', '362', '450'].map((n) => ({ id: n, etiqueta: `Depto ${n}` }));
const en = (t: string) => unidadesEnTexto(t, us, 'Laula').encontradas.sort();
assert.deepEqual(en('Laula306mtonov2026'), ['306']);
assert.deepEqual(en('laula, 107 mto octubre- noviembre'), ['107']);
assert.deepEqual(en('Laula113Mto OctNov'), ['113']);
assert.deepEqual(en('PAGOMTTO NOV26 LAULA DEPTO 362'), ['362']); // «NOV26» es el año
assert.deepEqual(en('PAGO MANTENIMIENTO OCT NOV'), []);
assert.deepEqual(unidadesEnTexto('Depto A-101 mto', [{ id: 'a', etiqueta: 'Depto A-101' }, { id: 'b', etiqueta: 'Depto A-10' }]).encontradas, ['a']);
console.log('✔ lectura y detección de unidades');

// --- Cruce sintético: duplicados, monto distinto, rastreo, nombre ---
const filas = [
  ['Fecha Movimiento', 'Hora', 'Recibo', 'Descripción', 'Cargos', 'Abonos', 'Saldo'],
  [46328, 46328.5, '1', 'SPEI Recibido: | Institucion contraparte: BBVA Ordenante: ANA PEREZ LOPEZ Cuenta Ordenante: 1 | Clave de Rastreo: AAA11111111 Concepto del Pago: Laula 104 nov | Recibo # 1', '', 450, ''],
  [46328, 46328.5, '2', 'SPEI Recibido: | Institucion contraparte: BBVA Ordenante: LUIS GOMEZ RUIZ Cuenta Ordenante: 1 | Clave de Rastreo: BBB22222222 Concepto del Pago: mantenimiento | Recibo # 2', '', 450, ''],
  [46328, 46328.5, '3', 'SPEI Recibido: | Institucion contraparte: BBVA Ordenante: X Cuenta Ordenante: 1 | Clave de Rastreo: CCC33333333 Concepto del Pago: Laula 107 | Recibo # 3', '', 500, ''],
  [46328, '', '', 'COMISION', 10, '', ''],
];
const lectura = leerEstadoCuenta(filas);
assert.equal(lectura.movimientos.length, 3);
assert.equal(lectura.cargos, 1);
const r = conciliar({
  lectura,
  unidades: [
    { id: '104', etiqueta: 'Depto 104' },
    { id: '107', etiqueta: 'Depto 107' },
    { id: '113', etiqueta: 'Depto 113' },
  ],
  perfiles: [{ unidadId: '113', nombre: 'Luis Gómez Ruiz' }],
  cargos: [
    { id: 'c1', unidadId: '104', monto: 450, concepto: 'Cuota nov', estado: 'PENDIENTE' },
    { id: 'c2', unidadId: '113', monto: 450, concepto: 'Cuota nov', estado: 'PENDIENTE' },
    { id: 'c3', unidadId: '107', monto: 450, concepto: 'Cuota nov', estado: 'PENDIENTE' },
  ],
  pagos: [
    { id: 'p1', unidadId: '104', monto: 450, fecha: '2026-11-02', estado: 'EN_REVISION', cargoIds: ['c1'], createdAt: '1' },
    { id: 'p1b', unidadId: '104', monto: 450, fecha: '2026-11-02', estado: 'EN_REVISION', cargoIds: ['c1'], createdAt: '2' }, // repetido
    { id: 'p2', unidadId: '113', monto: 450, fecha: '2026-11-03', estado: 'EN_REVISION', cargoIds: ['c2'], createdAt: '3' },
    { id: 'p3', unidadId: '107', monto: 450, fecha: '2026-11-02', estado: 'EN_REVISION', cargoIds: ['c3'], createdAt: '4' }, // banco dice 500
  ],
  nombreCondominio: 'Laula',
});
const de = (id: string) => r.coincidencias.find((c) => c.pagoId === id);
assert.equal(de('p1')?.nivel, 'REVISAR'); // hay un comprobante repetido
assert.deepEqual(de('p1')?.duplicados, ['p1b']);
assert.equal(de('p2')?.nivel, 'COINCIDE'); // por nombre
assert.equal(de('p3'), undefined); // monto distinto: nunca
assert.equal(r.sinComprobante.length, 1);
assert.match(r.sinComprobante[0].motivo, /otro monto/);
console.log('✔ cruce: repetidos, nombre, monto distinto');

// --- Por cargo: un comprobante de $570 (cuota nov $450 + proporcional oct $120) ---
const spei = (n: number, rastreo: string, concepto: string, monto: number) => [
  46333,
  46333.5,
  String(n),
  `SPEI Recibido: | Institucion contraparte: BBVA Ordenante: X Cuenta Ordenante: 1 | Clave de Rastreo: ${rastreo} Concepto del Pago: ${concepto} | Recibo # ${n}`,
  '',
  monto,
  '',
];
const enc = ['Fecha Movimiento', 'Hora', 'Recibo', 'Descripción', 'Cargos', 'Abonos', 'Saldo'];
const base368 = {
  unidades: [{ id: '368', etiqueta: 'Depto 368' }],
  perfiles: [],
  cargos: [
    { id: 'nov', unidadId: '368', monto: 450, concepto: 'Cuota noviembre', estado: 'PENDIENTE', vence: '2026-11-10' },
    { id: 'oct', unidadId: '368', monto: 120, concepto: 'Proporcional octubre', estado: 'PENDIENTE', vence: '2026-10-31' },
  ],
  pagos: [{ id: 'q', unidadId: '368', monto: 570, fecha: '2026-11-07', estado: 'EN_REVISION', cargoIds: ['nov', 'oct'], createdAt: '1' }],
  nombreCondominio: 'Laula',
};
// a) Un solo depósito por el total: un solo recibo por los dos cargos (como antes).
const rTotal = conciliar({ ...base368, lectura: leerEstadoCuenta([enc, spei(1, 'TOT11111111', 'Laula 368', 570)]) });
assert.equal(rTotal.coincidencias.length, 1);
assert.equal(rTotal.coincidencias[0].clave, 'q');
assert.equal(rTotal.coincidencias[0].cargoIds, undefined);
assert.equal(rTotal.coincidencias[0].nivel, 'COINCIDE');
// b) Dos depósitos separados ($450 y $120): dos coincidencias, cada una con su cargo y su recibo.
const rSep = conciliar({ ...base368, lectura: leerEstadoCuenta([enc, spei(1, 'AAA11111111', 'Laula 368 nov', 450), spei(2, 'BBB22222222', 'Laula 368 oct', 120)]) });
assert.equal(rSep.coincidencias.length, 2);
const porMonto = (m: number) => rSep.coincidencias.find((c) => c.monto === m)!;
assert.deepEqual(porMonto(450).cargoIds, ['nov']);
assert.deepEqual(porMonto(120).cargoIds, ['oct']);
assert.ok(rSep.coincidencias.every((c) => c.nivel === 'COINCIDE' && c.clave.startsWith('q|')));
assert.equal(rSep.sinDeposito.length, 0);
assert.equal(rSep.sinComprobante.length, 0);
// c) Solo llegó la cuota de $450: se aprueba ese cargo y la proporcional sigue por aprobar.
const rUno = conciliar({ ...base368, lectura: leerEstadoCuenta([enc, spei(1, 'AAA11111111', 'Laula 368 nov', 450)]) });
assert.equal(rUno.coincidencias.length, 1);
assert.deepEqual(rUno.coincidencias[0].cargoIds, ['nov']);
assert.match(rUno.coincidencias[0].notas.join(' '), /Proporcional octubre.*seguirá en «Por aprobar»/);
// d) Un depósito de otra unidad por $450 no cuenta.
const rOtra = conciliar({ ...base368, lectura: leerEstadoCuenta([enc, spei(1, 'AAA11111111', 'Laula 104 nov', 450)]) });
assert.equal(rOtra.coincidencias.length, 0);
// e) Grupos: tres cargos ($450 + $120 + $200) pagados como $570 y $200.
const rGrupo = conciliar({
  ...base368,
  cargos: [...base368.cargos, { id: 'multa', unidadId: '368', monto: 200, concepto: 'Multa', estado: 'PENDIENTE', vence: '2026-11-15' }],
  pagos: [{ ...base368.pagos[0], monto: 770, cargoIds: ['nov', 'oct', 'multa'] }],
  lectura: leerEstadoCuenta([enc, spei(1, 'AAA11111111', 'Laula 368', 570), spei(2, 'BBB22222222', 'Laula 368 multa', 200)]),
});
assert.equal(rGrupo.coincidencias.length, 2);
assert.deepEqual([...rGrupo.coincidencias.find((c) => c.monto === 570)!.cargoIds!].sort(), ['nov', 'oct']);
assert.deepEqual(rGrupo.coincidencias.find((c) => c.monto === 200)!.cargoIds, ['multa']);
console.log('✔ por cargo: total, depósitos separados, parcial, otra unidad y grupos');

// --- Archivo real contra Laula en STAGING (solo lectura) ---
const archivo = process.argv[2];
if (archivo) {
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, ScanCommand } = await import('@aws-sdk/lib-dynamodb');
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
  const L = '3fa1b096-65a3-445c-9de0-100b60280f41';
  const SUF = '-w4apbggptra57eamq3lfhgtncu-NONE';
  const scan = async (t: string) => {
    const o: any[] = [];
    let K: any;
    do {
      const x = await ddb.send(new ScanCommand({ TableName: t + SUF, ExclusiveStartKey: K }));
      o.push(...(x.Items ?? []));
      K = x.LastEvaluatedKey;
    } while (K);
    return o.filter((i) => i.condominioId === L);
  };
  const [pagos, unidades, perfiles, cargos] = await Promise.all(['Pago', 'Unidad', 'Perfil', 'Cargo'].map(scan));
  const libro = XLSX.read(readFileSync(archivo), { cellDates: false });
  const hoja = XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets[libro.SheetNames[0]], { header: 1, raw: true, defval: '' });
  const res = conciliar({ lectura: leerEstadoCuenta(hoja), pagos, unidades, perfiles, cargos, nombreCondominio: 'Laula' });
  console.log('\nResumen:', res.resumen);
  for (const c of res.coincidencias)
    console.log(`${c.nivel === 'COINCIDE' ? '🟢' : '🟡'} ${c.etiqueta.padEnd(10)} $${c.monto} | banco ${c.mov.fecha} · pagó ${c.fechaPago} | ${c.razones.join(' · ')}${c.notas.map((n) => '\n     ℹ ' + n).join('')}${c.alertas.map((a) => '\n     ⚠ ' + a).join('')}`);
  console.log('\nDepósitos sin comprobante:');
  for (const s of res.sinComprobante) console.log(`  · ${s.mov.fecha} $${s.mov.monto} «${s.mov.concepto}» → ${s.motivo}`);
  console.log('\nComprobantes sin depósito:');
  for (const s of res.sinDeposito) console.log(`  · ${s.etiqueta} $${s.monto} (${s.fechaPago}) → ${s.motivo}`);
}
