// Excel de pagos procesados del condominio (Finanzas › Ingresos › Pagos procesados) con el formato de los reportes SIIA
// (logotipo, indicadores, tablas con totales y pie de página): cada pago aprobado o rechazado en un rango de meses,
// resumen por mes y por unidad. ExcelJS se carga solo al descargar.
import type { Workbook, Worksheet } from 'exceljs';
import type { Schema } from '../api';
import { leerFirma } from './Firma';
import { C, FECHA, FUENTE, PESOS, argb, estilo, fechaXls, firmarLibro, logoBase64 } from './reporteFinanzas';
import { encabezado, encabezadosTabla, filaTabla, filaTotal, indicadores, pintarEstado, tituloSeccion, type Col, type Contacto } from './reporteCobranza';
import { fechaIngreso, fechaMX, nombreMes, redondear } from './balance';

type Pago = Schema['Pago']['type'];
type Cargo = Schema['Cargo']['type'];
type Unidad = Schema['Unidad']['type'];

const fechaLarga = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
const plural = (n: number, s: string, p = `${s}s`) => `${n} ${n === 1 ? s : p}`;
const limpio = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '').trim();
const ESTADO_PAGO: Record<string, string> = { VALIDADO: 'Aprobado', RECHAZADO: 'Rechazado', EN_REVISION: 'En revisión' };

function hoja(wb: Workbook, nombre: string, cols: Col[], pie: string, condominio: string, tab: string, orientation: 'portrait' | 'landscape' = 'portrait') {
  const ws = wb.addWorksheet(nombre, {
    views: [{ showGridLines: false }],
    properties: { tabColor: argb(tab) },
    pageSetup: { orientation, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.35, right: 0.35, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.25 } },
    headerFooter: { oddFooter: `&L&8&K989898SIIA · ${pie}&C&8&K989898${condominio}&R&8&K989898Página &P de &N` },
  });
  ws.columns = cols.map((c) => ({ width: c.width }));
  return ws;
}

/** Renglón combinado de aviso (p. ej. «Sin pagos en el periodo»). */
function vacio(ws: Worksheet, r: number, n: number, texto: string) {
  ws.mergeCells(r, 1, r, n);
  const c = ws.getCell(r, 1);
  c.value = texto;
  estilo(c, { b: true, color: C.gris, fill: C.cebra, h: 'center' });
  ws.getRow(r).height = 22;
}

function nota(ws: Worksheet, r: number, n: number, texto: string) {
  ws.mergeCells(r, 1, r + 1, n);
  const c = ws.getCell(r, 1);
  c.value = texto;
  estilo(c, { size: 8.5, color: C.gris, wrap: true });
  c.alignment = { ...c.alignment, vertical: 'top' };
}

