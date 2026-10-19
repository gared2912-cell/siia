// Estado financiero mensual en Excel para la mesa directiva: hoja «Resumen» con logotipo, indicadores, ingresos
// ordinarios y por amenidades, egresos, estado de resultados, cobranza y dos gráficas; y hojas de detalle
// (Departamentos, Ingresos, Egresos). ExcelJS se carga solo al descargar. Las gráficas se dibujan en SVG y se
// insertan como imagen (se ven igual en Excel, Google Sheets y al imprimir).
import type { Workbook, Worksheet, Cell } from 'exceljs';
import type { Schema } from '../api';
import { etiquetaIngreso, tipoDeCargo, amenidadDeConcepto } from '../../../amplify/functions/shared/finanzas';
import { calcularBalance, desglosePago, evidenciasDe, fechaIngreso, fechaMX, mesAnterior, mesCorto, nombreMes, redondear, type Balance, type DatosFinanzas } from './balance';

type Unidad = Schema['Unidad']['type'];
type Pago = Schema['Pago']['type'];

// Colores de marca (Logos SIIA) y de lectura.
export const C = {
  teal: '38CBB9',
  tealOscuro: '007C7D',
  tealClaro: 'E8F8F6',
  gris: '989898',
  pizarra: '4B526F',
  texto: '2E3446',
  linea: 'DFE6EA',
  cebra: 'F6FAFA',
  blanco: 'FFFFFF',
  rojo: 'B42318',
  rojoClaro: 'FDECEA',
  verde: '1E7D4F',
  verdeClaro: 'E6F4EC',
  ambar: '8A6100',
  ambarClaro: 'FFF4D6',
};
export const argb = (hex: string) => ({ argb: `FF${hex}` });
export const PESOS = '"$"#,##0.00;[Red]-"$"#,##0.00';
export const PORC = '0.0%';
export const FECHA = 'dd/mm/yyyy';
export const FUENTE = 'Calibri';

export type OpcionesReporte = { condominio: string; periodo: string; datos: DatosFinanzas; unidades: Unidad[]; hoy: string; generadoPor?: string };

/** Firma del reporte: «Generado por <administrador> · fecha» al final de cada hoja y como autor del archivo. */
export function firmarLibro(wb: import('exceljs').Workbook, generadoPor?: string) {
  if (!generadoPor) return;
  const cuando = new Date().toLocaleString('es-MX', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  wb.creator = `${generadoPor} · SIIA`;
  wb.lastModifiedBy = generadoPor;
  wb.eachSheet((ws) => {
    const fila = ws.getRow(ws.rowCount + 2);
    fila.getCell(1).value = `Generado por ${generadoPor} · ${cuando}`;
    fila.getCell(1).font = { name: FUENTE, size: 8, italic: true, color: argb(C.gris) };
  });
}
/** Imágenes ya listas en base64 (PNG): logotipo y gráficas. */
export type Imagenes = { logo?: string; grafica?: string; distribucion?: string };

// ---------- Gráficas (SVG) ----------
const xml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
function compacto(n: number) {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)} M`;
  if (a >= 1_000) return `$${(n / 1_000).toFixed(a >= 100_000 ? 0 : 1)}k`;
  return `$${Math.round(n)}`;
}
function escalaBonita(max: number) {
  if (max <= 0) return 1000;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}
const FONT_SVG = "font-family='Segoe UI, Arial, Helvetica, sans-serif'";

/** Barras agrupadas: ingresos vs. egresos de los últimos meses (el mes del reporte resaltado). */
export function svgIngresosEgresos(meses: { label: string; ingresos: number; egresos: number; actual?: boolean }[]) {
  const W = 520;
  const H = 300;
  const m = { l: 54, r: 10, t: 40, b: 34 };
  const ah = H - m.t - m.b;
  const aw = W - m.l - m.r;
  const max = escalaBonita(Math.max(...meses.flatMap((x) => [x.ingresos, x.egresos]), 0));
  const y = (v: number) => m.t + ah - (v / max) * ah;
  const g = aw / meses.length;
  const bw = Math.min(26, g * 0.32);
  const out: string[] = [`<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}' ${FONT_SVG}>`, `<rect width='${W}' height='${H}' fill='#fff'/>`];
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    out.push(`<line x1='${m.l}' x2='${W - m.r}' y1='${y(v)}' y2='${y(v)}' stroke='#${i ? 'E6ECEF' : 'B8C2C8'}' stroke-width='1'/>`);
    out.push(`<text x='${m.l - 6}' y='${y(v) + 4}' font-size='10' fill='#6B7280' text-anchor='end'>${compacto(v)}</text>`);
  }
  meses.forEach((x, i) => {
    const cx = m.l + g * i + g / 2;
    if (x.actual) out.push(`<rect x='${cx - g / 2 + 3}' y='${m.t - 4}' width='${g - 6}' height='${ah + 4}' fill='#E8F8F6' rx='6'/>`);
    for (const [k, v, color] of [
      [0, x.ingresos, '#38CBB9'],
      [1, x.egresos, '#989898'],
    ] as const) {
      const bx = cx - bw - 2 + k * (bw + 4);
      const by = y(v);
      out.push(`<rect x='${bx}' y='${by}' width='${bw}' height='${Math.max(0, m.t + ah - by)}' fill='${color}' rx='3'/>`);
      if (v > 0) out.push(`<text x='${bx + bw / 2}' y='${by - 4}' font-size='8.5' fill='#4B526F' text-anchor='middle'>${compacto(v)}</text>`);
    }
    out.push(`<text x='${cx}' y='${H - m.b + 16}' font-size='11' fill='#2E3446' text-anchor='middle'${x.actual ? " font-weight='700'" : ''}>${xml(x.label)}</text>`);
  });
  out.push(
    `<rect x='${m.l}' y='12' width='12' height='12' rx='2' fill='#38CBB9'/><text x='${m.l + 17}' y='22' font-size='11' fill='#2E3446'>Ingresos</text>`,
    `<rect x='${m.l + 90}' y='12' width='12' height='12' rx='2' fill='#989898'/><text x='${m.l + 107}' y='22' font-size='11' fill='#2E3446'>Egresos</text>`,
    '</svg>',
  );
  return { svg: out.join(''), W, H };
}

