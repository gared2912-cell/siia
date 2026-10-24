// Recibo de pago en PDF (mismo contenido que el recibo en pantalla), con el formato del historial de pagos.
// Lo descargan la administración y el propio residente. Va protegido: se puede ver e imprimir, pero no modificar.
// jsPDF se carga solo al descargar.
import type { ReciboData } from './Recibo';

const TEAL: [number, number, number] = [56, 203, 185];
const TEAL_OSCURO: [number, number, number] = [0, 124, 125];
const TEAL_CLARO: [number, number, number] = [232, 248, 246];
const TEXTO: [number, number, number] = [46, 52, 70];
const GRIS: [number, number, number] = [120, 126, 140];
const LINEA: [number, number, number] = [223, 230, 234];
const VERDE: [number, number, number] = [30, 125, 79];
const VERDE_CLARO: [number, number, number] = [230, 244, 236];

const mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const fechaLarga = (d?: string) => {
  if (!d) return '—';
  const s = d.length > 10 ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(d)) : d;
  return new Date(`${s}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
};
const limpio = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '').trim();

async function logo(): Promise<string | undefined> {
  try {
    const r = await fetch('/marca/siia-horizontal.png');
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

export async function construirRecibo(d: ReciboData, logoPng?: string) {
  const { jsPDF } = await import('jspdf');
  type AutoTable = typeof import('jspdf-autotable').default;
  const m = (await import('jspdf-autotable')) as unknown as { default: AutoTable | { default: AutoTable } };
  const autoTable: AutoTable = typeof m.default === 'function' ? m.default : m.default.default;
  const { pago, cargos, condominio, unidad } = d;
  const clave = Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) => x.toString(16).padStart(2, '0')).join('');
  const doc = new jsPDF({ unit: 'mm', format: 'letter', encryption: { userPassword: '', ownerPassword: clave, userPermissions: ['print'] } });
  doc.setProperties({ title: `Recibo ${pago.folio ?? ''} · ${unidad.etiqueta}`, author: 'SIIA · soluciones inmobiliarias', creator: 'SIIA' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;

  // Encabezado
  if (logoPng) doc.addImage(logoPng, 'PNG', M, 10, 52, 17.6);
  else doc.setFont('helvetica', 'bold').setFontSize(22).setTextColor(...TEAL).text('SIIA', M, 22);
  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(...TEAL_OSCURO).text('RECIBO DE PAGO', W - M, 16, { align: 'right' });
  doc.setFontSize(12).setTextColor(...TEXTO).text(pago.folio ?? '', W - M, 22, { align: 'right' });
  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...GRIS).text(`Validado el ${fechaLarga(pago.validadoEn)}`, W - M, 27, { align: 'right' });
  doc.setFillColor(...TEAL).rect(M, 31, W - 2 * M, 1.4, 'F');

  // Titular
  let y = 38;
  doc.setFillColor(...TEAL_CLARO).roundedRect(M, y, W - 2 * M, 22, 2, 2, 'F');
  const campo = (x: number, yy: number, etiqueta: string, valor: string) => {
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...GRIS).text(etiqueta.toUpperCase(), x, yy);
    doc.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(...TEXTO).text(valor, x, yy + 5, { maxWidth: 80 });
  };
  campo(M + 5, y + 7, 'Condominio', condominio.nombre);
  campo(M + 95, y + 7, 'Casa o departamento', unidad.etiqueta);
  campo(M + 140, y + 7, 'Residente', unidad.propietario || '—');
  if (condominio.direccion) doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GRIS).text(condominio.direccion, M + 5, y + 18, { maxWidth: 170 });

  // Conceptos
  y += 30;
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...TEAL_OSCURO).text('Conceptos pagados', M, y);
  autoTable(doc, {
    startY: y + 3,
    margin: { left: M, right: M, bottom: 22 },
    head: [['#', 'Concepto', 'Importe']],
    body: cargos.length ? cargos.map((c, i) => [String(i + 1), c.concepto, mxn.format(c.monto)]) : [['1', 'Pago a cuenta de mantenimiento', mxn.format(pago.monto)]],
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 9.5, textColor: TEXTO, cellPadding: { top: 2.6, bottom: 2.6, left: 2, right: 2 }, lineColor: LINEA, lineWidth: { bottom: 0.2 } },
    headStyles: { fillColor: TEAL_OSCURO, textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [246, 250, 250] },
    columnStyles: { 0: { cellWidth: 10, halign: 'center', textColor: GRIS }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 36, halign: 'right' } },
    didParseCell: (c) => {
      if (c.section === 'head' && c.column.index === 2) c.cell.styles.halign = 'right';
    },
  });

  // Total y datos del pago
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  const xT = W - M - 82;
  doc.setFillColor(...VERDE_CLARO).roundedRect(xT, y, 82, 13, 2, 2, 'F');
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...TEXTO).text('TOTAL RECIBIDO', xT + 4, y + 8.5);
  doc.setTextColor(...VERDE).text(mxn.format(pago.monto), W - M - 4, y + 8.5, { align: 'right' });
  y += 22;
  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...TEXTO);
  doc.text(`Fecha de pago: ${fechaLarga(pago.fecha)}`, M, y);
  if (pago.referencia) doc.text(`Referencia: ${pago.referencia}`, M, y + 6);

  // Pie
  doc.setDrawColor(...LINEA).setLineWidth(0.3).line(M, H - 17, W - M, H - 17);
  doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...GRIS);
  doc.text('SIIA · Sistemas Integrales Inmobiliarios y de Administración · Documento sin validez fiscal.', M, H - 13.5);
  doc.text('SIIA · soluciones inmobiliarias · siia.casa', M, H - 6.5);
  return doc;
}

/** Arma el recibo con el logotipo y lo descarga. */
export async function descargarRecibo(d: ReciboData) {
  const doc = await construirRecibo(d, await logo());
  doc.save(`Recibo ${limpio(d.pago.folio ?? '')} ${limpio(d.unidad.etiqueta)}.pdf`);
}
