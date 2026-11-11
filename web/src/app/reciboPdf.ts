// Recibo de pago en PDF (mismo diseño que el recibo en pantalla): marco doble, banda corporativa, número de serie,
// sello digital, QR y sello «PAGADO». Lo descargan la administración y el propio residente. Va protegido: se puede ver
// e imprimir, pero no modificar. jsPDF se carga solo al descargar.
import { conceptoRecibo, notasRecibo, type ReciboData } from './Recibo';
import { importeConLetra, qrDataUrl, selloRecibo } from './reciboSello';

const TEAL: [number, number, number] = [56, 203, 185];
const TEAL_OSCURO: [number, number, number] = [11, 111, 113];
const TEAL_CLARO: [number, number, number] = [234, 248, 246];
const TEXTO: [number, number, number] = [46, 52, 70];
const GRIS: [number, number, number] = [111, 118, 128];
const LINEA: [number, number, number] = [223, 231, 234];

const mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const fechaLarga = (d?: string) => {
  if (!d) return '—';
  const s = d.length > 10 ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(d)) : d;
  return new Date(`${s}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
};
const fechaCorta = (d?: string) => {
  if (!d) return '';
  const s = d.length > 10 ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(d)) : d;
  return new Date(`${s}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
};
const limpio = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '').trim();

async function imagen(ruta: string): Promise<string | undefined> {
  try {
    const r = await fetch(ruta);
    if (!r.ok) return undefined;
    const b = await r.blob();
    return await new Promise((ok, mal) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result));
      fr.onerror = mal;
      fr.readAsDataURL(b);
    });
  } catch {
    return undefined;
  }
}