/** Barras horizontales: en qué se gastó el mes (las 6 categorías mayores; el resto, «Otras»). */
export function svgDistribucion(items: { label: string; monto: number }[]) {
  const W = 520;
  const H = 300;
  const out: string[] = [`<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}' ${FONT_SVG}>`, `<rect width='${W}' height='${H}' fill='#fff'/>`];
  const orden = items.filter((x) => x.monto > 0).sort((a, b) => b.monto - a.monto);
  const top = orden.slice(0, 6);
  const resto = orden.slice(6).reduce((s, x) => s + x.monto, 0);
  if (resto > 0) top.push({ label: 'Otras', monto: resto });
  if (!top.length) {
    out.push(`<text x='${W / 2}' y='${H / 2}' font-size='13' fill='#6B7280' text-anchor='middle'>Sin egresos registrados en el mes</text></svg>`);
    return { svg: out.join(''), W, H };
  }
  const total = top.reduce((s, x) => s + x.monto, 0);
  const max = Math.max(...top.map((x) => x.monto));
  const l = 168;
  const r = 118;
  const fila = Math.min(38, (H - 24) / top.length);
  const alto = Math.min(20, fila * 0.6);
  top.forEach((x, i) => {
    const cy = 16 + fila * i + fila / 2;
    const w = ((W - l - r) * x.monto) / max;
    const nombre = x.label.length > 26 ? `${x.label.slice(0, 25)}…` : x.label;
    out.push(`<text x='${l - 8}' y='${cy + 4}' font-size='11' fill='#2E3446' text-anchor='end'>${xml(nombre)}</text>`);
    out.push(`<rect x='${l}' y='${cy - alto / 2}' width='${Math.max(2, w)}' height='${alto}' rx='3' fill='${i ? '#7FD9CF' : '#007C7D'}'/>`);
    out.push(
      `<text x='${l + w + 6}' y='${cy + 4}' font-size='10.5' fill='#4B526F'>${compacto(x.monto)} · ${Math.round((x.monto / total) * 100)}%</text>`,
    );
  });
  out.push('</svg>');
  return { svg: out.join(''), W, H };
}

/** SVG → PNG (base64) en el navegador, al doble de resolución para que se vea nítido. */
async function pngDeSvg(svg: string, W: number, H: number) {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = W * 2;
  canvas.height = H * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(2, 2);
  ctx.drawImage(img, 0, 0, W, H);
  return canvas.toDataURL('image/png');
}

