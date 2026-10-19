// Reporte de cobranza en Excel (Finanzas › Ingresos), independiente del estado financiero:
// 1) «Cobranza del mes»: todas las unidades con lo pagado (recibo aprobado), por aprobar y sin pago del mes, con
//    sus sumas, y la lista de residentes morosos con lo que deben a la fecha.
// 2) «Estado por unidad»: situación de cada unidad (al corriente, moroso o en revisión), antigüedad del adeudo y
//    total que debe. ExcelJS se carga solo al descargar.
import type { Workbook, Worksheet } from 'exceljs';
import type { Schema } from '../api';
import { C, FECHA, FUENTE, PESOS, PORC, argb, bordeAbajo, bordeArriba, estilo, fechaXls, firmarLibro, logoBase64 } from './reporteFinanzas';
import { fechaIngreso, nombreMes, redondear } from './balance';

type Pago = Schema['Pago']['type'];
type Cargo = Schema['Cargo']['type'];
type Unidad = Schema['Unidad']['type'];
export type Contacto = { nombre: string | null; telefono: string | null; email: string };

export type OpcionesCobranza = {
  condominio: string;
  periodo: string;
  diaVencimiento?: number | null;
  hoy: string;
  unidades: Unidad[];
  cargos: Cargo[];
  pagos: Pago[];
  contactos: Record<string, Contacto[]>;
  generadoPor?: string;
};

const dias = (desde: string, hasta: string) => Math.max(0, Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86400000));
const fechaLarga = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
const plural = (n: number, s: string, p = `${s}s`) => `${n} ${n === 1 ? s : p}`;

