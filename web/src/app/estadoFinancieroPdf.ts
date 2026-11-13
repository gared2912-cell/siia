// Estado financiero mensual en PDF para los residentes (Finanzas del condominio): la misma hoja «Resumen» del Excel
// del panel —indicadores, ingresos, egresos, estado de resultados, cobranza y dos gráficas— en una página carta.
// jsPDF se carga solo al descargar.
import { logoBase64, pngDeSvg, svgDistribucion, svgIngresosEgresos } from './graficasFinanzas';
import { filasResultados, fechaLarga, nombreMesLargo, proporcion, type EstadoFinanciero } from './estadoFinanciero';

type RGB = [number, number, number];
const TEAL: RGB = [56, 203, 185];
const TEAL_OSCURO: RGB = [0, 124, 125];
const TEAL_CLARO: RGB = [232, 248, 246];
const TEXTO: RGB = [46, 52, 70];
const PIZARRA: RGB = [75, 82, 111];
const GRIS: RGB = [120, 126, 140];
const LINEA: RGB = [223, 230, 234];
const CEBRA: RGB = [246, 250, 250];
const ROJO: RGB = [180, 35, 24];
const BLANCO: RGB = [255, 255, 255];

const mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const dinero = (n: number) => mxn.format(n || 0);
// Helvetica (jsPDF) no trae el signo menos tipográfico
const txt = (s: string) => s.replace(/−/g, '-');
const pct = (p: number | null) => (p === null ? '' : `${(p * 100).toFixed(1)}%`);