export async function logoBase64() {
  try {
    const r = await fetch('/marca/siia-horizontal.png');
    if (!r.ok) return undefined;
    const blob = await r.blob();
    return await new Promise<string>((ok, mal) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result));
      fr.onerror = mal;
      fr.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

/** Datos de las dos gráficas del reporte. */
export function datosGraficas(o: OpcionesReporte, b: Balance) {
  const meses: string[] = [o.periodo];
  while (meses.length < 6) meses.unshift(mesAnterior(meses[0]));
  const serie = meses.map((p) => {
    const x = p === o.periodo ? b : calcularBalance(o.datos, p);
    return { label: mesCorto(p), ingresos: x.totalIngresos, egresos: x.totalEgresos, actual: p === o.periodo };
  });
  return { serie, distribucion: b.egresos.map((x) => ({ label: x.categoria, monto: x.monto })) };
}

// ---------- Libro ----------
export const fechaXls = (d?: string | null) => {
  if (!d) return null;
  const [a, m, dia] = d.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, dia));
};

export function estilo(cell: Cell, s: { b?: boolean; size?: number; color?: string; fill?: string; h?: 'left' | 'center' | 'right'; fmt?: string; wrap?: boolean; italic?: boolean; indent?: number }) {
  cell.font = { name: FUENTE, size: s.size ?? 10, bold: !!s.b, italic: !!s.italic, color: argb(s.color ?? C.texto) };
  if (s.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(s.fill) };
  cell.alignment = { vertical: 'middle', horizontal: s.h ?? 'left', wrapText: !!s.wrap, indent: s.indent ?? 0 };
  if (s.fmt) cell.numFmt = s.fmt;
}
export const bordeAbajo = (cell: Cell, color = C.linea, style: 'thin' | 'medium' = 'thin') => (cell.border = { ...cell.border, bottom: { style, color: argb(color) } });
export const bordeArriba = (cell: Cell, color = C.tealOscuro, style: 'thin' | 'medium' = 'thin') => (cell.border = { ...cell.border, top: { style, color: argb(color) } });

/** Fila de concepto · monto · porcentaje en un bloque de 3 columnas (col = primera columna). */
function fila(ws: Worksheet, r: number, col: number, concepto: string, monto: number | null, pct: number | null, opts: { b?: boolean; fill?: string; color?: string; size?: number; indent?: number } = {}) {
  const c1 = ws.getCell(r, col);
  const c2 = ws.getCell(r, col + 1);
  const c3 = ws.getCell(r, col + 2);
  c1.value = concepto;
  c2.value = monto;
  c3.value = pct;
  const base = { b: opts.b, fill: opts.fill, size: opts.size, color: opts.color };
  estilo(c1, { ...base, indent: opts.indent ?? 1 });
  estilo(c2, { ...base, h: 'right', fmt: PESOS, color: monto === 0 && !opts.b ? C.gris : opts.color });
  estilo(c3, { ...base, h: 'right', fmt: PORC, color: opts.color ?? C.pizarra });
  for (const c of [c1, c2, c3]) bordeAbajo(c);
}

function encabezadoSeccion(ws: Worksheet, r: number, col: number, titulo: string, cols: [string, string] = ['Monto', '%']) {
  ws.mergeCells(r, col, r, col + 2);
  const t = ws.getCell(r, col);
  t.value = titulo;
  estilo(t, { b: true, size: 11, color: C.blanco, fill: C.tealOscuro, indent: 1 });
  ws.getRow(r).height = 22;
  return (rr: number, sub: string) => {
    const a = ws.getCell(rr, col);
    const b = ws.getCell(rr, col + 1);
    const c = ws.getCell(rr, col + 2);
    a.value = sub;
    b.value = cols[0];
    c.value = cols[1];
    for (const [cell, h] of [
      [a, 'left'],
      [b, 'right'],
      [c, 'right'],
    ] as const) {
      estilo(cell, { b: true, size: 9, color: C.tealOscuro, fill: C.tealClaro, h, indent: h === 'left' ? 1 : 0 });
      bordeAbajo(cell, C.teal);
    }
  };
}