/** Cálculos del reporte (sin Excel): sirven también para probarlos. */
export function calcularCobranza(o: OpcionesCobranza) {
  const activos = o.cargos.filter((c) => c.estado !== 'CANCELADO');
  const enRevision = o.pagos.filter((p) => p.estado === 'EN_REVISION');
  const cubiertos = new Set(enRevision.flatMap((p) => (p.cargoIds ?? []).filter((x): x is string => !!x)));
  // Un comprobante «a cuenta» (sin cargos indicados) cubre toda la unidad mientras se revisa.
  const revisionGeneral = new Set(enRevision.filter((p) => !(p.cargoIds ?? []).length).map((p) => p.unidadId));
  const enRevisionCargo = (c: Cargo) => cubiertos.has(c.id) || revisionGeneral.has(c.unidadId);
  const aprobados = o.pagos.filter((p) => p.estado === 'VALIDADO');
  const folioDe = new Map<string, Pago>();
  for (const p of aprobados) for (const id of p.cargoIds ?? []) if (id) folioDe.set(id, p);

  // Fecha límite del mes: la de las cuotas del periodo o el día de vencimiento configurado.
  const cuotasMes = activos.filter((c) => c.periodo === o.periodo && c.id.endsWith('#cuota') && c.vence);
  const limite = cuotasMes.map((c) => c.vence!).sort()[0] ?? `${o.periodo}-${String(Math.min(Math.max(Number(o.diaVencimiento) || 10, 1), 28)).padStart(2, '0')}`;
  const vencioLimite = o.hoy > limite;

  const contactos = (u: Unidad) => o.contactos[u.id] ?? [];
  const residente = (u: Unidad) => contactos(u).map((x) => x.nombre || x.email).join(', ') || u.propietario || '';
  const telefono = (u: Unidad) => contactos(u).map((x) => x.telefono).filter(Boolean).join(', ');
  const correo = (u: Unidad) => contactos(u).map((x) => x.email).join(', ');
  const unidades = [...o.unidades].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es', { numeric: true }));

  const mes = unidades.map((u) => {
    const suyos = activos.filter((c) => c.unidadId === u.id && c.periodo === o.periodo);
    const pagado = redondear(suyos.filter((c) => c.estado === 'PAGADO').reduce((s, c) => s + c.monto, 0));
    const pend = suyos.filter((c) => c.estado === 'PENDIENTE');
    const porAprobar = redondear(pend.filter(enRevisionCargo).reduce((s, c) => s + c.monto, 0));
    const sinPago = redondear(pend.filter((c) => !enRevisionCargo(c)).reduce((s, c) => s + c.monto, 0));
    const total = redondear(pagado + porAprobar + sinPago);
    const estado = !suyos.length ? 'Sin cargos' : !porAprobar && !sinPago ? 'Pagado' : !sinPago ? 'Por aprobar' : pagado || porAprobar ? 'Parcial' : 'Sin pago';
    const folios = [...new Set(suyos.map((c) => folioDe.get(c.id)?.folio).filter(Boolean))].join(', ');
    return { u, residente: residente(u), total, pagado, porAprobar, sinPago, estado, folios, conceptos: suyos.length };
  });

  const estado = unidades.map((u) => {
    const pend = activos.filter((c) => c.unidadId === u.id && c.estado === 'PENDIENTE');
    const vencidos = pend.filter((c) => c.vence && c.vence < o.hoy);
    const vencidosSinComprobante = vencidos.filter((c) => !enRevisionCargo(c));
    const tramos = [0, 0, 0, 0];
    for (const c of vencidos) {
      const d = dias(c.vence!, o.hoy);
      tramos[d <= 30 ? 0 : d <= 60 ? 1 : d <= 90 ? 2 : 3] += c.monto;
    }
    const vencido = redondear(vencidos.reduce((s, c) => s + c.monto, 0));
    const porVencer = redondear(pend.filter((c) => !(c.vence && c.vence < o.hoy)).reduce((s, c) => s + c.monto, 0));
    const revision = redondear(enRevision.filter((p) => p.unidadId === u.id).reduce((s, p) => s + p.monto, 0));
    const masAntiguo = vencidosSinComprobante.map((c) => c.vence!).sort()[0];
    const ultimo = aprobados
      .filter((p) => p.unidadId === u.id)
      .map(fechaIngreso)
      .sort()
      .pop();
    const situacion = vencidosSinComprobante.length ? 'Moroso' : vencidos.length ? 'En revisión' : 'Al corriente';
    return {
      u,
      residente: residente(u),
      telefono: telefono(u),
      correo: correo(u),
      situacion,
      cargosVencidos: vencidosSinComprobante.length,
      adeudoMoroso: redondear(vencidosSinComprobante.reduce((s, c) => s + c.monto, 0)),
      masAntiguo,
      diasAtraso: masAntiguo ? dias(masAntiguo, o.hoy) : 0,
      tramos: tramos.map(redondear),
      vencido,
      porVencer,
      total: redondear(vencido + porVencer),
      revision,
      ultimo,
    };
  });
  const morosos = estado.filter((x) => x.situacion === 'Moroso').sort((a, b) => b.adeudoMoroso - a.adeudoMoroso || b.diasAtraso - a.diasAtraso);
  const suma = <T,>(l: T[], f: (x: T) => number) => redondear(l.reduce((s, x) => s + f(x), 0));
  return {
    limite,
    vencioLimite,
    mes,
    estado,
    morosos,
    totales: {
      emitido: suma(mes, (x) => x.total),
      pagado: suma(mes, (x) => x.pagado),
      porAprobar: suma(mes, (x) => x.porAprobar),
      sinPago: suma(mes, (x) => x.sinPago),
      nPagado: mes.filter((x) => x.estado === 'Pagado').length,
      nPorAprobar: mes.filter((x) => x.porAprobar > 0).length,
      nSinPago: mes.filter((x) => x.sinPago > 0).length,
      carteraVencida: suma(estado, (x) => x.vencido),
      carteraTotal: suma(estado, (x) => x.total),
      adeudoMorosos: suma(morosos, (x) => x.adeudoMoroso),
    },
  };
}

// ---------- Formato ----------
function encabezado(wb: Workbook, ws: Worksheet, logo: string | undefined, ultimaCol: number, titulo: string, lineas: [string, string]) {
  [1, 2, 3].forEach((r) => (ws.getRow(r).height = 22));
  if (logo) ws.addImage(wb.addImage({ base64: logo, extension: 'png' }), { tl: { col: 0.15, row: 0.25 }, ext: { width: 175, height: 59 } });
  const desde = Math.max(3, ultimaCol - 4);
  for (const [r, texto, s] of [
    [1, titulo, { b: true, size: 16, color: C.tealOscuro }],
    [2, lineas[0], { b: true, size: 12, color: C.texto }],
    [3, lineas[1], { size: 10, color: C.gris }],
  ] as const) {
    ws.mergeCells(r, desde, r, ultimaCol);
    const c = ws.getCell(r, desde);
    c.value = texto;
    estilo(c, { ...s, h: 'right' });
  }
  ws.getRow(4).height = 5;
  for (let c = 1; c <= ultimaCol; c++) ws.getCell(4, c).fill = { type: 'pattern', pattern: 'solid', fgColor: argb(C.teal) };
  ws.getRow(5).height = 10;
}

