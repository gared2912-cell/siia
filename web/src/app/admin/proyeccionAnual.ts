// Proyección anual en Excel (Finanzas › Balance › Proyección anual), con el formato de «PROYECCION FINANCIERA 2027»
// (docs): concepto, costo por unidad, presupuesto mensual, enero a diciembre y total del año; gastos fijos y
// variables, total de gasto, ingreso del mes y balance ingresos − egresos, más el saldo acumulado.
// Los meses hasta el elegido son reales (pagos aprobados y egresos registrados); los siguientes, proyectados:
// la cuota de mantenimiento proyectada es cuota × unidades y cada gasto, su promedio mensual real. Los parámetros y
// el presupuesto mensual se pueden editar en el archivo y todo se recalcula (fórmulas). Debajo: cobranza de cuotas por
// mes y el detalle de cada gasto del año.
// Hoja 2 «Por casa o departamento»: cada una o departamento mes por mes (verde = pagó a tiempo, ámbar = pagó tarde o en
// revisión, rojo = debe, gris = proyectado) con lo que generó, lo que pagó y lo que debe. ExcelJS se carga al descargar.
import type { Cell, Workbook } from 'exceljs';
import type { Schema } from '../api';
import { CATEGORIAS_EGRESO } from '../../../amplify/functions/shared/finanzas';
import { calcularBalance, fechaIngreso, mesSiguiente, nombreMes, redondear, type Balance, type DatosFinanzas } from './balance';
import { C, PESOS, FUENTE, argb, bordeAbajo, bordeArriba, estilo, firmarLibro, logoBase64 } from './reporteFinanzas';
import { encabezado } from './reporteCobranza';

export type OpcionesProyeccion = {
  condominio: string;
  /** Último mes con datos reales (aaaa-mm); el año de la proyección es el de este mes. */
  hasta: string;
  datos: DatosFinanzas;
  cuotaMensual: number;
  unidades: Unidad[];
  /** Residentes de cada unidad (finanzas.contactos). */
  contactos?: Record<string, { nombre: string | null; email: string }[]>;
  /** Hoy (aaaa-mm-dd), para saber qué cuotas ya vencieron. */
  hoy: string;
  /** «Casas» o «departamentos» para la etiqueta del número de unidades. */
  tipoUnidad?: string;
  generadoPor?: string;
};

type Unidad = Schema['Unidad']['type'];
type Cargo = Schema['Cargo']['type'];
type Pago = Schema['Pago']['type'];

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const COL_MES = 4; // D = enero … O = diciembre
const COL_TOTAL = 16; // P
const N = 16;
const letra = (c: number) => String.fromCharCode(64 + c);

type Fila = { concepto: string; reales: number[]; presupuesto: number | { formula: string; result: number } };

/** Ingresos por categoría y egresos por concepto de cada mes real del año. */
export function datosProyeccion(o: OpcionesProyeccion) {
  const anio = o.hasta.slice(0, 4);
  const meses: Balance[] = [];
  for (let m = `${anio}-01`; m <= o.hasta; m = mesSiguiente(m)) meses.push(calcularBalance(o.datos, m));
  const n = meses.length;
  const promedio = (xs: number[]) => redondear(xs.reduce((s, x) => s + x, 0) / Math.max(1, n));

  // Ingresos: todas las categorías (cuotas, recuperación, extraordinarias, multas, amenidades, ahorro, propias, otros).
  const ultimo = meses[n - 1];
  const ingresos = ultimo.categorias.map((c) => ({ key: c.key, concepto: c.label, reales: meses.map((b) => b.categorias.find((x) => x.key === c.key)?.monto ?? 0) }));

  // Egresos por concepto: fijo si hubo gasto todos los meses reales; si no, variable.
  // Todas las categorías de gasto (basura, gas, agua, luz, mantenimiento…) aunque no haya habido gasto.
  const conceptos = new Map<string, number[]>(CATEGORIAS_EGRESO.map((c) => [c, Array(n).fill(0)]));
  meses.forEach((b, i) => {
    for (const e of b.egresos) {
      if (!e.monto) continue;
      const v = conceptos.get(e.categoria) ?? Array(n).fill(0);
      v[i] += e.monto;
      conceptos.set(e.categoria, v);
    }
  });
  const egresos = [...conceptos].map(([concepto, reales]) => ({ concepto, reales: reales.map(redondear), promedio: promedio(reales) }));
  const orden = (a: { promedio: number }, b: { promedio: number }) => b.promedio - a.promedio;
  const fijos = egresos.filter((e) => e.reales.every((x) => x > 0)).sort(orden);
  // Variables: primero los que tuvieron gasto; al final las categorías sin gasto en el año.
  const variables = egresos.filter((e) => !e.reales.every((x) => x > 0)).sort(orden);
  return { anio, meses, n, saldoInicial: meses[0].saldoInicial, ingresos, fijos, variables, promedio };
}

