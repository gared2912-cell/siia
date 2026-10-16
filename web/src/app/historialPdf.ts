// Historial de pagos de una casa o departamento en PDF (lo descargan la administración y el propio residente).
// Cada cargo uno por uno con su estado (pagado, pendiente, vencido o en revisión), y al final lo pagado y lo que
// debe. El PDF va protegido: se puede ver e imprimir, pero no modificar. jsPDF se carga solo al descargar.

export type CargoHistorial = { id: string; concepto: string; periodo?: string | null; monto: number; vence?: string | null; estado?: string | null };
export type PagoHistorial = { id: string; monto: number; fecha?: string | null; folio?: string | null; estado?: string | null; cargoIds?: (string | null)[] | null; validadoEn?: string | null };
export type DatosHistorial = {
  condominio: string;
  direccion?: string | null;
  unidad: string;
  residente?: string | null;
  cargos: CargoHistorial[];
  pagos: PagoHistorial[];
  hoy: string; // AAAA-MM-DD (hora de México)
};

import type { CellHookData } from 'jspdf-autotable';

// Colores de marca
const TEAL: [number, number, number] = [56, 203, 185];
const TEAL_OSCURO: [number, number, number] = [0, 124, 125];
const TEAL_CLARO: [number, number, number] = [232, 248, 246];
const TEXTO: [number, number, number] = [46, 52, 70];
const GRIS: [number, number, number] = [120, 126, 140];
const LINEA: [number, number, number] = [223, 230, 234];
const ESTADOS: Record<string, { texto: string; color: [number, number, number]; fondo: [number, number, number] }> = {
  PAGADO: { texto: 'Pagado', color: [30, 125, 79], fondo: [230, 244, 236] },
  PENDIENTE: { texto: 'Pendiente', color: [138, 97, 0], fondo: [255, 244, 214] },
  VENCIDO: { texto: 'Vencido', color: [180, 35, 24], fondo: [253, 236, 234] },
  REVISION: { texto: 'En revisión', color: [0, 124, 125], fondo: [232, 248, 246] },
};

const mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const dinero = (n: number) => mxn.format(n);
const fechaCorta = (d?: string | null) => {
  if (!d) return '—';
  const [a, m, dia] = d.slice(0, 10).split('-');
  return `${dia}/${m}/${a}`;
};
const fechaLarga = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
const nombreMes = (p?: string | null) => {
  if (!p || !/^\d{4}-\d{2}$/.test(p)) return '—';
  const [a, m] = p.split('-').map(Number);
  const s = new Date(a, m - 1, 1).toLocaleDateString('es-MX', { month: 'short', year: 'numeric' }).replace('.', '');
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const fechaMX = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(iso));

/** Filas del historial y totales (sin PDF). */
export function calcularHistorial(d: DatosHistorial) {
  const aprobados = d.pagos.filter((p) => p.estado === 'VALIDADO');
  const revision = d.pagos.filter((p) => p.estado === 'EN_REVISION');
  const pagoDe = new Map<string, PagoHistorial>();
  for (const p of aprobados) for (const id of p.cargoIds ?? []) if (id) pagoDe.set(id, p);
  const enRevision = new Set(revision.flatMap((p) => (p.cargoIds ?? []).filter((x): x is string => !!x)));
  const aCuentaEnRevision = revision.some((p) => !(p.cargoIds ?? []).length);
  const filas = d.cargos
    .filter((c) => c.estado !== 'CANCELADO')
    .sort((a, b) => String(a.vence ?? a.periodo ?? '').localeCompare(String(b.vence ?? b.periodo ?? '')) || a.concepto.localeCompare(b.concepto))
    .map((c) => {
      const p = pagoDe.get(c.id);
      const clave =
        c.estado === 'PAGADO' ? 'PAGADO' : enRevision.has(c.id) || aCuentaEnRevision ? 'REVISION' : c.vence && c.vence < d.hoy ? 'VENCIDO' : 'PENDIENTE';
      return { c, p, clave, pagadoEl: p ? (p.fecha ?? (p.validadoEn ? fechaMX(p.validadoEn) : null)) : null };
    });
  const suma = (l: typeof filas) => Math.round(l.reduce((s, x) => s + x.c.monto, 0) * 100) / 100;
  return {
    filas,
    total: suma(filas),
    pagado: suma(filas.filter((x) => x.clave === 'PAGADO')),
    pendiente: suma(filas.filter((x) => x.clave !== 'PAGADO')),
    vencido: suma(filas.filter((x) => x.clave === 'VENCIDO')),
    enRevision: suma(filas.filter((x) => x.clave === 'REVISION')),
    pagosAprobados: aprobados.length,
  };
}

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