function hojaResumen(wb: Workbook, o: OpcionesReporte, b: Balance, img: Imagenes) {
  const ws = wb.addWorksheet('Resumen', {
    views: [{ showGridLines: false }],
    properties: { tabColor: argb(C.tealOscuro) },
    pageSetup: {
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.25 },
    },
    headerFooter: { oddFooter: `&L&8&K989898SIIA · soluciones inmobiliarias&C&8&K989898${o.condominio} · ${nombreMes(o.periodo)}&R&8&K989898Página &P de &N` },
  });
  ws.columns = [{ width: 2 }, { width: 31 }, { width: 15 }, { width: 9 }, { width: 3 }, { width: 31 }, { width: 15 }, { width: 9 }, { width: 2 }];
  const pctIng = (n: number) => (b.totalIngresos ? n / b.totalIngresos : 0);
  const pctEgr = (n: number) => (b.totalEgresos ? n / b.totalEgresos : 0);

  // Encabezado: logotipo a la izquierda, título a la derecha y franja de marca.
  [1, 2, 3].forEach((r) => (ws.getRow(r).height = 22));
  if (img.logo) {
    const id = wb.addImage({ base64: img.logo, extension: 'png' });
    ws.addImage(id, { tl: { col: 1, row: 0.25 }, ext: { width: 186, height: 63 } });
  } else {
    const c = ws.getCell('B1');
    c.value = 'SIIA';
    estilo(c, { b: true, size: 22, color: C.teal });
  }
  ws.mergeCells('D1:H1');
  ws.mergeCells('D2:H2');
  ws.mergeCells('D3:H3');
  ws.getCell('D1').value = 'ESTADO FINANCIERO MENSUAL';
  estilo(ws.getCell('D1'), { b: true, size: 16, color: C.tealOscuro, h: 'right' });
  ws.getCell('D2').value = o.condominio;
  estilo(ws.getCell('D2'), { b: true, size: 12, color: C.texto, h: 'right' });
  ws.getCell('D3').value = `${nombreMes(o.periodo)} · Elaborado el ${new Date(`${o.hoy}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}`;
  estilo(ws.getCell('D3'), { size: 10, color: C.gris, h: 'right' });
  ws.getRow(4).height = 5;
  for (let c = 2; c <= 8; c++) ws.getCell(4, c).fill = { type: 'pattern', pattern: 'solid', fgColor: argb(C.teal) };
  ws.getRow(5).height = 10;

  // Indicadores principales
  const kpis: [string, number, string, string][] = [
    ['Saldo inicial', b.saldoInicial, 'B6:B7', C.tealClaro],
    ['Ingresos del mes', b.totalIngresos, 'C6:D7', C.tealClaro],
    ['Egresos del mes', b.totalEgresos, 'F6:F7', C.tealClaro],
    ['Saldo final', b.saldoFinal, 'G6:H7', C.tealOscuro],
  ];
  ws.getRow(6).height = 18;
  ws.getRow(7).height = 30;
  for (const [label, valor, rango, fill] of kpis) {
    const [ini, fin] = rango.split(':');
    const colIni = ini.charCodeAt(0) - 64;
    const colFin = fin.charCodeAt(0) - 64;
    ws.mergeCells(6, colIni, 6, colFin);
    ws.mergeCells(7, colIni, 7, colFin);
    const oscuro = fill === C.tealOscuro;
    const l = ws.getCell(6, colIni);
    const v = ws.getCell(7, colIni);
    l.value = label.toUpperCase();
    v.value = valor;
    estilo(l, { b: true, size: 8.5, color: oscuro ? 'CFF3EF' : C.pizarra, fill, h: 'center' });
    estilo(v, { b: true, size: 16, color: oscuro ? C.blanco : valor < 0 ? C.rojo : C.texto, fill, h: 'center', fmt: PESOS });
    const blanco = { style: 'thick' as const, color: argb(C.blanco) };
    for (const c of [l, v]) c.border = { left: blanco, right: blanco };
  }
  ws.getRow(8).height = 12;

  // Ingresos (izquierda) y egresos (derecha)
  let r = 9;
  const subIng = encabezadoSeccion(ws, r, 2, 'INGRESOS');
  const subEgr = encabezadoSeccion(ws, r, 6, 'EGRESOS');
  r++;
  subIng(r, 'Ingresos ordinarios');
  subEgr(r, 'Concepto');
  let ri = r + 1;
  for (const x of b.ordinarios) fila(ws, ri++, 2, x.label, x.monto, pctIng(x.monto));
  fila(ws, ri++, 2, 'Subtotal ingresos ordinarios', b.totalOrdinarios, pctIng(b.totalOrdinarios), { b: true, fill: C.cebra });
  ri++;
  subIng(ri++, 'Ingresos por amenidades');
  if (b.amenidades.length) {
    for (const a of b.amenidades) fila(ws, ri++, 2, `${a.nombre} (${a.reservas} reserva${a.reservas === 1 ? '' : 's'})`, a.monto, pctIng(a.monto));
  } else fila(ws, ri++, 2, 'Sin reservas pagadas en el mes', 0, null, { color: C.gris });
  fila(ws, ri++, 2, 'Subtotal ingresos por amenidades', b.totalAmenidades, pctIng(b.totalAmenidades), { b: true, fill: C.cebra });

  let re = r + 1;
  const egresos = b.egresos.filter((x) => x.monto > 0).sort((a, z) => z.monto - a.monto);
  if (egresos.length) for (const x of egresos) fila(ws, re++, 6, x.categoria, x.monto, pctEgr(x.monto));
  else fila(ws, re++, 6, 'Sin egresos registrados en el mes', 0, null, { color: C.gris });
  ws.getCell(re, 6).value = `${b.egresosMes.length} movimiento${b.egresosMes.length === 1 ? '' : 's'} con evidencia · detalle en la hoja «Egresos»`;
  estilo(ws.getCell(re, 6), { size: 8.5, italic: true, color: C.gris, indent: 1 });
  ws.mergeCells(re, 6, re, 8);
  re++;

  // Totales a la misma altura
  const rt = Math.max(ri, re) + 1;
  fila(ws, rt, 2, 'TOTAL DE INGRESOS', b.totalIngresos, b.totalIngresos ? 1 : null, { b: true, fill: C.tealClaro, color: C.tealOscuro, size: 11 });
  fila(ws, rt, 6, 'TOTAL DE EGRESOS', b.totalEgresos, b.totalEgresos ? 1 : null, { b: true, fill: C.tealClaro, color: C.tealOscuro, size: 11 });
  for (const c of [2, 3, 4, 6, 7, 8]) {
    bordeArriba(ws.getCell(rt, c), C.tealOscuro, 'medium');
    bordeAbajo(ws.getCell(rt, c), C.tealOscuro, 'medium');
  }
  ws.getRow(rt).height = 22;

  // Estado de resultados y cobranza del mes
  r = rt + 2;
  encabezadoSeccion(ws, r, 2, 'ESTADO DE RESULTADOS');
  encabezadoSeccion(ws, r, 6, 'COBRANZA DEL MES');
  const filasRes: [string, number, boolean?][] = [
    ['Saldo inicial', b.saldoInicial],
    ['(+) Ingresos ordinarios', b.totalOrdinarios],
    ['(+) Ingresos por amenidades', b.totalAmenidades],
    ['(−) Egresos', -b.totalEgresos],
    ['(=) Saldo final', b.saldoFinal, true],
  ];
  filasRes.forEach(([t, v, total], k) => {
    fila(ws, r + 1 + k, 2, t, v, null, total ? { b: true, fill: C.tealOscuro, color: C.blanco, size: 11 } : {});
    ws.mergeCells(r + 1 + k, 3, r + 1 + k, 4);
  });
  if (b.saldoCapturado) {
    const c = ws.getCell(r + 1 + filasRes.length, 2);
    c.value = `Saldo inicial capturado por la administración${b.saldoCapturado.nota ? `: ${b.saldoCapturado.nota}` : ''}.`;
    estilo(c, { size: 8.5, italic: true, color: C.gris, indent: 1 });
    ws.mergeCells(r + 1 + filasRes.length, 2, r + 1 + filasRes.length, 4);
  }

  const cargosMes = o.datos.cargos.filter((c) => c.periodo === o.periodo && c.estado !== 'CANCELADO');
  const emitido = redondear(cargosMes.reduce((s, c) => s + c.monto, 0));
  const cobrado = redondear(cargosMes.filter((c) => c.estado === 'PAGADO').reduce((s, c) => s + c.monto, 0));
  const vencidas = new Set(o.datos.cargos.filter((c) => c.estado === 'PENDIENTE' && c.vence && c.vence < o.hoy).map((c) => c.unidadId));
  const conAdeudo = o.unidades.filter((u) => vencidas.has(u.id)).length;
  const filasCob: [string, number | null, number | null, string?][] = [
    ['Cargos emitidos en el mes', emitido, null],
    ['Cobrado', cobrado, emitido ? cobrado / emitido : null],
    ['Pendiente de cobro', redondear(emitido - cobrado), emitido ? (emitido - cobrado) / emitido : null],
    ['Unidades al corriente', o.unidades.length - conAdeudo, null, '0'],
    ['Unidades con adeudo vencido', conAdeudo, null, '0'],
  ];
  filasCob.forEach(([t, v, p, fmt], k) => {
    fila(ws, r + 1 + k, 6, t, v, p);
    if (fmt) {
      ws.getCell(r + 1 + k, 7).numFmt = fmt;
      if (t.includes('adeudo') && Number(v) > 0) ws.getCell(r + 1 + k, 7).font = { name: FUENTE, size: 10, bold: true, color: argb(C.rojo) };
    }
  });

  // Gráficas
  r = r + filasRes.length + 3;
  ws.mergeCells(r, 2, r, 4);
  ws.mergeCells(r, 6, r, 8);
  ws.getCell(r, 2).value = 'INGRESOS VS. EGRESOS · ÚLTIMOS 6 MESES';
  ws.getCell(r, 6).value = 'DISTRIBUCIÓN DE EGRESOS DEL MES';
  for (const c of [2, 6]) {
    estilo(ws.getCell(r, c), { b: true, size: 10, color: C.tealOscuro });
    bordeAbajo(ws.getCell(r, c), C.teal, 'medium');
  }
  for (const c of [3, 4, 7, 8]) bordeAbajo(ws.getCell(r, c), C.teal, 'medium');
  const filasGrafica = 14;
  for (let k = 1; k <= filasGrafica; k++) ws.getRow(r + k).height = 15;
  if (img.grafica) ws.addImage(wb.addImage({ base64: img.grafica, extension: 'png' }), { tl: { col: 1.05, row: r + 0.3 }, ext: { width: 372, height: 215 } });
  if (img.distribucion) ws.addImage(wb.addImage({ base64: img.distribucion, extension: 'png' }), { tl: { col: 5.05, row: r + 0.3 }, ext: { width: 372, height: 215 } });

  // Notas y firmas
  r = r + filasGrafica + 1;
  ws.mergeCells(r, 2, r + 2, 8);
  const nota = ws.getCell(r, 2);
  nota.value =
    'Notas: Los ingresos corresponden a comprobantes de pago aprobados por la administración, en el mes de su fecha de pago. ' +
    'Los ingresos por amenidades son las reservas pagadas y aprobadas. Cada egreso cuenta con su evidencia (factura, nota o fotografías) en la plataforma SIIA. ' +
    'El saldo inicial es el saldo final del mes anterior, salvo que la administración lo haya capturado.';
  estilo(nota, { size: 8.5, color: C.gris, wrap: true });
  nota.alignment = { ...nota.alignment, vertical: 'top' };
  r += 4;
  for (const [col, titulo] of [
    [2, 'Elaboró: Administración SIIA'],
    [6, 'Revisó: Mesa directiva'],
  ] as const) {
    ws.mergeCells(r, col, r, col + 2);
    ws.mergeCells(r + 1, col, r + 1, col + 2);
    for (let c = col; c <= col + 2; c++) bordeAbajo(ws.getCell(r, c), C.pizarra);
    const t = ws.getCell(r + 1, col);
    t.value = titulo;
    estilo(t, { size: 9, color: C.pizarra, h: 'center' });
  }
  ws.getRow(r).height = 34;
  ws.pageSetup.printArea = `A1:I${r + 2}`;
}

type Columna = { header: string; width: number; fmt?: string; h?: 'left' | 'center' | 'right'; wrap?: boolean };

/** Hoja de detalle con título, encabezados de marca, filas en cebra, filtros y fila de totales. */
function hojaTabla(wb: Workbook, nombre: string, titulo: string, sub: string, cols: Columna[], filas: (string | number | Date | null)[][], total?: { label: string; col: number; valor: number }) {
  const ws = wb.addWorksheet(nombre, {
    views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
    properties: { tabColor: argb(C.teal) },
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '4:4', margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.25 } },
    headerFooter: { oddFooter: `&L&8&K989898SIIA · ${titulo}&R&8&K989898Página &P de &N` },
  });
  ws.columns = cols.map((c) => ({ width: c.width }));
  ws.mergeCells(1, 1, 1, cols.length);
  ws.mergeCells(2, 1, 2, cols.length);
  ws.getCell(1, 1).value = titulo;
  estilo(ws.getCell(1, 1), { b: true, size: 14, color: C.tealOscuro });
  ws.getCell(2, 1).value = sub;
  estilo(ws.getCell(2, 1), { size: 10, color: C.gris });
  ws.getRow(1).height = 24;
  const hr = ws.getRow(4);
  hr.height = 30;
  cols.forEach((c, i) => {
    const cell = hr.getCell(i + 1);
    cell.value = c.header;
    estilo(cell, { b: true, size: 10, color: C.blanco, fill: C.tealOscuro, h: c.h ?? (c.fmt === PESOS ? 'right' : 'left'), wrap: true });
  });
  filas.forEach((f, k) => {
    const row = ws.getRow(5 + k);
    f.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v;
      const c = cols[i];
      estilo(cell, { fmt: c.fmt, h: c.h ?? (c.fmt === PESOS ? 'right' : 'left'), fill: k % 2 ? C.cebra : undefined, wrap: c.wrap });
      bordeAbajo(cell);
    });
  });
  if (!filas.length) {
    ws.mergeCells(5, 1, 5, cols.length);
    ws.getCell(5, 1).value = 'Sin movimientos en el mes.';
    estilo(ws.getCell(5, 1), { italic: true, color: C.gris });
  } else ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + filas.length, column: cols.length } };
  if (total) {
    const r = 5 + Math.max(filas.length, 1) + 1;
    const l = ws.getCell(r, total.col - 1);
    const v = ws.getCell(r, total.col);
    l.value = total.label;
    v.value = total.valor;
    estilo(l, { b: true, h: 'right', color: C.tealOscuro, fill: C.tealClaro });
    estilo(v, { b: true, h: 'right', fmt: PESOS, color: C.tealOscuro, fill: C.tealClaro });
    for (const c of [l, v]) {
      bordeArriba(c, C.tealOscuro, 'medium');
      bordeAbajo(c, C.tealOscuro, 'medium');
    }
  }
  return ws;
}

/** Arma el libro completo (sin descargarlo). */
export async function construirReporte(o: OpcionesReporte, img: Imagenes) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SIIA · soluciones inmobiliarias';
  wb.title = `Estado financiero ${o.condominio} ${nombreMes(o.periodo)}`;
  wb.created = new Date();
  const b = calcularBalance(o.datos, o.periodo);
  hojaResumen(wb, o, b, img);

  const etiqueta = (id: string) => o.unidades.find((u) => u.id === id)?.etiqueta ?? '—';
  const cargosPorId = new Map(o.datos.cargos.map((c) => [c.id, c]));
  const pagoDeCargo = new Map<string, Pago>();
  for (const p of o.datos.pagos.filter((x) => x.estado === 'VALIDADO')) for (const id of p.cargoIds ?? []) if (id) pagoDeCargo.set(id, p);
  const sub = `${o.condominio} · ${nombreMes(o.periodo)}`;
  const tipoLegible = (tipo: string, concepto: string) => (tipo === 'RESERVA' ? `Amenidades · ${amenidadDeConcepto(concepto)}` : etiquetaIngreso(tipo));

  // Departamentos: cargos del mes de cada unidad con su estado
  const cargosMes = o.datos.cargos.filter((c) => c.periodo === o.periodo && c.estado !== 'CANCELADO');
  const filasDeptos: (string | number | Date | null)[][] = [];
  const ordenadas = [...o.unidades].sort((a, z) => a.etiqueta.localeCompare(z.etiqueta, 'es', { numeric: true }));
  for (const u of ordenadas) {
    const adeudo = redondear(o.datos.cargos.filter((c) => c.unidadId === u.id && c.estado === 'PENDIENTE').reduce((s, c) => s + c.monto, 0));
    const suyos = cargosMes.filter((c) => c.unidadId === u.id).sort((a, z) => String(a.vence ?? '').localeCompare(String(z.vence ?? '')));
    if (!suyos.length) filasDeptos.push([u.etiqueta, u.propietario ?? '', 'Sin cargos en el mes', '', null, null, '—', null, '', adeudo]);
    for (const c of suyos) {
      const p = pagoDeCargo.get(c.id);
      const estado = c.estado === 'PAGADO' ? 'Pagado' : c.vence && c.vence < o.hoy ? 'Vencido' : 'Pendiente';
      filasDeptos.push([u.etiqueta, u.propietario ?? '', c.concepto, tipoLegible(tipoDeCargo(c), c.concepto), c.monto, fechaXls(c.vence), estado, p ? fechaXls(fechaIngreso(p)) : null, p?.folio ?? '', adeudo]);
    }
  }
  const wsD = hojaTabla(
    wb,
    'Departamentos',
    'Estado de pagos por casa o departamento',
    `${sub} · cargos del mes, pagados y pendientes`,
    [
      { header: 'Casa o departamento', width: 20 },
      { header: 'Propietario', width: 24 },
      { header: 'Concepto', width: 40, wrap: true },
      { header: 'Tipo', width: 28, wrap: true },
      { header: 'Monto', width: 13, fmt: PESOS },
      { header: 'Vence', width: 12, fmt: FECHA, h: 'center' },
      { header: 'Estado', width: 12, h: 'center' },
      { header: 'Fecha de pago', width: 13, fmt: FECHA, h: 'center' },
      { header: 'Folio', width: 10, h: 'center' },
      { header: 'Adeudo total de la unidad', width: 16, fmt: PESOS },
    ],
    filasDeptos,
  );
  const colores: Record<string, [string, string]> = { Pagado: [C.verde, C.verdeClaro], Pendiente: [C.ambar, C.ambarClaro], Vencido: [C.rojo, C.rojoClaro] };
  filasDeptos.forEach((f, k) => {
    const cell = wsD.getCell(5 + k, 7);
    const col = colores[String(f[6])];
    if (col) estilo(cell, { b: true, h: 'center', color: col[0], fill: col[1] });
    const adeudo = wsD.getCell(5 + k, 10);
    if (Number(f[9]) > 0) adeudo.font = { name: FUENTE, size: 10, bold: true, color: argb(C.rojo) };
  });

  // Ingresos: cada comprobante aprobado del mes con su desglose
  const filasIng: (string | number | Date | null)[][] = [];
  for (const p of [...b.pagosMes].sort((a, z) => fechaIngreso(a).localeCompare(fechaIngreso(z)))) {
    desglosePago(p, cargosPorId).forEach((x, k) =>
      filasIng.push([
        k ? '' : (p.folio ?? ''),
        k ? '' : etiqueta(p.unidadId),
        k ? null : fechaXls(fechaIngreso(p)),
        k ? null : p.validadoEn ? fechaXls(fechaMX(p.validadoEn)) : null,
        k ? '' : (p.referencia ?? ''),
        x.concepto,
        x.tipo === 'RESERVA' ? 'Ingresos por amenidades' : 'Ingresos ordinarios',
        tipoLegible(x.tipo, x.concepto),
        redondear(x.monto),
      ]),
    );
  }
  hojaTabla(
    wb,
    'Ingresos',
    'Ingresos del mes (comprobantes aprobados)',
    sub,
    [
      { header: 'Folio', width: 10, h: 'center' },
      { header: 'Casa o departamento', width: 20 },
      { header: 'Fecha de pago', width: 13, fmt: FECHA, h: 'center' },
      { header: 'Aprobado', width: 12, fmt: FECHA, h: 'center' },
      { header: 'Referencia', width: 16 },
      { header: 'Concepto', width: 40, wrap: true },
      { header: 'Grupo', width: 22 },
      { header: 'Tipo', width: 30, wrap: true },
      { header: 'Monto', width: 14, fmt: PESOS },
    ],
    filasIng,
    { label: 'Total de ingresos', col: 9, valor: b.totalIngresos },
  );

  // Egresos del mes
  hojaTabla(
    wb,
    'Egresos',
    'Egresos del mes',
    `${sub} · cada gasto con su evidencia en SIIA`,
    [
      { header: 'Fecha', width: 12, fmt: FECHA, h: 'center' },
      { header: 'Categoría', width: 26 },
      { header: 'Concepto', width: 36, wrap: true },
      { header: 'Proveedor', width: 22, wrap: true },
      { header: 'Forma de pago', width: 15 },
      { header: 'Evidencias', width: 34, wrap: true },
      { header: 'Registrado por', width: 22 },
      { header: 'Monto', width: 14, fmt: PESOS },
    ],
    [...b.egresosMes]
      .sort((a, z) => a.fecha.localeCompare(z.fecha))
      .map((e) => {
        const ev = evidenciasDe(e);
        return [
          fechaXls(e.fecha),
          e.categoria,
          e.concepto,
          e.proveedor ?? '',
          e.formaPago ?? '',
          `${ev.length} archivo${ev.length === 1 ? '' : 's'}: ${ev.map((x) => x.nombre).join(', ')}`,
          e.registradoPorNombre || e.registradoPor || '',
          e.monto,
        ];
      }),
    { label: 'Total de egresos', col: 8, valor: b.totalEgresos },
  );

  firmarLibro(wb, o.generadoPor);
  return wb;
}

const nombreArchivo = (o: OpcionesReporte) => `Estado financiero ${o.condominio.replace(/[\\/:*?"<>|]+/g, '').trim()} ${nombreMes(o.periodo)}.xlsx`;

/** Arma el reporte con logotipo y gráficas y lo descarga. */
export async function descargarReporteFinanzas(o: OpcionesReporte) {
  const b = calcularBalance(o.datos, o.periodo);
  const g = datosGraficas(o, b);
  const s1 = svgIngresosEgresos(g.serie);
  const s2 = svgDistribucion(g.distribucion);
  const [logo, grafica, distribucion] = await Promise.all([logoBase64(), pngDeSvg(s1.svg, s1.W, s1.H).catch(() => undefined), pngDeSvg(s2.svg, s2.W, s2.H).catch(() => undefined)]);
  const wb = await construirReporte(o, { logo, grafica, distribucion });
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