export async function construirProyeccion(o: OpcionesProyeccion, logo?: string) {
  const ExcelJS = (await import('exceljs')).default;
  const d = datosProyeccion(o);
  const nU = o.unidades.length;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SIIA · soluciones inmobiliarias';
  wb.calcProperties.fullCalcOnLoad = true;
  const ws = wb.addWorksheet(`Proyección ${d.anio}`, {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 14, showGridLines: false }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
  });
  ws.columns = [{ width: 44 }, { width: 14 }, { width: 16 }, ...MESES.map(() => ({ width: 13 })), { width: 16 }];

  const ultimoReal = d.n; // meses 1..n reales
  const finReal = nombreMes(o.hasta).toLowerCase();
  encabezado(wb, ws, logo, N, `Proyección anual ${d.anio}`, [
    o.condominio,
    ultimoReal < 12 ? `Real de enero a ${finReal} · proyectado de ${MESES[ultimoReal].toLowerCase()} a diciembre` : `Enero a diciembre de ${d.anio} (real)`,
  ]);

  // ---------- Parámetros (como en el ejemplo: cuota, número de unidades e ingreso de cuotas mensual) ----------
  const editable = (c: Cell, fmt?: string) => {
    estilo(c, { b: true, size: 11, color: C.texto, fill: C.ambarClaro, h: 'right', fmt });
    c.border = { top: { style: 'thin', color: argb('E9C46A') }, bottom: { style: 'thin', color: argb('E9C46A') }, left: { style: 'thin', color: argb('E9C46A') }, right: { style: 'thin', color: argb('E9C46A') } };
  };
  const etiquetaParam = (r: number, texto: string) => {
    const c = ws.getCell(r, 1);
    c.value = texto;
    estilo(c, { b: true, size: 10, color: C.pizarra });
    ws.getRow(r).height = 20;
  };
  const P_CUOTA = 7;
  const P_UNIDADES = 8;
  const P_INGRESO = 9;
  const P_SALDO = 10;
  etiquetaParam(P_CUOTA, 'Cuota mensual de mantenimiento');
  ws.getCell(P_CUOTA, 2).value = o.cuotaMensual;
  editable(ws.getCell(P_CUOTA, 2), PESOS);
  etiquetaParam(P_UNIDADES, `Número de ${o.tipoUnidad || 'casas o departamentos'}`);
  ws.getCell(P_UNIDADES, 2).value = nU;
  editable(ws.getCell(P_UNIDADES, 2), '0');
  etiquetaParam(P_INGRESO, 'Proyección de ingreso de cuotas mensual');
  ws.getCell(P_INGRESO, 2).value = { formula: `B${P_CUOTA}*B${P_UNIDADES}`, result: redondear(o.cuotaMensual * nU) };
  estilo(ws.getCell(P_INGRESO, 2), { b: true, size: 11, color: C.tealOscuro, fill: C.tealClaro, h: 'right', fmt: PESOS });
  etiquetaParam(P_SALDO, 'Saldo al 1 de enero');
  ws.getCell(P_SALDO, 2).value = d.saldoInicial;
  estilo(ws.getCell(P_SALDO, 2), { b: true, size: 11, color: C.tealOscuro, fill: C.tealClaro, h: 'right', fmt: PESOS });

  // Cómo leerlo
  ws.mergeCells(P_CUOTA, 4, P_SALDO, N);
  const nota = ws.getCell(P_CUOTA, 4);
  nota.value = {
    richText: [
      { text: 'Cómo leer la proyección\n', font: { name: FUENTE, size: 10, bold: true, color: argb(C.tealOscuro) } },
      {
        text:
          `• Meses en blanco: real (pagos aprobados y egresos registrados en SIIA). Meses en ámbar: proyectado.\n` +
          `• Cuota corriente proyectada = cuota mensual × número de ${o.tipoUnidad || 'unidades'}. Cada gasto proyectado = su presupuesto mensual (promedio real de ${d.n} ${d.n === 1 ? 'mes' : 'meses'}).\n` +
          `• Gastos fijos: los que hubo todos los meses; variables: los demás. Las celdas ámbar con borde se pueden editar y el archivo recalcula todo.`,
        font: { name: FUENTE, size: 9, color: argb(C.pizarra) },
      },
    ],
  };
  nota.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
  nota.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(C.cebra) };

  // ---------- Encabezados de la tabla ----------
  const H1 = 13;
  const H2 = 14;
  const titulos = ['CONCEPTO', 'COSTO POR UNIDAD', 'PRESUPUESTO MENSUAL', ...MESES.map((m) => m.toUpperCase()), `TOTAL ${d.anio}`];
  ws.getRow(H1).height = 30;
  ws.getRow(H2).height = 16;
  titulos.forEach((t, i) => {
    const c = ws.getCell(H1, i + 1);
    c.value = t;
    estilo(c, { b: true, size: 10, color: C.blanco, fill: C.tealOscuro, h: i === 0 ? 'left' : 'center', wrap: true, indent: i === 0 ? 1 : 0 });
    const s = ws.getCell(H2, i + 1);
    const mes = i + 1 - COL_MES; // 0..11
    const real = mes >= 0 && mes < 12 && mes < ultimoReal;
    s.value = mes >= 0 && mes < 12 ? (real ? 'Real' : 'Proyectado') : '';
    estilo(s, { b: true, size: 8.5, color: real ? C.tealOscuro : C.ambar, fill: real ? C.tealClaro : C.ambarClaro, h: 'center' });
    bordeAbajo(s, C.tealOscuro);
  });

  let r = H2 + 1;
  const seccion = (texto: string, color = C.tealOscuro, fill = C.tealClaro) => {
    ws.getRow(r).height = 22;
    for (let c = 1; c <= N; c++) {
      const cell = ws.getCell(r, c);
      if (c === 1) cell.value = texto;
      estilo(cell, { b: true, size: 11, color, fill, indent: c === 1 ? 1 : 0 });
    }
    r++;
  };
  const sub = (texto: string) => {
    const cell = ws.getCell(r, 1);
    cell.value = texto;
    estilo(cell, { b: true, size: 10, color: C.pizarra, indent: 1 });
    bordeAbajo(cell, C.linea);
    ws.getRow(r).height = 18;
    r++;
  };

  /** Una fila de concepto: B = presupuesto / unidades, C = presupuesto, meses reales o =$C, P = suma. */
  const fila = (f: Fila, cebra: boolean) => {
    const fill = cebra ? C.cebra : undefined;
    const a = ws.getCell(r, 1);
    a.value = f.concepto;
    estilo(a, { size: 10, fill, indent: 2 });
    const presupuesto = typeof f.presupuesto === 'number' ? f.presupuesto : f.presupuesto.result;
    ws.getCell(r, 3).value = f.presupuesto;
    if (typeof f.presupuesto === 'number') editable(ws.getCell(r, 3), PESOS);
    else estilo(ws.getCell(r, 3), { b: true, fill: C.tealClaro, h: 'right', fmt: PESOS, color: C.tealOscuro });
    ws.getCell(r, 2).value = { formula: `IFERROR(C${r}/$B$${P_UNIDADES},0)`, result: nU ? redondear(presupuesto / nU) : 0 };
    estilo(ws.getCell(r, 2), { size: 10, fill, h: 'right', fmt: PESOS, color: C.pizarra });
    let total = 0;
    for (let m = 0; m < 12; m++) {
      const cell = ws.getCell(r, COL_MES + m);
      if (m < ultimoReal) {
        const v = f.reales[m] ?? 0;
        cell.value = v;
        total += v;
        estilo(cell, { size: 10, fill, h: 'right', fmt: PESOS, color: v === 0 ? 'B8BEC4' : C.texto });
      } else {
        cell.value = { formula: `$C${r}`, result: presupuesto };
        total += presupuesto;
        estilo(cell, { size: 10, italic: true, fill: C.ambarClaro, h: 'right', fmt: PESOS, color: C.ambar });
      }
    }
    const t = ws.getCell(r, COL_TOTAL);
    t.value = { formula: `SUM(${letra(COL_MES)}${r}:${letra(COL_MES + 11)}${r})`, result: redondear(total) };
    estilo(t, { b: true, size: 10, fill, h: 'right', fmt: PESOS });
    for (let c = 1; c <= N; c++) bordeAbajo(ws.getCell(r, c));
    r++;
  };

  /** Fila de totales con fórmula por columna (B, C, meses y total). */
  const totales = (etiqueta: string, formula: (col: string) => string, estiloFila: { color: string; fill: string; size?: number }) => {
    ws.getRow(r).height = 22;
    for (let c = 1; c <= N; c++) {
      const cell = ws.getCell(r, c);
      if (c === 1) cell.value = etiqueta;
      else cell.value = { formula: formula(letra(c)) };
      estilo(cell, { b: true, size: estiloFila.size ?? 10.5, color: estiloFila.color, fill: estiloFila.fill, h: c === 1 ? 'left' : 'right', fmt: c === 1 ? undefined : PESOS, indent: c === 1 ? 1 : 0 });
      bordeArriba(cell, estiloFila.color, 'thin');
      bordeAbajo(cell, estiloFila.color, 'thin');
    }
    return r++;
  };

  // ---------- Ingresos ----------
  seccion('INGRESOS');
  const iniIng = r;
  d.ingresos.forEach((x, i) =>
    fila(
      {
        concepto: x.concepto,
        reales: x.reales,
        presupuesto: x.key === 'CORRIENTE' ? { formula: `$B$${P_INGRESO}`, result: redondear(o.cuotaMensual * nU) } : d.promedio(x.reales),
      },
      i % 2 === 1,
    ),
  );
  const finIng = r - 1;
  const R_ING = totales('INGRESO TOTAL DEL MES', (col) => `SUM(${col}${iniIng}:${col}${finIng})`, { color: C.verde, fill: C.verdeClaro });
  r++;

  // ---------- Egresos ----------
  seccion('EGRESOS');
  const subtotales: number[] = [];
  for (const [nombre, lista] of [
    ['Fijos', d.fijos],
    ['Variables', d.variables],
  ] as const) {
    sub(`${nombre.toUpperCase()}`);
    const ini = r;
    if (!lista.length) {
      const c = ws.getCell(r, 1);
      c.value = `Sin gastos ${nombre.toLowerCase()} registrados en ${d.anio}.`;
      estilo(c, { size: 9.5, italic: true, color: C.gris, indent: 2 });
      r++;
    }
    lista.forEach((e, i) => fila({ concepto: e.concepto, reales: e.reales, presupuesto: e.promedio }, i % 2 === 1));
    const fin = r - 1;
    subtotales.push(totales(`Subtotal ${nombre.toLowerCase()}`, (col) => `SUM(${col}${ini}:${col}${fin})`, { color: C.pizarra, fill: C.cebra, size: 10 }));
  }
  const R_GASTO = totales('TOTAL DE GASTO', (col) => subtotales.map((s) => `${col}${s}`).join('+'), { color: C.rojo, fill: C.rojoClaro });
  r++;

  // ---------- Resultado ----------
  seccion('RESULTADO', C.blanco, C.tealOscuro);
  totales('Ingreso total del mes', (col) => `${col}${R_ING}`, { color: C.verde, fill: C.blanco });
  totales('Total de gasto', (col) => `${col}${R_GASTO}`, { color: C.rojo, fill: C.blanco });
  const R_BAL = totales('BALANCE INGRESOS − EGRESOS', (col) => `${col}${R_ING}-${col}${R_GASTO}`, { color: C.tealOscuro, fill: C.tealClaro, size: 11 });
  // Saldo acumulado: saldo al 1 de enero + balance de cada mes.
  ws.getRow(r).height = 22;
  for (let c = 1; c <= N; c++) {
    const cell = ws.getCell(r, c);
    if (c === 1) cell.value = 'SALDO ACUMULADO';
    else if (c >= COL_MES && c < COL_TOTAL)
      cell.value = { formula: c === COL_MES ? `$B$${P_SALDO}+${letra(c)}${R_BAL}` : `${letra(c - 1)}${r}+${letra(c)}${R_BAL}` };
    else if (c === COL_TOTAL) cell.value = { formula: `${letra(COL_TOTAL - 1)}${r}` };
    estilo(cell, { b: true, size: 11, color: C.blanco, fill: C.tealOscuro, h: c === 1 ? 'left' : 'right', fmt: c === 1 ? undefined : PESOS, indent: c === 1 ? 1 : 0 });
  }
  r++;

  // Formato condicional: balances negativos en rojo.
  ws.addConditionalFormatting({
    ref: `B${R_BAL}:${letra(N)}${R_BAL + 1}`,
    rules: [{ type: 'cellIs', operator: 'lessThan', formulae: ['0'], priority: 1, style: { font: { color: argb(C.rojo), bold: true }, fill: { type: 'pattern', pattern: 'solid', bgColor: argb(C.rojoClaro) } } }],
  });

  ws.pageSetup.printTitlesRow = `${H1}:${H2}`;

  // ---------- Cobranza de cargos por mes ----------
  const pu = datosPorUnidad(o);
  r += 1;
  seccion('COBRANZA DE CUOTAS Y CARGOS');
  const cob = pu.porMes;
  const filaCob = (etiqueta: string, valor: (m: number) => number | string | null, fmt: string, color = C.texto) => {
    const a = ws.getCell(r, 1);
    a.value = etiqueta;
    estilo(a, { size: 10, indent: 2 });
    for (let m = 0; m < 12; m++) {
      const cell = ws.getCell(r, COL_MES + m);
      const v = valor(m);
      cell.value = v;
      const proyectado = m >= ultimoReal;
      estilo(cell, { size: 10, h: 'right', fmt, italic: proyectado, fill: proyectado ? C.ambarClaro : undefined, color: proyectado ? C.ambar : color });
    }
    for (let c = 1; c <= N; c++) bordeAbajo(ws.getCell(r, c));
    return r++;
  };
  const rEmit = filaCob('Emitido (cuotas y cargos del mes)', (m) => (m < ultimoReal ? cob[m].emitido : redondear(o.cuotaMensual * nU)), PESOS);
  const rCobr = filaCob('Cobrado', (m) => (m < ultimoReal ? cob[m].cobrado : null), PESOS, C.verde);
  const rPorC = filaCob('Por cobrar', (m) => (m < ultimoReal ? cob[m].porCobrar : null), PESOS, C.rojo);
  filaCob('% de cobranza', (m) => (m < ultimoReal && cob[m].emitido ? cob[m].cobrado / cob[m].emitido : null), '0.0%', C.tealOscuro);
  filaCob(`${o.tipoUnidad ? o.tipoUnidad.charAt(0).toUpperCase() + o.tipoUnidad.slice(1) : 'Unidades'} al corriente`, (m) => (m < ultimoReal ? (cob[m].conCargo ? `${cob[m].alCorriente} de ${cob[m].conCargo}` : '—') : null), '@', C.tealOscuro);
  for (const [fila, f] of [
    [rEmit, 'SUM'],
    [rCobr, 'SUM'],
    [rPorC, 'SUM'],
  ] as const) {
    const t = ws.getCell(fila, COL_TOTAL);
    t.value = { formula: `${f}(${letra(COL_MES)}${fila}:${letra(COL_MES + 11)}${fila})` };
    estilo(t, { b: true, size: 10, h: 'right', fmt: PESOS });
  }

  // ---------- Detalle de gastos del año ----------
  r += 1;
  seccion(`DETALLE DE GASTOS ${d.anio}`);
  const gastos = o.datos.egresos.filter((e) => e.fecha.slice(0, 4) === d.anio && e.fecha.slice(0, 7) <= o.hasta).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const columnasDetalle: [string, number, number, 'left' | 'right' | 'center'][] = [
    ['Concepto', 1, 1, 'left'],
    ['Fecha', 2, 2, 'center'],
    ['Categoría', 3, 5, 'left'],
    ['Proveedor', 6, 8, 'left'],
    ['Forma de pago', 9, 11, 'left'],
    ['Se pagó con', 12, 15, 'left'],
    ['Monto', 16, 16, 'right'],
  ];
  const celdaDetalle = (fila: number, desde: number, hasta: number) => {
    if (hasta > desde) ws.mergeCells(fila, desde, fila, hasta);
    return ws.getCell(fila, desde);
  };
  ws.getRow(r).height = 22;
  for (const [t, a, b, h] of columnasDetalle) estilo(Object.assign(celdaDetalle(r, a, b), { value: t }), { b: true, size: 10, color: C.blanco, fill: C.pizarra, h, indent: h === 'left' ? 1 : 0 });
  r++;
  if (!gastos.length) {
    const c = celdaDetalle(r, 1, N);
    c.value = `Sin gastos registrados de enero a ${finReal}.`;
    estilo(c, { size: 9.5, italic: true, color: C.gris, indent: 1 });
    r++;
  }
  const iniDet = r;
  gastos.forEach((e, i) => {
    const fill = i % 2 ? C.cebra : undefined;
    const valores: (string | number | Date)[] = [
      e.concepto,
      new Date(`${e.fecha}T12:00:00`),
      e.categoria,
      e.proveedor || '—',
      e.formaPago || '—',
      e.fondo ? `Fondo ${e.fondo.charAt(0) + e.fondo.slice(1).toLowerCase()}` : 'Saldo general',
      e.monto,
    ];
    columnasDetalle.forEach(([, a, b, h], k) => {
      const c = celdaDetalle(r, a, b);
      c.value = valores[k];
      estilo(c, { size: 10, fill, h, fmt: k === 1 ? 'dd/mm/yyyy' : k === 6 ? PESOS : undefined, indent: h === 'left' ? 1 : 0 });
      for (let x = a; x <= b; x++) bordeAbajo(ws.getCell(r, x));
    });
    r++;
  });
  if (gastos.length) {
    ws.getRow(r).height = 22;
    const et = celdaDetalle(r, 1, 15);
    et.value = `Total de gastos (${gastos.length})`;
    estilo(et, { b: true, size: 10.5, color: C.rojo, fill: C.rojoClaro, indent: 1 });
    const tot = ws.getCell(r, 16);
    tot.value = { formula: `SUM(P${iniDet}:P${r - 1})`, result: redondear(gastos.reduce((s, e) => s + e.monto, 0)) };
    estilo(tot, { b: true, size: 10.5, color: C.rojo, fill: C.rojoClaro, h: 'right', fmt: PESOS });
    r++;
  }

  hojaPorUnidad(wb, o, pu, logo);
  firmarLibro(wb, o.generadoPor);
  return wb;
}