async function bajar(wb: Workbook, nombre: string) {
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ===================== Pagos procesados del condominio =====================
export type OpcionesPagos = {
  condominio: string;
  desde: string; // AAAA-MM
  hasta: string; // AAAA-MM
  hoy: string;
  unidades: Unidad[];
  pagos: Pago[];
  cargos: Cargo[];
  contactos: Record<string, Contacto[]>;
  generadoPor?: string;
};

/** Pagos aprobados o rechazados cuyo mes de pago cae en el rango (sin Excel, para probarlo). */
export function calcularPagos(o: OpcionesPagos) {
  const lista = o.pagos
    .filter((p) => p.estado === 'VALIDADO' || p.estado === 'RECHAZADO')
    .filter((p) => {
      const mes = fechaIngreso(p).slice(0, 7);
      return mes >= o.desde && mes <= o.hasta;
    })
    .sort((a, b) => fechaIngreso(a).localeCompare(fechaIngreso(b)) || String(a.folio ?? '').localeCompare(String(b.folio ?? '')));
  const aprobados = lista.filter((p) => p.estado === 'VALIDADO');
  const rechazados = lista.filter((p) => p.estado === 'RECHAZADO');
  const suma = (l: Pago[]) => redondear(l.reduce((s, p) => s + p.monto, 0));
  const meses: string[] = [];
  for (let m = o.desde; m <= o.hasta; ) {
    meses.push(m);
    const [a, mm] = m.split('-').map(Number);
    m = mm === 12 ? `${a + 1}-01` : `${a}-${String(mm + 1).padStart(2, '0')}`;
  }
  const porMes = meses.map((m) => {
    const ap = aprobados.filter((p) => fechaIngreso(p).startsWith(m));
    const re = rechazados.filter((p) => fechaIngreso(p).startsWith(m));
    return { mes: m, nAprobados: ap.length, aprobado: suma(ap), nRechazados: re.length, rechazado: suma(re), unidades: new Set(ap.map((p) => p.unidadId)).size };
  });
  const unidades = [...o.unidades].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es', { numeric: true }));
  const porUnidad = unidades.map((u) => {
    const ap = aprobados.filter((p) => p.unidadId === u.id);
    return { u, nAprobados: ap.length, aprobado: suma(ap), nRechazados: rechazados.filter((p) => p.unidadId === u.id).length, ultimo: ap.map(fechaIngreso).sort().pop() };
  });
  return {
    lista,
    porMes,
    porUnidad,
    totales: { aprobado: suma(aprobados), nAprobados: aprobados.length, rechazado: suma(rechazados), nRechazados: rechazados.length, unidades: new Set(aprobados.map((p) => p.unidadId)).size },
  };
}

export async function construirPagosExcel(o: OpcionesPagos, logo?: string) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SIIA · soluciones inmobiliarias';
  const rango = o.desde === o.hasta ? nombreMes(o.desde) : `${nombreMes(o.desde)} a ${nombreMes(o.hasta)}`;
  wb.title = `Pagos procesados ${o.condominio} ${rango}`;
  const x = calcularPagos(o);
  const t = x.totales;
  const linea2 = `${rango} · Elaborado el ${fechaLarga(o.hoy)}`;
  const etiqueta = new Map(o.unidades.map((u) => [u.id, u.etiqueta]));
  const residente = (id: string) => (o.contactos[id] ?? []).map((c) => c.nombre || c.email).join(', ') || o.unidades.find((u) => u.id === id)?.propietario || '';
  const cargoPorId = new Map(o.cargos.map((c) => [c.id, c]));
  const validador = (p: Pago) => leerFirma(p.firmaCambio)?.nombre ?? p.validadoPor ?? '';

  // ----- Hoja 1: detalle -----
  const cols: Col[] = [
    { header: 'Folio', width: 15 },
    { header: 'Fecha de pago', width: 12, fmt: FECHA, h: 'center' },
    { header: 'Casa o departamento', width: 17 },
    { header: 'Residente', width: 24, wrap: true },
    { header: 'Conceptos cubiertos', width: 36, wrap: true },
    { header: 'Referencia', width: 16, wrap: true },
    { header: 'Monto', width: 14, fmt: PESOS },
    { header: 'Estado', width: 12, h: 'center' },
    { header: 'Aprobado o rechazado por', width: 22, wrap: true },
    { header: 'Fecha de revisión', width: 12, fmt: FECHA, h: 'center' },
    { header: 'Motivo del rechazo', width: 26, wrap: true },
  ];
  const n = cols.length;
  const ws = hoja(wb, 'Pagos procesados', cols, 'Pagos procesados', o.condominio, C.tealOscuro, 'landscape');
  encabezado(wb, ws, logo, n, 'PAGOS PROCESADOS', [o.condominio, linea2]);
  indicadores(ws, 6, [
    { titulo: 'Ingresado', valor: t.aprobado, detalle: `${plural(t.nAprobados, 'recibo')} aprobado${t.nAprobados === 1 ? '' : 's'}`, fmt: PESOS, fill: C.verdeClaro, color: C.verde, desde: 1, hasta: 3 },
    { titulo: 'Unidades que pagaron', valor: t.unidades, detalle: `de ${plural(o.unidades.length, 'unidad', 'unidades')}`, fmt: '0', fill: C.tealClaro, desde: 4, hasta: 5 },
    { titulo: 'Pago promedio', valor: t.nAprobados ? redondear(t.aprobado / t.nAprobados) : 0, detalle: 'por recibo aprobado', fmt: PESOS, fill: C.tealClaro, desde: 6, hasta: 7 },
    { titulo: 'Rechazados', valor: t.nRechazados, detalle: `${t.rechazado.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })} en comprobantes`, fmt: '0', fill: C.rojoClaro, color: C.rojo, desde: 8, hasta: 9 },
    { titulo: 'Periodo', valor: x.porMes.length, detalle: plural(x.porMes.length, 'mes', 'meses'), fmt: '0', fill: C.tealOscuro, desde: 10, hasta: 11 },
  ]);
  let r = 10;
  tituloSeccion(ws, r, n, `DETALLE DE PAGOS · ${rango.toUpperCase()}`, 'Comprobantes revisados por la administración en el periodo, por fecha de pago: aprobados (con recibo) y rechazados (con el motivo que vio el residente).');
  r += 2;
  encabezadosTabla(ws, r, cols);
  ws.views = [{ state: 'frozen', ySplit: r, showGridLines: false }];
  ws.pageSetup.printTitlesRow = `${r}:${r}`;
  const ini = r + 1;
  if (x.lista.length) {
    x.lista.forEach((p, k) => {
      const conceptos = (p.cargoIds ?? []).map((id) => (id ? cargoPorId.get(id)?.concepto : undefined)).filter(Boolean).join('\n') || 'Pago a cuenta';
      const rechazado = p.estado === 'RECHAZADO';
      filaTabla(
        ws,
        ini + k,
        cols,
        [
          p.folio ?? '—',
          fechaXls(fechaIngreso(p)),
          etiqueta.get(p.unidadId) ?? '',
          residente(p.unidadId),
          conceptos,
          p.referencia ?? '',
          p.monto,
          ESTADO_PAGO[p.estado ?? ''] ?? '',
          validador(p),
          fechaXls(p.validadoEn ? fechaMX(p.validadoEn) : null),
          rechazado ? (p.nota ?? '') : '',
        ],
        k % 2 === 1,
      );
      pintarEstado(ws, ini + k, 8);
      if (rechazado) ws.getCell(ini + k, 7).font = { name: FUENTE, size: 10, strike: true, color: argb(C.gris) };
    });
    r = ini + x.lista.length;
    filaTotal(ws, r, n, `TOTAL APROBADO (${plural(t.nAprobados, 'recibo')})`, { 6: t.aprobado });
    ws.autoFilter = { from: { row: ini - 1, column: 1 }, to: { row: r - 1, column: n } };
  } else {
    r = ini;
    vacio(ws, r, n, 'Sin pagos procesados en el periodo.');
  }
  nota(ws, r + 2, n, 'Notas: el total suma solo los pagos aprobados; los rechazados aparecen tachados y no cuentan como ingreso. La fecha de pago es la que indicó el residente (o la de aprobación si no la indicó).');

  // ----- Hoja 2: resumen por mes -----
  const colsM: Col[] = [
    { header: 'Mes', width: 22 },
    { header: 'Recibos aprobados', width: 14, h: 'center' },
    { header: 'Unidades que pagaron', width: 14, h: 'center' },
    { header: 'Monto aprobado', width: 17, fmt: PESOS },
    { header: 'Rechazados', width: 12, h: 'center' },
    { header: 'Monto rechazado', width: 17, fmt: PESOS },
  ];
  const nM = colsM.length;
  const ws2 = hoja(wb, 'Resumen por mes', colsM, 'Pagos procesados por mes', o.condominio, C.teal);
  encabezado(wb, ws2, logo, nM, 'RESUMEN POR MES', [o.condominio, linea2]);
  r = 6;
  tituloSeccion(ws2, r, nM, 'INGRESOS POR PAGOS APROBADOS');
  r += 2;
  encabezadosTabla(ws2, r, colsM);
  const iniM = r + 1;
  x.porMes.forEach((m, k) => filaTabla(ws2, iniM + k, colsM, [nombreMes(m.mes), m.nAprobados, m.unidades, m.aprobado, m.nRechazados, m.rechazado], k % 2 === 1));
  r = iniM + x.porMes.length;
  filaTotal(ws2, r, nM, 'TOTAL', { 1: String(t.nAprobados), 2: String(t.unidades), 3: t.aprobado, 4: String(t.nRechazados), 5: t.rechazado });

  // ----- Hoja 3: por unidad -----
  const colsU: Col[] = [
    { header: 'Casa o departamento', width: 20 },
    { header: 'Residente', width: 30, wrap: true },
    { header: 'Recibos aprobados', width: 14, h: 'center' },
    { header: 'Monto aprobado', width: 17, fmt: PESOS },
    { header: 'Rechazados', width: 12, h: 'center' },
    { header: 'Último pago', width: 13, fmt: FECHA, h: 'center' },
  ];
  const nU = colsU.length;
  const ws3 = hoja(wb, 'Por unidad', colsU, 'Pagos procesados por unidad', o.condominio, C.teal);
  encabezado(wb, ws3, logo, nU, 'PAGOS POR UNIDAD', [o.condominio, linea2]);
  r = 6;
  tituloSeccion(ws3, r, nU, 'CONCENTRADO DE UNIDADES', 'Unidades sin pagos aprobados en el periodo aparecen en gris.');
  r += 2;
  encabezadosTabla(ws3, r, colsU);
  ws3.views = [{ state: 'frozen', ySplit: r, showGridLines: false }];
  const iniU = r + 1;
  x.porUnidad.forEach((u, k) => {
    filaTabla(ws3, iniU + k, colsU, [u.u.etiqueta, residente(u.u.id), u.nAprobados, u.aprobado, u.nRechazados, fechaXls(u.ultimo)], k % 2 === 1);
    if (!u.nAprobados) for (let c = 1; c <= nU; c++) ws3.getCell(iniU + k, c).font = { name: FUENTE, size: 10, color: argb('B8BEC4') };
  });
  r = iniU + x.porUnidad.length;
  filaTotal(ws3, r, nU, `TOTAL (${plural(x.porUnidad.length, 'unidad', 'unidades')})`, { 2: String(t.nAprobados), 3: t.aprobado, 4: String(t.nRechazados) });
  ws3.autoFilter = { from: { row: iniU - 1, column: 1 }, to: { row: r - 1, column: nU } };

  firmarLibro(wb, o.generadoPor);
  return wb;
}

export async function descargarPagosExcel(o: OpcionesPagos) {
  const wb = await construirPagosExcel(o, await logoBase64());
  const rango = o.desde === o.hasta ? nombreMes(o.desde) : `${nombreMes(o.desde)} a ${nombreMes(o.hasta)}`;
  await bajar(wb, `Pagos procesados ${limpio(o.condominio)} ${rango}.xlsx`);
}