export async function construirRecibo(d: ReciboData, logoBlanco?: string) {
  const { jsPDF } = await import('jspdf');
  type AutoTable = typeof import('jspdf-autotable').default;
  const m = (await import('jspdf-autotable')) as unknown as { default: AutoTable | { default: AutoTable } };
  const autoTable: AutoTable = typeof m.default === 'function' ? m.default : m.default.default;
  const { pago, cargos, condominio, unidad } = d;
  const sello = await selloRecibo(d);
  const qr = await qrDataUrl(sello.qr, 360);
  const clave = Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) => x.toString(16).padStart(2, '0')).join('');
  const doc = new jsPDF({ unit: 'mm', format: 'letter', encryption: { userPassword: '', ownerPassword: clave, userPermissions: ['print'] } });
  doc.setProperties({ title: `Recibo ${pago.folio ?? ''} · ${unidad.etiqueta}`, author: 'SIIA · soluciones inmobiliarias', creator: 'SIIA', subject: `Serie ${sello.serie}` });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const opacidad = (o: number) => {
    const x = doc as unknown as { GState: new (g: object) => unknown; setGState: (g: unknown) => void };
    x.setGState(new x.GState({ opacity: o }));
  };

  // Marco doble
  doc.setDrawColor(...TEAL_OSCURO).setLineWidth(0.7).roundedRect(8, 8, W - 16, H - 16, 3, 3, 'S');
  doc.setDrawColor(...TEAL).setLineWidth(0.3).roundedRect(10, 10, W - 20, H - 20, 2, 2, 'S');

  // Marca de agua
  opacidad(0.05);
  doc.setFont('helvetica', 'bold').setFontSize(96).setTextColor(...TEAL_OSCURO).text('PAGADO', W / 2 - 62, H / 2 + 40, { angle: 30 });
  opacidad(1);

  // Banda corporativa
  doc.setFillColor(...TEAL_OSCURO).rect(10, 10, W - 20, 30, 'F');
  doc.setFillColor(...TEAL).rect(10, 40, W - 20, 1.6, 'F');
  if (logoBlanco) doc.addImage(logoBlanco, 'PNG', M + 2, 15.5, 56, 18.9);
  else doc.setFont('helvetica', 'bold').setFontSize(24).setTextColor(255, 255, 255).text('SIIA', M + 2, 30);
  doc.setTextColor(255, 255, 255).setFont('helvetica', 'bold').setFontSize(9).text('RECIBO DE PAGO', W - M - 2, 19, { align: 'right' });
  doc.setFontSize(20).text(pago.folio ?? '', W - M - 2, 29, { align: 'right' });
  doc.setFont('helvetica', 'normal').setFontSize(9).text(`Validado el ${fechaLarga(pago.validadoEn)}`, W - M - 2, 35, { align: 'right' });

  // Datos del pago
  let y = 48;
  doc.setFillColor(...TEAL_CLARO).roundedRect(M, y, W - 2 * M, 28, 2, 2, 'F');
  const campo = (x: number, yy: number, etiqueta: string, valor: string, ancho = 42) => {
    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(...GRIS).text(etiqueta.toUpperCase(), x, yy);
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...TEXTO).text(valor || '—', x, yy + 5, { maxWidth: ancho });
  };
  campo(M + 5, y + 7, 'Condominio', condominio.nombre, 60);
  if (condominio.direccion) doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GRIS).text(condominio.direccion, M + 70, y + 12, { maxWidth: W - 2 * M - 75 });
  campo(M + 5, y + 20, 'Casa o departamento', unidad.etiqueta, 40);
  if (unidad.propietario) campo(M + 48, y + 20, 'Residente', unidad.propietario, 62);
  campo(M + 114, y + 20, 'Fecha de pago', fechaCorta(pago.fecha) || '—', 34);
  campo(M + 150, y + 20, 'Referencia', pago.referencia || '—', W - 2 * M - 152);

  // Conceptos
  y += 35;
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, bottom: 30 },
    head: [['#', 'Concepto', 'Importe']],
    body: cargos.length ? cargos.map((c, i) => [String(i + 1), conceptoRecibo(c, mxn.format), mxn.format(c.monto)]) : [['1', 'Pago a cuenta de mantenimiento', mxn.format(pago.monto)]],
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 9.5, textColor: TEXTO, cellPadding: { top: 2.8, bottom: 2.8, left: 2.5, right: 2.5 }, lineColor: LINEA, lineWidth: { bottom: 0.2 } },
    headStyles: { fillColor: TEAL_OSCURO, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
    alternateRowStyles: { fillColor: [246, 250, 250] },
    columnStyles: { 0: { cellWidth: 10, halign: 'center', textColor: GRIS }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 36, halign: 'right' } },
    didParseCell: (c) => {
      if (c.section === 'head' && c.column.index === 2) c.cell.styles.halign = 'right';
    },
  });

  // Total, importe con letra y notas
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  const xT = W - M - 95;
  doc.setFillColor(...TEAL_CLARO).roundedRect(xT, y, 95, 13, 2, 2, 'F');
  doc.setFillColor(...TEAL_OSCURO).rect(xT, y, 1.6, 13, 'F');
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...TEXTO).text('TOTAL RECIBIDO', xT + 6, y + 8.3);
  doc.setFontSize(14).setTextColor(...TEAL_OSCURO).text(mxn.format(pago.monto), W - M - 4, y + 8.8, { align: 'right' });
  y += 18;
  doc.setFont('helvetica', 'italic').setFontSize(8).setTextColor(...GRIS).text(`(${importeConLetra(pago.monto)})`, W - M - 2, y, { align: 'right', maxWidth: 150 });
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...TEXTO);
  for (const t of notasRecibo(pago, mxn.format)) doc.text(t, W - M - 2, (y += 5.5), { align: 'right' });

  // Autenticidad: QR, número de serie, sello digital y sello «PAGADO» (al pie de la hoja)
  y = Math.min(y + 12, H - 72);
  doc.setDrawColor(...TEAL).setLineWidth(0.3).setLineDashPattern([1.2, 1.2], 0).line(M, y, W - M, y).setLineDashPattern([], 0);
  y += 6;
  doc.addImage(qr, 'PNG', M, y, 32, 32);
  const xs = M + 38;
  const anchoSello = W - M - 50 - xs;
  doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(...GRIS).text('NO. DE SERIE', xs, y + 3);
  doc.setFont('courier', 'bold').setFontSize(11).setTextColor(...TEAL_OSCURO).text(sello.serie, xs, y + 8.5);
  doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(...GRIS).text('SELLO DIGITAL SIIA', xs, y + 15);
  doc.setFont('courier', 'normal').setFontSize(6.6).setTextColor(...TEXTO).text(doc.splitTextToSize(sello.sello, anchoSello), xs, y + 19);
  doc.setFont('helvetica', 'normal').setFontSize(6.8).setTextColor(...GRIS).text('El número de serie y el sello digital identifican este recibo de forma única.', xs, y + 31);

  const cx = W - M - 21;
  const cy = y + 16;
  opacidad(0.85);
  doc.setDrawColor(...TEAL_OSCURO).setLineWidth(0.9).circle(cx, cy, 17, 'S');
  doc.setLineWidth(0.35).circle(cx, cy, 11.5, 'S');
  doc.setTextColor(...TEAL_OSCURO).setFont('helvetica', 'bold').setFontSize(7).text('SIIA', cx, cy - 13.2, { align: 'center' });
  doc.setFontSize(6.5).text(pago.folio ?? '', cx, cy + 15, { align: 'center' });
  doc.setFontSize(11.5).text('PAGADO', cx, cy + 1.5, { align: 'center' });
  doc.setFont('helvetica', 'normal').setFontSize(5.8).text(fechaCorta(pago.validadoEn), cx, cy + 6, { align: 'center' });
  opacidad(1);

  // Pie
  doc.setFillColor(243, 246, 247).rect(10, H - 24, W - 20, 14, 'F');
  doc.setFillColor(...TEAL).rect(10, H - 24, W - 20, 0.9, 'F');
  doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...GRIS);
  doc.text('SIIA · Sistemas Integrales Inmobiliarios y de Administración · siia.casa', W / 2, H - 18, { align: 'center' });
  doc.text('Documento sin validez fiscal.', W / 2, H - 13.5, { align: 'center' });
  return doc;
}

/** Arma el recibo con el logotipo blanco y lo descarga. */
export async function descargarRecibo(d: ReciboData) {
  const doc = await construirRecibo(d, await imagen('/marca/siia-horizontal-blanco.png'));
  doc.save(`Recibo ${limpio(d.pago.folio ?? '')} ${limpio(d.unidad.etiqueta)}.pdf`);
}