// ---------- Hoja 2: por casa o departamento ----------
type EstadoMes = 'A_TIEMPO' | 'TARDE' | 'REVISION' | 'DEBE' | 'POR_VENCER' | 'SIN_CARGO' | 'PROYECTADO';
const pad = (n: number) => String(n).padStart(2, '0');
/** Periodo (aaaa-mm) de un cargo: su periodo o, si no tiene, el mes en que vence o se creó. */
const periodoCargo = (c: Cargo) => c.periodo || String(c.vence ?? c.createdAt ?? '').slice(0, 7);
const suma = <T,>(l: T[], f: (x: T) => number) => redondear(l.reduce((s, x) => s + (f(x) || 0), 0));

/** Cada unidad mes por mes: qué se le cobró, qué pagó (a tiempo o tarde) y qué debe. */
export function datosPorUnidad(o: OpcionesProyeccion) {
  const anio = o.hasta.slice(0, 4);
  const reales = Number(o.hasta.slice(5, 7));
  const activos = o.datos.cargos.filter((c) => c.estado !== 'CANCELADO');
  const aprobados = o.datos.pagos.filter((p) => p.estado === 'VALIDADO');
  const pagoDe = new Map<string, Pago>();
  for (const p of aprobados) for (const id of p.cargoIds ?? []) if (id) pagoDe.set(id, p);
  const enRevision = o.datos.pagos.filter((p) => p.estado === 'EN_REVISION');
  const cubiertos = new Set(enRevision.flatMap((p) => (p.cargoIds ?? []).filter((x): x is string => !!x)));
  const revisionGeneral = new Set(enRevision.filter((p) => !(p.cargoIds ?? []).length).map((p) => p.unidadId));
  const residente = (u: Unidad) => (o.contactos?.[u.id] ?? []).map((x) => x.nombre || x.email).join(', ') || u.propietario || '';
  const unidades = [...o.unidades].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es', { numeric: true }));

  const filas = unidades.map((u) => {
    const suyos = activos.filter((c) => c.unidadId === u.id);
    const meses = Array.from({ length: 12 }, (_, i): { estado: EstadoMes; monto: number; generado: number; pagado: number } => {
      if (i >= reales) return { estado: 'PROYECTADO', monto: o.cuotaMensual, generado: 0, pagado: 0 };
      const cs = suyos.filter((c) => periodoCargo(c) === `${anio}-${pad(i + 1)}`);
      const generado = suma(cs, (c) => c.monto);
      const pagado = suma(
        cs.filter((c) => c.estado === 'PAGADO'),
        (c) => c.monto,
      );
      if (!cs.length) return { estado: 'SIN_CARGO', monto: 0, generado, pagado };
      const pend = cs.filter((c) => c.estado === 'PENDIENTE');
      if (!pend.length) {
        const tarde = cs.some((c) => {
          const p = pagoDe.get(c.id);
          return !!(c.vence && p && fechaIngreso(p) > c.vence);
        });
        return { estado: tarde ? 'TARDE' : 'A_TIEMPO', monto: pagado, generado, pagado };
      }
      const debe = suma(pend, (c) => c.monto);
      if (pend.every((c) => cubiertos.has(c.id) || revisionGeneral.has(u.id))) return { estado: 'REVISION', monto: debe, generado, pagado };
      const vencido = pend.some((c) => !c.vence || c.vence < o.hoy);
      return { estado: vencido ? 'DEBE' : 'POR_VENCER', monto: debe, generado, pagado };
    });
    const delAnio = suyos.filter((c) => periodoCargo(c).slice(0, 4) === anio && periodoCargo(c) <= o.hasta);
    const generado = suma(delAnio, (c) => c.monto);
    const pagado = suma(
      delAnio.filter((c) => c.estado === 'PAGADO'),
      (c) => c.monto,
    );
    const debe = suma(
      delAnio.filter((c) => c.estado === 'PENDIENTE'),
      (c) => c.monto,
    );
    const anterior = suma(
      suyos.filter((c) => c.estado === 'PENDIENTE' && periodoCargo(c) < `${anio}-01`),
      (c) => c.monto,
    );
    const alCorriente = !meses.some((m) => m.estado === 'DEBE') && !anterior;
    return { u, residente: residente(u), meses, generado, pagado, debe, anterior, porCobrar: redondear(debe + anterior), esperado: redondear(generado + o.cuotaMensual * (12 - reales)), alCorriente };
  });

  const porMes = Array.from({ length: 12 }, (_, i) => {
    const ms = filas.map((f) => f.meses[i]);
    const conCargo = ms.filter((m) => m.estado !== 'SIN_CARGO' && m.estado !== 'PROYECTADO');
    const emitido = suma(ms, (m) => m.generado);
    const cobrado = suma(ms, (m) => m.pagado);
    return { emitido, cobrado, porCobrar: redondear(emitido - cobrado), conCargo: conCargo.length, alCorriente: conCargo.filter((m) => m.estado === 'A_TIEMPO' || m.estado === 'TARDE').length };
  });
  return { anio, reales, filas, porMes };
}