/** Recuadros de indicadores en una fila: [titulo, valor, detalle, formato, colorDeFondo]. */
function indicadores(ws: Worksheet, r: number, cajas: { titulo: string; valor: number; detalle: string; fmt: string; fill: string; color?: string; desde: number; hasta: number }[]) {
  ws.getRow(r).height = 18;
  ws.getRow(r + 1).height = 28;
  ws.getRow(r + 2).height = 16;
  for (const k of cajas) {
    const oscuro = k.fill === C.tealOscuro;
    for (let rr = r; rr <= r + 2; rr++) ws.mergeCells(rr, k.desde, rr, k.hasta);
    const [t, v, d] = [ws.getCell(r, k.desde), ws.getCell(r + 1, k.desde), ws.getCell(r + 2, k.desde)];
    t.value = k.titulo.toUpperCase();
    v.value = k.valor;
    d.value = k.detalle;
    estilo(t, { b: true, size: 8.5, color: oscuro ? 'CFF3EF' : C.pizarra, fill: k.fill, h: 'center' });
    estilo(v, { b: true, size: 16, color: oscuro ? C.blanco : (k.color ?? C.texto), fill: k.fill, h: 'center', fmt: k.fmt });
    estilo(d, { size: 9, color: oscuro ? 'CFF3EF' : C.gris, fill: k.fill, h: 'center' });
    const blanco = { style: 'thick' as const, color: argb(C.blanco) };
    for (const c of [t, v, d]) c.border = { left: blanco, right: blanco };
  }
}

type Col = { header: string; width?: number; fmt?: string; h?: 'left' | 'center' | 'right'; wrap?: boolean };
function encabezadosTabla(ws: Worksheet, r: number, cols: Col[], desde = 1) {
  ws.getRow(r).height = 30;
  cols.forEach((c, i) => {
    const cell = ws.getCell(r, desde + i);
    cell.value = c.header;
    estilo(cell, { b: true, size: 10, color: C.blanco, fill: C.tealOscuro, h: c.h ?? (c.fmt === PESOS ? 'right' : 'left'), wrap: true });
  });
}
function filaTabla(ws: Worksheet, r: number, cols: Col[], valores: (string | number | Date | null)[], cebra: boolean, desde = 1) {
  valores.forEach((v, i) => {
    const c = cols[i];
    const cell = ws.getCell(r, desde + i);
    cell.value = v;
    estilo(cell, { fmt: c.fmt, h: c.h ?? (c.fmt === PESOS ? 'right' : 'left'), fill: cebra ? C.cebra : undefined, wrap: c.wrap, color: v === 0 && c.fmt === PESOS ? 'B8BEC4' : undefined });
    bordeAbajo(cell);
  });
}
function filaTotal(ws: Worksheet, r: number, n: number, etiqueta: string, valores: Record<number, number | string>, desde = 1) {
  ws.getRow(r).height = 22;
  for (let i = 0; i < n; i++) {
    const cell = ws.getCell(r, desde + i);
    const v = i === 0 ? etiqueta : valores[i];
    if (v !== undefined) cell.value = v;
    estilo(cell, { b: true, size: 11, color: C.tealOscuro, fill: C.tealClaro, h: i === 0 ? 'left' : typeof v === 'number' ? 'right' : 'center', fmt: typeof v === 'number' ? PESOS : undefined });
    bordeArriba(cell, C.tealOscuro, 'medium');
    bordeAbajo(cell, C.tealOscuro, 'medium');
  }
}
function tituloSeccion(ws: Worksheet, r: number, n: number, texto: string, sub?: string) {
  ws.mergeCells(r, 1, r, n);
  const c = ws.getCell(r, 1);
  c.value = texto;
  estilo(c, { b: true, size: 12, color: C.blanco, fill: C.tealOscuro, indent: 1 });
  ws.getRow(r).height = 24;
  if (sub) {
    ws.mergeCells(r + 1, 1, r + 1, n);
    const s = ws.getCell(r + 1, 1);
    s.value = sub;
    estilo(s, { size: 9, italic: true, color: C.pizarra, fill: C.tealClaro, indent: 1, wrap: true });
    ws.getRow(r + 1).height = 28;
  }
}
const ESTADOS: Record<string, [string, string]> = {
  Pagado: [C.verde, C.verdeClaro],
  'Al corriente': [C.verde, C.verdeClaro],
  'Por aprobar': [C.ambar, C.ambarClaro],
  'En revisión': [C.ambar, C.ambarClaro],
  Parcial: [C.ambar, C.ambarClaro],
  'Sin pago': [C.rojo, C.rojoClaro],
  Moroso: [C.rojo, C.rojoClaro],
  'Sin cargos': [C.gris, C.cebra],
};
function pintarEstado(ws: Worksheet, r: number, col: number) {
  const cell = ws.getCell(r, col);
  const [color, fill] = ESTADOS[String(cell.value)] ?? [C.texto, C.blanco];
  estilo(cell, { b: true, h: 'center', color, fill });
  bordeAbajo(cell);
}