/** Arma el PDF (logo opcional en base64) y devuelve el documento de jsPDF. */
export async function construirHistorial(d: DatosHistorial, logoPng?: string) {
  const { jsPDF } = await import('jspdf');
  // jspdf-autotable se publica como UMD: según el empaquetador, la función llega en default o en default.default.
  type AutoTable = typeof import('jspdf-autotable').default;
  const m = (await import('jspdf-autotable')) as unknown as { default: AutoTable | { default: AutoTable } };
  const autoTable: AutoTable = typeof m.default === 'function' ? m.default : m.default.default;
  const h = calcularHistorial(d);
  // Protegido: se puede ver e imprimir, pero no editar ni copiar (clave de propietario aleatoria).
  const clave = Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) => x.toString(16).padStart(2, '0')).join('');
  const doc = new jsPDF({ unit: 'mm', format: 'letter', encryption: { userPassword: '', ownerPassword: clave, userPermissions: ['print'] } });
  doc.setProperties({ title: `Historial de pagos ${d.unidad} · ${d.condominio}`, author: 'SIIA · soluciones inmobiliarias', creator: 'SIIA' });
  const W = doc.internal.pageSize.getWidth();
  const M = 14;

  // Encabezado
  if (logoPng) doc.addImage(logoPng, 'PNG', M, 10, 52, 17.6);
  else {
    doc.setFont('helvetica', 'bold').setFontSize(22).setTextColor(...TEAL).text('SIIA', M, 22);
  }
  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(...TEAL_OSCURO).text('HISTORIAL DE PAGOS', W - M, 16, { align: 'right' });
  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...GRIS).text('Estado de cuenta de la unidad', W - M, 21.5, { align: 'right' });
  doc.text(`Emitido el ${fechaLarga(d.hoy)}`, W - M, 26.5, { align: 'right' });
  doc.setFillColor(...TEAL).rect(M, 31, W - 2 * M, 1.4, 'F');

  // Datos del titular
  let y = 38;
  doc.setFillColor(...TEAL_CLARO).roundedRect(M, y, W - 2 * M, 22, 2, 2, 'F');
  const campo = (x: number, yy: number, etiqueta: string, valor: string) => {
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...GRIS).text(etiqueta.toUpperCase(), x, yy);
    doc.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(...TEXTO).text(valor, x, yy + 5, { maxWidth: 80 });
  };
  campo(M + 5, y + 7, 'Condominio', d.condominio);
  campo(M + 95, y + 7, 'Casa o departamento', d.unidad);
  campo(M + 140, y + 7, 'Residente', d.residente || '—');
  if (d.direccion) doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GRIS).text(d.direccion, M + 5, y + 18, { maxWidth: 170 });

  // Resumen
  y += 28;
  const cajas: [string, number, [number, number, number], [number, number, number]][] = [
    ['Total de cargos', h.total, TEXTO, [246, 250, 250]],
    ['Pagado', h.pagado, ESTADOS.PAGADO.color, ESTADOS.PAGADO.fondo],
    ['En revisión', h.enRevision, ESTADOS.REVISION.color, ESTADOS.REVISION.fondo],
    ['Saldo pendiente', h.pendiente, h.pendiente > 0 ? ESTADOS.VENCIDO.color : ESTADOS.PAGADO.color, h.pendiente > 0 ? ESTADOS.VENCIDO.fondo : ESTADOS.PAGADO.fondo],
  ];
  const cw = (W - 2 * M - 3 * 4) / 4;
  cajas.forEach(([t, v, color, fondo], i) => {
    const x = M + i * (cw + 4);
    doc.setFillColor(...fondo).roundedRect(x, y, cw, 18, 2, 2, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...GRIS).text(t.toUpperCase(), x + cw / 2, y + 6, { align: 'center' });
    doc.setFontSize(13).setTextColor(...color).text(dinero(v), x + cw / 2, y + 13.5, { align: 'center' });
  });

  // Tabla de cargos
  y += 25;
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...TEAL_OSCURO).text('Detalle de cargos', M, y);
  autoTable(doc, {
    startY: y + 3,
    margin: { left: M, right: M, bottom: 22 },
    head: [['#', 'Periodo', 'Concepto', 'Vence', 'Monto', 'Estado', 'Pagado el', 'Recibo']],
    body: h.filas.length
      ? h.filas.map((x, i) => [
          String(i + 1),
          nombreMes(x.c.periodo),
          x.c.concepto,
          fechaCorta(x.c.vence),
          dinero(x.c.monto),
          ESTADOS[x.clave].texto,
          x.pagadoEl ? fechaCorta(x.pagadoEl) : '—',
          x.p?.folio ?? '—',
        ])
      : [[{ content: 'Sin cargos registrados.', colSpan: 8, styles: { halign: 'center', textColor: GRIS } }]],
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 8.5, textColor: TEXTO, cellPadding: { top: 2.2, bottom: 2.2, left: 2, right: 2 }, lineColor: LINEA, lineWidth: { bottom: 0.2 } },
    headStyles: { fillColor: TEAL_OSCURO, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
    alternateRowStyles: { fillColor: [246, 250, 250] },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center', textColor: GRIS },
      1: { cellWidth: 20 },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 20, halign: 'center' },
      4: { cellWidth: 24, halign: 'right' },
      5: { cellWidth: 22, halign: 'center', fontStyle: 'bold' },
      6: { cellWidth: 20, halign: 'center' },
      7: { cellWidth: 18, halign: 'center' },
    },
    didParseCell: (c: CellHookData) => {
      if (c.section === 'head' && c.column.index !== 2 && c.column.index !== 1) c.cell.styles.halign = c.column.index === 4 ? 'right' : 'center';
      if (c.section !== 'body' || c.column.index !== 5 || !h.filas.length) return;
      const e = ESTADOS[h.filas[c.row.index].clave];
      c.cell.styles.textColor = e.color;
      c.cell.styles.fillColor = e.fondo;
    },
  });

  // Totales
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  const H = doc.internal.pageSize.getHeight();
  if (y + 40 > H - 22) {
    doc.addPage();
    y = 20;
  }
  const xT = W - M - 82;
  const linea = (t: string, v: number, color: [number, number, number] = TEXTO, negrita = false) => {
    doc.setFont('helvetica', negrita ? 'bold' : 'normal').setFontSize(negrita ? 11 : 9.5).setTextColor(...TEXTO).text(t, xT + 4, y);
    doc.setTextColor(...color).text(dinero(v), W - M - 4, y, { align: 'right' });
    y += negrita ? 0 : 6;
  };
  linea('Total de cargos', h.total);
  linea('Total pagado', h.pagado, ESTADOS.PAGADO.color);
  if (h.enRevision) linea('En revisión (comprobante subido)', h.enRevision, ESTADOS.REVISION.color);
  doc.setFillColor(...(h.pendiente > 0 ? ESTADOS.VENCIDO.fondo : ESTADOS.PAGADO.fondo)).roundedRect(xT, y - 4, 82, 13, 2, 2, 'F');
  y += 4;
  linea(h.pendiente > 0 ? 'SALDO PENDIENTE' : 'SIN ADEUDO', h.pendiente, h.pendiente > 0 ? ESTADOS.VENCIDO.color : ESTADOS.PAGADO.color, true);
  if (h.vencido > 0) {
    y += 9;
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...ESTADOS.VENCIDO.color).text(`De este saldo, ${dinero(h.vencido)} ya pasó su fecha límite de pago.`, W - M, y, { align: 'right' });
  }

  // Pie de página en todas las hojas
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINEA).setLineWidth(0.3).line(M, H - 17, W - M, H - 17);
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...GRIS);
    doc.text(
      'Documento informativo generado por SIIA. «Pagado» corresponde a pagos con recibo aprobado por la administración; «En revisión», a comprobantes que aún no se validan.',
      M,
      H - 13.5,
      { maxWidth: W - 2 * M },
    );
    doc.text(`SIIA · soluciones inmobiliarias · siia.casa`, M, H - 6.5);
    doc.text(`Página ${i} de ${paginas}`, W - M, H - 6.5, { align: 'right' });
  }
  return doc;
}

const limpio = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '').trim();

/** Arma el historial con el logotipo y lo descarga. */
export async function descargarHistorial(d: DatosHistorial) {
  const doc = await construirHistorial(d, await logo());
  doc.save(`Historial de pagos ${limpio(d.unidad)} ${limpio(d.condominio)}.pdf`);
}