const ESTILO_MES: Record<EstadoMes, { color: string; fill: string; fmt: string; texto: string }> = {
  A_TIEMPO: { color: C.verde, fill: 'CDEBD9', fmt: PESOS, texto: 'Pagó a tiempo' },
  TARDE: { color: C.ambar, fill: C.ambarClaro, fmt: '"Tarde "$#,##0.00', texto: 'Pagó tarde' },
  REVISION: { color: C.ambar, fill: C.ambarClaro, fmt: '"Revisión "$#,##0.00', texto: 'Comprobante en revisión' },
  DEBE: { color: C.rojo, fill: 'F9D5D1', fmt: '"Debe "$#,##0.00', texto: 'No pagó (debe)' },
  POR_VENCER: { color: C.pizarra, fill: C.tealClaro, fmt: '"Por vencer "$#,##0.00', texto: 'Aún no vence' },
  SIN_CARGO: { color: 'B8BEC4', fill: C.blanco, fmt: '@', texto: 'Sin cargo' },
  PROYECTADO: { color: C.gris, fill: C.cebra, fmt: PESOS, texto: 'Proyectado (cuota)' },
};

function hojaPorUnidad(wb: Workbook, o: OpcionesProyeccion, pu: ReturnType<typeof datosPorUnidad>, logo?: string) {
  const tipo = o.tipoUnidad || 'casas o departamentos';
  const NC = 20; // A unidad, B residente, C–N meses, O generado, P pagado, Q debe del año, R anterior, S por cobrar, T al cierre
  const ws = wb.addWorksheet(`Por ${o.tipoUnidad === 'departamentos' ? 'departamento' : o.tipoUnidad === 'casas' ? 'casa' : 'unidad'}`, {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 12, showGridLines: false }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
  });
  ws.columns = [{ width: 16 }, { width: 30 }, ...MESES.map(() => ({ width: 15 })), { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 16 }, { width: 17 }];
  encabezado(wb, ws, logo, NC, `Proyección por ${o.tipoUnidad === 'departamentos' ? 'departamento' : o.tipoUnidad === 'casas' ? 'casa' : 'unidad'} ${pu.anio}`, [
    o.condominio,
    `Cuánto generó, cuánto pagó y cuánto debe cada una · real de enero a ${nombreMes(o.hasta).toLowerCase()}`,
  ]);

  // Resumen
  const tot = (f: (x: (typeof pu.filas)[number]) => number) => suma(pu.filas, f);
  const alCorriente = pu.filas.filter((f) => f.alCorriente).length;
  const cajas: [string, string | number, string, string, string][] = [
    ['Al corriente', `${alCorriente} de ${pu.filas.length}`, `${tipo} sin adeudos vencidos`, C.verdeClaro, C.verde],
    ['Generado en el año', tot((f) => f.generado), 'cuotas y cargos emitidos', C.tealClaro, C.tealOscuro],
    ['Pagado', tot((f) => f.pagado), 'cargos cubiertos', C.verdeClaro, C.verde],
    ['Por cobrar', tot((f) => f.porCobrar), 'del año y de años anteriores', C.rojoClaro, C.rojo],
  ];
  ws.getRow(6).height = 16;
  ws.getRow(7).height = 26;
  ws.getRow(8).height = 15;
  cajas.forEach(([t, v, det, fill, color], k) => {
    const desde = 1 + k * 5;
    const hasta = desde + 4;
    for (const rr of [6, 7, 8]) ws.mergeCells(rr, desde, rr, hasta);
    const [a, b, c] = [ws.getCell(6, desde), ws.getCell(7, desde), ws.getCell(8, desde)];
    a.value = t.toUpperCase();
    b.value = v;
    c.value = det;
    estilo(a, { b: true, size: 8.5, color: C.pizarra, fill, h: 'center' });
    estilo(b, { b: true, size: 15, color, fill, h: 'center', fmt: typeof v === 'number' ? PESOS : undefined });
    estilo(c, { size: 9, color: C.gris, fill, h: 'center' });
    const blanco = { style: 'thick' as const, color: argb(C.blanco) };
    for (const x of [a, b, c]) x.border = { left: blanco, right: blanco };
  });

  // Leyenda de colores
  ws.getRow(10).height = 18;
  const leyenda = ws.getCell(10, 1);
  leyenda.value = 'Colores:';
  estilo(leyenda, { b: true, size: 9, color: C.pizarra });
  (['A_TIEMPO', 'TARDE', 'REVISION', 'DEBE', 'POR_VENCER', 'PROYECTADO'] as EstadoMes[]).forEach((e, k) => {
    const desde = 2 + k * 2 + (k ? 1 : 0);
    const hasta = k ? desde + 1 : desde + 2;
    ws.mergeCells(10, desde, 10, hasta);
    const c = ws.getCell(10, desde);
    c.value = ESTILO_MES[e].texto;
    estilo(c, { b: true, size: 9, color: ESTILO_MES[e].color, fill: ESTILO_MES[e].fill, h: 'center' });
  });

  // Encabezados
  const H = 12;
  ws.getRow(H).height = 32;
  const titulos = [
    o.tipoUnidad === 'departamentos' ? 'DEPARTAMENTO' : o.tipoUnidad === 'casas' ? 'CASA' : 'UNIDAD',
    'RESIDENTE',
    ...MESES.map((m, i) => `${m.toUpperCase()}${i >= pu.reales ? '\n(proyectado)' : ''}`),
    `GENERADO ${pu.anio}`,
    'PAGADO',
    'DEBE DEL AÑO',
    'ADEUDO AÑOS ANTERIORES',
    'TOTAL POR COBRAR',
    'ESPERADO AL CIERRE',
  ];
  titulos.forEach((t, i) => {
    const c = ws.getCell(H, i + 1);
    c.value = t;
    const proyectado = i >= 2 && i < 14 && i - 2 >= pu.reales;
    estilo(c, { b: true, size: 9.5, color: proyectado ? C.ambar : C.blanco, fill: proyectado ? C.ambarClaro : i >= 14 ? C.pizarra : C.tealOscuro, h: i < 2 ? 'left' : 'center', wrap: true, indent: i < 2 ? 1 : 0 });
  });

  let r = H + 1;
  const ini = r;
  pu.filas.forEach((f, k) => {
    const cebra = k % 2 ? C.cebra : undefined;
    const a = ws.getCell(r, 1);
    a.value = f.u.etiqueta;
    estilo(a, { b: true, size: 10, fill: cebra, indent: 1 });
    const b = ws.getCell(r, 2);
    b.value = f.residente || '—';
    estilo(b, { size: 9.5, fill: cebra, color: f.residente ? C.texto : C.gris });
    f.meses.forEach((m, i) => {
      const c = ws.getCell(r, 3 + i);
      const e = ESTILO_MES[m.estado];
      c.value = m.estado === 'SIN_CARGO' ? '—' : m.monto;
      estilo(c, { size: 9.5, b: m.estado === 'DEBE', italic: m.estado === 'PROYECTADO', color: e.color, fill: e.fill, h: m.estado === 'SIN_CARGO' ? 'center' : 'right', fmt: e.fmt });
      c.border = { bottom: { style: 'thin', color: argb(C.blanco) }, right: { style: 'thin', color: argb(C.blanco) } };
    });
    const totales: [number, string, string][] = [
      [f.generado, C.texto, ''],
      [f.pagado, C.verde, ''],
      [f.debe, f.debe ? C.rojo : 'B8BEC4', ''],
      [f.anterior, f.anterior ? C.rojo : 'B8BEC4', ''],
      [f.porCobrar, f.porCobrar ? C.rojo : C.verde, ''],
      [f.esperado, C.pizarra, ''],
    ];
    totales.forEach(([v, color], i) => {
      const c = ws.getCell(r, 15 + i);
      c.value = i === 4 ? { formula: `Q${r}+R${r}`, result: v } : v;
      estilo(c, { size: 10, b: i === 4, color, fill: cebra, h: 'right', fmt: PESOS });
      bordeAbajo(c);
    });
    bordeAbajo(a);
    bordeAbajo(b);
    r++;
  });
  const fin = r - 1;

  // Totales
  ws.getRow(r).height = 22;
  for (let c = 1; c <= NC; c++) {
    const cell = ws.getCell(r, c);
    if (c === 1) cell.value = 'TOTAL';
    else if (c >= 3 && c <= 14) {
      const m = pu.porMes[c - 3];
      cell.value = c - 3 < pu.reales ? (m.conCargo ? `${m.alCorriente} de ${m.conCargo} al día` : '—') : null;
    } else if (c >= 15) cell.value = { formula: `SUM(${letra(c)}${ini}:${letra(c)}${fin})` };
    estilo(cell, { b: true, size: c >= 3 && c <= 14 ? 9 : 10.5, color: C.tealOscuro, fill: C.tealClaro, h: c === 1 ? 'left' : c <= 14 ? 'center' : 'right', fmt: c >= 15 ? PESOS : undefined, indent: c === 1 ? 1 : 0 });
    bordeArriba(cell, C.tealOscuro, 'medium');
  }
  r += 2;
  const nota = ws.getCell(r, 1);
  ws.mergeCells(r, 1, r, NC);
  nota.value =
    'Cada mes muestra lo que se cobró a la unidad ese mes (cuota y cargos): en verde lo pagado a tiempo; en ámbar lo pagado después del vencimiento o con comprobante en revisión; ' +
    'en rojo lo que debe; los meses proyectados muestran la cuota mensual esperada. «Esperado al cierre» = generado en el año + cuota × meses que faltan.';
  estilo(nota, { size: 9, italic: true, color: C.pizarra, wrap: true });
  ws.getRow(r).height = 30;
  ws.pageSetup.printTitlesRow = `${H}:${H}`;
}

const nombreArchivo = (o: OpcionesProyeccion) => `Proyección anual ${o.hasta.slice(0, 4)} ${o.condominio.replace(/[\\/:*?"<>|]+/g, '').trim()}.xlsx`;

export async function descargarProyeccionAnual(o: OpcionesProyeccion) {
  const wb = await construirProyeccion(o, await logoBase64());
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo(o);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