// ---------- Libro ----------
export async function construirCobranza(o: OpcionesCobranza, logo?: string) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SIIA · soluciones inmobiliarias';
  wb.title = `Reporte de cobranza ${o.condominio} ${nombreMes(o.periodo)}`;
  const r0 = calcularCobranza(o);
  const t = r0.totales;
  const elaborado = `Elaborado el ${fechaLarga(o.hoy)}`;
  const pie = (titulo: string) => `&L&8&K989898SIIA · ${titulo}&C&8&K989898${o.condominio}&R&8&K989898Página &P de &N`;

  // ===== Hoja 1: Cobranza del mes =====
  const cols1: Col[] = [
    { header: 'Casa o departamento', width: 20 },
    { header: 'Residente', width: 28, wrap: true },
    { header: 'Cargos del mes', width: 15, fmt: PESOS },
    { header: 'Pagado\n(recibo aprobado)', width: 16, fmt: PESOS },
    { header: 'Por aprobar\n(en revisión)', width: 17, fmt: PESOS },
    { header: 'Sin pago', width: 15, fmt: PESOS },
    { header: 'Estado', width: 15, h: 'center' },
    { header: 'Folio(s) de recibo', width: 16, wrap: true },
  ];
  const ws = wb.addWorksheet('Cobranza del mes', {
    views: [{ showGridLines: false }],
    properties: { tabColor: argb(C.tealOscuro) },
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.35, right: 0.35, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.25 } },
    headerFooter: { oddFooter: pie('Reporte de cobranza') },
  });
  ws.columns = cols1.map((c) => ({ width: c.width }));
  const n1 = cols1.length;
  encabezado(wb, ws, logo, n1, 'REPORTE DE COBRANZA', [o.condominio, `${nombreMes(o.periodo)} · Fecha límite de pago: ${fechaLarga(r0.limite)} · ${elaborado}`]);
  const ancho = (a: number, b: number) => ({ desde: a, hasta: b });
  indicadores(ws, 6, [
    { titulo: 'Pagado', valor: t.pagado, detalle: `${plural(t.nPagado, 'unidad', 'unidades')} al día`, fmt: PESOS, fill: C.verdeClaro, color: C.verde, ...ancho(1, 2) },
    { titulo: 'Por aprobar', valor: t.porAprobar, detalle: `${plural(t.nPorAprobar, 'unidad', 'unidades')} con comprobante`, fmt: PESOS, fill: C.ambarClaro, color: C.ambar, ...ancho(3, 4) },
    { titulo: 'Sin pago', valor: t.sinPago, detalle: `${plural(t.nSinPago, 'unidad', 'unidades')}`, fmt: PESOS, fill: C.rojoClaro, color: C.rojo, ...ancho(5, 6) },
    { titulo: 'Cobranza del mes', valor: t.emitido ? t.pagado / t.emitido : 0, detalle: `de ${t.emitido.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })} emitidos`, fmt: PORC, fill: C.tealOscuro, ...ancho(7, 8) },
  ]);

  let r = 10;
  tituloSeccion(ws, r, n1, `UNIDADES · ${nombreMes(o.periodo).toUpperCase()}`, 'Cargos del mes (cuota, recargos, amenidades y cargos extraordinarios) repartidos en: pagado con recibo aprobado, comprobante por aprobar y sin pago.');
  r += 2;
  encabezadosTabla(ws, r, cols1);
  ws.views = [{ state: 'frozen', ySplit: r, showGridLines: false }];
  const inicio = r + 1;
  r0.mes.forEach((x, k) => {
    filaTabla(ws, inicio + k, cols1, [x.u.etiqueta, x.residente, x.total, x.pagado, x.porAprobar, x.sinPago, x.estado, x.folios], k % 2 === 1);
    pintarEstado(ws, inicio + k, 7);
  });
  r = inicio + r0.mes.length;
  filaTotal(ws, r, n1, `TOTAL (${plural(r0.mes.length, 'unidad', 'unidades')})`, { 2: t.emitido, 3: t.pagado, 4: t.porAprobar, 5: t.sinPago });
  ws.autoFilter = { from: { row: inicio - 1, column: 1 }, to: { row: r - 1, column: n1 } };

  // Morosos a la fecha
  r += 2;
  const cols2: Col[] = [
    { header: 'Casa o departamento' },
    { header: 'Residente moroso', wrap: true },
    { header: 'Teléfono', wrap: true },
    { header: 'Cargos vencidos', h: 'center' },
    { header: 'Vencido desde', fmt: FECHA, h: 'center' },
    { header: 'Días de atraso', h: 'center' },
    { header: 'Adeudo vencido a la fecha', fmt: PESOS },
    { header: 'Adeudo total (incluye por vencer)', fmt: PESOS },
  ];
  const textoLimite = r0.vencioLimite
    ? `Ya pasó la fecha límite del mes (${fechaLarga(r0.limite)}). Moroso: unidad con cargos vencidos al ${fechaLarga(o.hoy)} y sin comprobante en revisión.`
    : `La fecha límite del mes es el ${fechaLarga(r0.limite)}; las cuotas de este mes aún no vencen. Aparecen solo adeudos vencidos de meses anteriores.`;
  tituloSeccion(ws, r, n1, `RESIDENTES MOROSOS AL ${fechaLarga(o.hoy).toUpperCase()}`, textoLimite);
  r += 2;
  encabezadosTabla(ws, r, cols2);
  r++;
  if (r0.morosos.length) {
    r0.morosos.forEach((x, k) => {
      filaTabla(ws, r + k, cols2, [x.u.etiqueta, x.residente, x.telefono, x.cargosVencidos, fechaXls(x.masAntiguo), x.diasAtraso, x.adeudoMoroso, x.total], k % 2 === 1);
      for (const c of [2, 7]) ws.getCell(r + k, c).font = { name: FUENTE, size: 10, bold: true, color: argb(C.rojo) };
    });
    r += r0.morosos.length;
    filaTotal(ws, r, n1, `TOTAL (${plural(r0.morosos.length, 'moroso')})`, { 6: t.adeudoMorosos, 7: redondear(r0.morosos.reduce((s, x) => s + x.total, 0)) });
  } else {
    ws.mergeCells(r, 1, r, n1);
    const c = ws.getCell(r, 1);
    c.value = 'Sin residentes morosos a la fecha.';
    estilo(c, { b: true, color: C.verde, fill: C.verdeClaro, h: 'center' });
    ws.getRow(r).height = 22;
  }
  r += 2;
  ws.mergeCells(r, 1, r + 1, n1);
  const nota = ws.getCell(r, 1);
  nota.value =
    'Notas: «Pagado» son cargos con recibo aprobado por la administración. «Por aprobar» son cargos con un comprobante subido que aún no se revisa. ' +
    '«Sin pago» son cargos sin comprobante. El adeudo de morosos incluye recargos por pago tardío y meses anteriores. El detalle por unidad está en la hoja «Estado por unidad».';
  estilo(nota, { size: 8.5, color: C.gris, wrap: true });
  nota.alignment = { ...nota.alignment, vertical: 'top' };

  // ===== Hoja 2: Estado por unidad =====
  const cols3: Col[] = [
    { header: 'Casa o departamento', width: 19 },
    { header: 'Residente', width: 26, wrap: true },
    { header: 'Teléfono', width: 15, wrap: true },
    { header: 'Correo', width: 28, wrap: true },
    { header: 'Situación', width: 14, h: 'center' },
    { header: 'Vencido\n1–30 días', width: 13, fmt: PESOS },
    { header: 'Vencido\n31–60 días', width: 13, fmt: PESOS },
    { header: 'Vencido\n61–90 días', width: 13, fmt: PESOS },
    { header: 'Vencido\nmás de 90 días', width: 13, fmt: PESOS },
    { header: 'Total vencido', width: 14, fmt: PESOS },
    { header: 'Por vencer', width: 13, fmt: PESOS },
    { header: 'TOTAL QUE DEBE', width: 15, fmt: PESOS },
    { header: 'Comprobante en revisión', width: 14, fmt: PESOS },
    { header: 'Último pago aprobado', width: 13, fmt: FECHA, h: 'center' },
  ];
  const ws2 = wb.addWorksheet('Estado por unidad', {
    views: [{ showGridLines: false }],
    properties: { tabColor: argb(C.teal) },
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.25 } },
    headerFooter: { oddFooter: pie('Estado de cuenta por unidad') },
  });
  ws2.columns = cols3.map((c) => ({ width: c.width }));
  const n3 = cols3.length;
  encabezado(wb, ws2, logo, n3, 'ESTADO DE CUENTA POR UNIDAD', [o.condominio, `Situación al ${fechaLarga(o.hoy)}`]);
  const nUnidades = r0.estado.length;
  const nMorosos = r0.morosos.length;
  const nRevision = r0.estado.filter((x) => x.situacion === 'En revisión').length;
  indicadores(ws2, 6, [
    { titulo: 'Al corriente', valor: nUnidades - nMorosos - nRevision, detalle: `de ${plural(nUnidades, 'unidad', 'unidades')}`, fmt: '0', fill: C.verdeClaro, color: C.verde, ...ancho(1, 3) },
    { titulo: 'Morosos', valor: nMorosos, detalle: `${nUnidades ? Math.round((nMorosos / nUnidades) * 100) : 0}% de morosidad`, fmt: '0', fill: C.rojoClaro, color: C.rojo, ...ancho(4, 5) },
    { titulo: 'En revisión', valor: nRevision, detalle: 'vencido con comprobante subido', fmt: '0', fill: C.ambarClaro, color: C.ambar, ...ancho(6, 8) },
    { titulo: 'Cartera vencida', valor: t.carteraVencida, detalle: 'adeudos con fecha límite pasada', fmt: PESOS, fill: C.tealClaro, color: C.rojo, ...ancho(9, 11) },
    { titulo: 'Total por cobrar', valor: t.carteraTotal, detalle: 'vencido + por vencer', fmt: PESOS, fill: C.tealOscuro, ...ancho(12, 14) },
  ]);
  r = 10;
  tituloSeccion(ws2, r, n3, 'CONCENTRADO DE UNIDADES', 'Antigüedad del adeudo por días desde la fecha límite de cada cargo. «En revisión»: tiene cargos vencidos pero ya subió un comprobante que la administración no ha revisado.');
  r += 2;
  encabezadosTabla(ws2, r, cols3);
  ws2.views = [{ state: 'frozen', ySplit: r, xSplit: 1, showGridLines: false }];
  const ini2 = r + 1;
  r0.estado.forEach((x, k) => {
    filaTabla(ws2, ini2 + k, cols3, [x.u.etiqueta, x.residente, x.telefono, x.correo, x.situacion, ...x.tramos, x.vencido, x.porVencer, x.total, x.revision, fechaXls(x.ultimo)], k % 2 === 1);
    pintarEstado(ws2, ini2 + k, 5);
    const tot = ws2.getCell(ini2 + k, 12);
    tot.font = { name: FUENTE, size: 10, bold: true, color: argb(x.total > 0 ? (x.situacion === 'Moroso' ? C.rojo : C.texto) : 'B8BEC4') };
  });
  r = ini2 + r0.estado.length;
  const sumaCol = (f: (x: (typeof r0.estado)[number]) => number) => redondear(r0.estado.reduce((s, x) => s + f(x), 0));
  filaTotal(ws2, r, n3, `TOTAL (${plural(nUnidades, 'unidad', 'unidades')})`, {
    5: sumaCol((x) => x.tramos[0]),
    6: sumaCol((x) => x.tramos[1]),
    7: sumaCol((x) => x.tramos[2]),
    8: sumaCol((x) => x.tramos[3]),
    9: t.carteraVencida,
    10: sumaCol((x) => x.porVencer),
    11: t.carteraTotal,
    12: sumaCol((x) => x.revision),
  });
  ws2.autoFilter = { from: { row: ini2 - 1, column: 1 }, to: { row: r - 1, column: n3 } };
  ws2.pageSetup.printTitlesRow = `${ini2 - 1}:${ini2 - 1}`;
  ws.pageSetup.printTitlesRow = `${inicio - 1}:${inicio - 1}`;
  firmarLibro(wb, o.generadoPor);
  return wb;
}

/** Arma el reporte con el logotipo y lo descarga. */
export async function descargarReporteCobranza(o: OpcionesCobranza) {
  const wb = await construirCobranza(o, await logoBase64());
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `Cobranza ${o.condominio.replace(/[\\/:*?"<>|]+/g, '').trim()} ${nombreMes(o.periodo)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