export async function construirEstadoPdf(e: EstadoFinanciero, img: { logo?: string; grafica?: string; distribucion?: string } = {}) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  doc.setProperties({ title: `Estado financiero ${nombreMesLargo(e.periodo)} · ${e.condominio}`, author: 'SIIA · soluciones inmobiliarias', creator: 'SIIA' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 12;
  const col = (W - 2 * M - 6) / 2; // ancho de cada columna
  const xL = M;
  const xR = M + col + 6;

  // Encabezado
  if (img.logo) doc.addImage(img.logo, 'PNG', M, 9, 50, 17);
  else doc.setFont('helvetica', 'bold').setFontSize(22).setTextColor(...TEAL).text('SIIA', M, 21);
  doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(...TEAL_OSCURO).text('ESTADO FINANCIERO MENSUAL', W - M, 14, { align: 'right' });
  doc.setFontSize(11).setTextColor(...TEXTO).text(e.condominio, W - M, 20, { align: 'right' });
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...GRIS).text(`${nombreMesLargo(e.periodo)} · Elaborado el ${fechaLarga(e.elaborado)}`, W - M, 25, { align: 'right' });
  doc.setFillColor(...TEAL).rect(M, 29, W - 2 * M, 1.2, 'F');

  // Indicadores
  let y = 33;
  const kw = (W - 2 * M - 3 * 2) / 4;
  (
    [
      ['SALDO INICIAL', e.saldoInicial],
      ['INGRESOS DEL MES', e.totalIngresos],
      ['EGRESOS DEL MES', e.totalEgresos],
      ['SALDO FINAL', e.saldoFinal],
    ] as [string, number][]
  ).forEach(([t, v], i) => {
    const x = M + i * (kw + 2);
    const final = i === 3;
    doc.setFillColor(...(final ? TEAL_OSCURO : TEAL_CLARO)).rect(x, y, kw, 16, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(...(final ? ([207, 243, 239] as RGB) : PIZARRA)).text(t, x + kw / 2, y + 5.5, { align: 'center' });
    doc.setFontSize(12.5).setTextColor(...(final ? BLANCO : v < 0 ? ROJO : TEXTO)).text(dinero(v), x + kw / 2, y + 12.5, { align: 'center' });
  });
  y += 21;

  // Utilidades de tabla
  const encabezado = (x: number, yy: number, t: string) => {
    doc.setFillColor(...TEAL_OSCURO).rect(x, yy, col, 6.5, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...BLANCO).text(t, x + 2, yy + 4.5);
    return yy + 6.5;
  };
  const sub = (x: number, yy: number, t: string, cols: [string, string] | null = ['Monto', '%']) => {
    doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...TEAL_OSCURO).text(t, x + 2, yy + 4);
    if (cols) {
      doc.text(cols[0], x + col - 17, yy + 4, { align: 'right' });
      doc.text(cols[1], x + col - 2, yy + 4, { align: 'right' });
    }
    doc.setDrawColor(...TEAL).setLineWidth(0.3).line(x, yy + 5.5, x + col, yy + 5.5);
    return yy + 6;
  };
  const fila = (x: number, yy: number, t: string, v: number | string, p: string, o: { b?: boolean; fill?: RGB; color?: RGB; apagado?: boolean; size?: number } = {}) => {
    if (o.fill) doc.setFillColor(...o.fill).rect(x, yy, col, 5.6, 'F');
    const color = o.color ?? (o.apagado ? GRIS : TEXTO);
    doc.setFont('helvetica', o.b ? 'bold' : 'normal').setFontSize(o.size ?? 8).setTextColor(...color);
    doc.text(doc.splitTextToSize(t, col - 40)[0], x + 2, yy + 3.9);
    doc.text(typeof v === 'number' ? dinero(v) : v, x + col - 17, yy + 3.9, { align: 'right' });
    doc.text(p, x + col - 2, yy + 3.9, { align: 'right' });
    doc.setDrawColor(...LINEA).setLineWidth(0.15).line(x, yy + 5.6, x + col, yy + 5.6);
    return yy + 5.6;
  };
  const pi = (n: number) => pct(proporcion(n, e.totalIngresos));
  const pe = (n: number) => pct(proporcion(n, e.totalEgresos));

  // Ingresos (izquierda)
  let yl = encabezado(xL, y, 'INGRESOS');
  yl = sub(xL, yl, 'Ingresos ordinarios');
  for (const x of e.ordinarios) yl = fila(xL, yl, x.label, x.monto, pi(x.monto), { apagado: !x.monto });
  yl = fila(xL, yl, 'Subtotal ingresos ordinarios', e.totalOrdinarios, pi(e.totalOrdinarios), { b: true, fill: CEBRA });
  yl += 2;
  yl = sub(xL, yl, 'Ingresos por amenidades');
  if (e.amenidades.length) for (const a of e.amenidades) yl = fila(xL, yl, `${a.nombre} (${a.reservas} reserva${a.reservas === 1 ? '' : 's'})`, a.monto, pi(a.monto));
  else yl = fila(xL, yl, 'Sin reservas pagadas en el mes', 0, '', { apagado: true });
  yl = fila(xL, yl, 'Subtotal ingresos por amenidades', e.totalAmenidades, pi(e.totalAmenidades), { b: true, fill: CEBRA });

  // Egresos (derecha)
  let yr = encabezado(xR, y, 'EGRESOS');
  yr = sub(xR, yr, 'Concepto');
  if (e.egresos.length) for (const x of e.egresos) yr = fila(xR, yr, x.categoria, x.monto, pe(x.monto));
  else yr = fila(xR, yr, 'Sin egresos registrados en el mes', 0, '', { apagado: true });
  doc.setFont('helvetica', 'italic').setFontSize(7).setTextColor(...GRIS).text(`${e.movimientosEgreso} movimiento${e.movimientosEgreso === 1 ? '' : 's'} con evidencia`, xR + 2, yr + 4);
  yr += 6;

  // Totales a la misma altura
  y = Math.max(yl, yr) + 3;
  for (const [x, t, v] of [
    [xL, 'TOTAL DE INGRESOS', e.totalIngresos],
    [xR, 'TOTAL DE EGRESOS', e.totalEgresos],
  ] as [number, string, number][]) {
    doc.setFillColor(...TEAL_CLARO).rect(x, y, col, 7, 'F');
    doc.setDrawColor(...TEAL_OSCURO).setLineWidth(0.5).line(x, y, x + col, y).line(x, y + 7, x + col, y + 7);
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...TEAL_OSCURO).text(t, x + 2, y + 4.8);
    doc.text(dinero(v), x + col - 17, y + 4.8, { align: 'right' });
    if (v) doc.text('100.0%', x + col - 2, y + 4.8, { align: 'right' });
  }
  y += 12;

  // Estado de resultados (izquierda) y cobranza (derecha)
  yl = encabezado(xL, y, 'ESTADO DE RESULTADOS');
  for (const [t, v, total] of filasResultados(e)) yl = fila(xL, yl, txt(t), v, '', total ? { b: true, fill: TEAL_OSCURO, color: BLANCO } : { apagado: !v });
  if (e.notaSaldoInicial) {
    doc.setFont('helvetica', 'italic').setFontSize(7).setTextColor(...GRIS).text(doc.splitTextToSize(e.notaSaldoInicial, col - 4), xL + 2, yl + 4);
    yl += 8;
  }
  yr = encabezado(xR, y, 'COBRANZA DEL MES');
  const c = e.cobranza;
  yr = fila(xR, yr, 'Cargos emitidos en el mes', c.emitido, '');
  yr = fila(xR, yr, 'Cobrado', c.cobrado, pct(proporcion(c.cobrado, c.emitido)));
  yr = fila(xR, yr, 'Pendiente de cobro', c.pendiente, pct(proporcion(c.pendiente, c.emitido)));
  yr = fila(xR, yr, 'Unidades al corriente', String(c.alCorriente), '');
  yr = fila(xR, yr, 'Unidades con adeudo vencido', String(c.conAdeudo), '', c.conAdeudo ? { color: ROJO, b: true } : {});

  // Gráficas
  y = Math.max(yl, yr) + 7;
  const gh = col * (300 / 520);
  if (y + 6 + gh > H - 14) {
    doc.addPage();
    y = 16;
  }
  for (const [x, t, png] of [
    [xL, 'INGRESOS VS. EGRESOS · ÚLTIMOS 6 MESES', img.grafica],
    [xR, 'DISTRIBUCIÓN DE EGRESOS DEL MES', img.distribucion],
  ] as [number, string, string | undefined][]) {
    doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(...TEAL_OSCURO).text(t, x, y);
    doc.setDrawColor(...TEAL).setLineWidth(0.5).line(x, y + 1.5, x + col, y + 1.5);
    if (png) doc.addImage(png, 'PNG', x, y + 3, col, gh);
  }

  // Pie
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINEA).setLineWidth(0.3).line(M, H - 11, W - M, H - 11);
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...GRIS);
    doc.text('SIIA · soluciones inmobiliarias · siia.casa', M, H - 6.5);
    doc.text(`${e.condominio} · ${nombreMesLargo(e.periodo)}`, W / 2, H - 6.5, { align: 'center' });
    doc.text(`Página ${i} de ${paginas}`, W - M, H - 6.5, { align: 'right' });
  }
  return doc;
}

const limpio = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '').trim();

export async function descargarEstadoPdf(e: EstadoFinanciero) {
  const s1 = svgIngresosEgresos(e.serie);
  const s2 = svgDistribucion(e.egresos.map((x) => ({ label: x.categoria, monto: x.monto })));
  const [logo, grafica, distribucion] = await Promise.all([logoBase64(), pngDeSvg(s1.svg, s1.W, s1.H).catch(() => undefined), pngDeSvg(s2.svg, s2.W, s2.H).catch(() => undefined)]);
  const doc = await construirEstadoPdf(e, { logo, grafica, distribucion });
  doc.save(`Estado financiero ${limpio(e.condominio)} ${limpio(nombreMesLargo(e.periodo))}.pdf`);
}
