// Panel › Proveedores › Reportes para residentes: reporte mensual de vistas en PDF (formato SIIA).
// Por cada reporte (folio): qué departamentos lo vieron y cuáles no; quiénes ven más los reportes y quiénes no
// los revisan; y una gráfica por departamento. «Visto» = un residente del departamento abrió el reporte completo
// en Mantenimientos › Trabajos realizados. jsPDF se carga solo al descargar.

export type VistasMes = {
  condominio: string;
  mes: string; // AAAA-MM
  totalUnidades: number;
  sinResidentes: number;
  reportes: { folio: string; fecha: string; servicio: string; proveedor: string; vieron: string[]; noVieron: string[] }[];
  unidades: { etiqueta: string; vistos: number; total: number }[];
};

type RGB = [number, number, number];
const TEAL: RGB = [56, 203, 185];
const TEAL_OSCURO: RGB = [0, 124, 125];
const TEAL_CLARO: RGB = [232, 248, 246];
const TEXTO: RGB = [46, 52, 70];
const GRIS: RGB = [120, 126, 140];
const LINEA: RGB = [223, 230, 234];
const VERDE: RGB = [30, 158, 106];
const AMARILLO: RGB = [224, 161, 0];
const ROJO: RGB = [208, 69, 62];

const nombreMes = (p: string) => {
  const [a, m] = p.split('-').map(Number);
  const s = new Date(a, m - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const fechaCorta = (d: string) => {
  const [a, m, dia] = d.slice(0, 10).split('-');
  return `${dia}/${m}/${a}`;
};
const hoyLargo = () => new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Mexico_City' });
/** «Depto 368» → «368» (para la gráfica). */
const corta = (e: string) => e.replace(/^(depto\.?|departamento|casa|local|unidad)\s*/i, '');
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const colorDe = (vistos: number, total: number): RGB => (!vistos ? ROJO : vistos >= total ? VERDE : AMARILLO);

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

export async function construirVistas(d: VistasMes, logoPng?: string, generadoPor?: string) {
  const { jsPDF } = await import('jspdf');
  type AutoTable = typeof import('jspdf-autotable').default;
  const m = (await import('jspdf-autotable')) as unknown as { default: AutoTable | { default: AutoTable } };
  const autoTable: AutoTable = typeof m.default === 'function' ? m.default : m.default.default;
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  doc.setProperties({ title: `Vistas de trabajos realizados ${nombreMes(d.mes)} · ${d.condominio}`, author: 'SIIA · soluciones inmobiliarias', creator: 'SIIA' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const finTabla = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const espacio = (y: number, alto: number) => {
    if (y + alto <= H - 22) return y;
    doc.addPage();
    return 20;
  };
  const titulo = (t: string, y: number) => doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...TEAL_OSCURO).text(t, M, y);

  // Encabezado
  if (logoPng) doc.addImage(logoPng, 'PNG', M, 10, 52, 17.6);
  else doc.setFont('helvetica', 'bold').setFontSize(22).setTextColor(...TEAL).text('SIIA', M, 22);
  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(...TEAL_OSCURO).text('REPORTE DE VISTAS', W - M, 16, { align: 'right' });
  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...GRIS).text(`Trabajos realizados · ${nombreMes(d.mes)}`, W - M, 21.5, { align: 'right' });
  doc.text(`Emitido el ${hoyLargo()}`, W - M, 26.5, { align: 'right' });
  doc.setFillColor(...TEAL).rect(M, 31, W - 2 * M, 1.4, 'F');

  // Resumen
  const n = d.reportes.length;
  const todos = d.unidades.filter((u) => n && u.vistos >= n).length;
  const ninguno = d.unidades.filter((u) => !u.vistos).length;
  const vistasTot = d.reportes.reduce((s, r) => s + r.vieron.length, 0);
  const promedio = n && d.totalUnidades ? Math.round((vistasTot / (n * d.totalUnidades)) * 100) : 0;
  let y = 38;
  doc.setFillColor(...TEAL_CLARO).roundedRect(M, y, W - 2 * M, 14, 2, 2, 'F');
  doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...GRIS).text('CONDOMINIO', M + 5, y + 5.5);
  doc.text('PERIODO', M + 110, y + 5.5);
  doc.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(...TEXTO).text(d.condominio, M + 5, y + 10.5, { maxWidth: 100 });
  doc.text(nombreMes(d.mes), M + 110, y + 10.5);
  y += 19;
  const cajas: [string, string, RGB][] = [
    ['Reportes del mes', String(n), TEXTO],
    ['Vistas promedio', `${promedio}%`, promedio >= 50 ? VERDE : promedio ? AMARILLO : ROJO],
    ['Vieron todos', `${todos} de ${d.totalUnidades}`, VERDE],
    ['No vieron ninguno', `${ninguno} de ${d.totalUnidades}`, ninguno ? ROJO : VERDE],
  ];
  const cw = (W - 2 * M - 3 * 4) / 4;
  cajas.forEach(([t, v, color], i) => {
    const x = M + i * (cw + 4);
    doc.setFillColor(246, 250, 250).roundedRect(x, y, cw, 17, 2, 2, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...GRIS).text(t.toUpperCase(), x + cw / 2, y + 6, { align: 'center' });
    doc.setFontSize(13).setTextColor(...color).text(v, x + cw / 2, y + 13, { align: 'center' });
  });
  y += 23;

  // Por reporte (folio)
  titulo('Vistas por reporte', y);
  autoTable(doc, {
    startY: y + 3,
    margin: { left: M, right: M, bottom: 22 },
    head: [['Folio', 'Fecha', 'Trabajo', 'Vistas', 'Lo vieron', 'No lo vieron']],
    body: n
      ? d.reportes.map((r) => [
          r.folio,
          fechaCorta(r.fecha),
          `${r.servicio}\n${r.proveedor}`,
          `${r.vieron.length} de ${d.totalUnidades}`,
          r.vieron.join(', ') || '—',
          r.noVieron.join(', ') || '—',
        ])
      : [[{ content: 'No hubo reportes para residentes en este mes.', colSpan: 6, styles: { halign: 'center', textColor: GRIS } }]],
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 7.8, textColor: TEXTO, cellPadding: 2, lineColor: LINEA, lineWidth: { bottom: 0.2 }, valign: 'top' },
    headStyles: { fillColor: TEAL_OSCURO, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [246, 250, 250] },
    columnStyles: {
      0: { cellWidth: 20, fontStyle: 'bold' },
      1: { cellWidth: 18 },
      2: { cellWidth: 34 },
      3: { cellWidth: 16, halign: 'center', fontStyle: 'bold' },
      4: { cellWidth: 'auto', textColor: VERDE },
      5: { cellWidth: 'auto', textColor: ROJO },
    },
  });
  y = finTabla() + 9;

  // Quiénes ven más y quiénes no revisan
  if (n) {
    const ordenados = [...d.unidades].sort((a, b) => b.vistos - a.vistos || a.etiqueta.localeCompare(b.etiqueta, 'es', { numeric: true }));
    const masVen = ordenados.filter((u) => u.vistos > 0).slice(0, 10);
    const noRevisan = ordenados.filter((u) => !u.vistos);
    y = espacio(y, 40);
    titulo('Quiénes revisan los reportes', y);
    autoTable(doc, {
      startY: y + 3,
      margin: { left: M, right: M, bottom: 22 },
      head: [['Los que más los ven', 'No revisaron ninguno']],
      body: [
        [
          masVen.map((u) => `${u.etiqueta}: ${u.vistos} de ${n} (${pct(u.vistos, n)}%)`).join('\n') || 'Nadie abrió los reportes este mes.',
          noRevisan.map((u) => u.etiqueta).join(', ') || 'Todos los departamentos abrieron al menos un reporte.',
        ],
      ],
      theme: 'plain',
      styles: { font: 'helvetica', fontSize: 8.2, textColor: TEXTO, cellPadding: 3, valign: 'top' },
      headStyles: { fillColor: TEAL_CLARO, textColor: TEAL_OSCURO, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: (W - 2 * M) / 2 }, 1: { textColor: ROJO } },
    });
    y = finTabla() + 9;

    // Gráfica: porcentaje de reportes vistos por departamento
    const alto = 48;
    y = espacio(y, alto + 30);
    titulo('Reportes vistos por departamento', y);
    const x0 = M + 8;
    const ancho = W - M - x0;
    const top = y + 6;
    const base = top + alto;
    doc.setFont('helvetica', 'normal').setFontSize(6.5).setTextColor(...GRIS);
    for (const p of [0, 50, 100]) {
      const yy = base - (alto * p) / 100;
      doc.setDrawColor(...LINEA).setLineWidth(0.2).line(x0, yy, x0 + ancho, yy);
      doc.text(`${p}%`, x0 - 1.5, yy + 1, { align: 'right' });
    }
    const k = d.unidades.length || 1;
    const paso = ancho / k;
    const barra = Math.max(0.8, Math.min(6, paso * 0.7));
    d.unidades.forEach((u, i) => {
      const cx = x0 + paso * i + paso / 2;
      const h = Math.max(u.vistos ? (alto * u.vistos) / n : 0.8, 0.8);
      doc.setFillColor(...colorDe(u.vistos, n)).rect(cx - barra / 2, base - h, barra, h, 'F');
      // Etiqueta vertical debajo del eje (el texto girado 90° crece hacia arriba desde su punto de inicio)
      const et = corta(u.etiqueta);
      doc.setFontSize(paso < 3.2 ? 4.6 : 6).setTextColor(...TEXTO);
      doc.text(et, cx + 0.9, base + 2 + doc.getTextWidth(et), { angle: 90 });
    });
    y = base + 16;
    const ley: [RGB, string][] = [
      [VERDE, 'Vio todos'],
      [AMARILLO, 'Vio algunos'],
      [ROJO, 'No vio ninguno'],
    ];
    let lx = M;
    doc.setFontSize(7.5);
    for (const [c, t] of ley) {
      doc.setFillColor(...c).rect(lx, y - 2.5, 3, 3, 'F');
      doc.setTextColor(...TEXTO).text(t, lx + 4.5, y);
      lx += doc.getTextWidth(t) + 12;
    }
  }

  // Pie de página
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINEA).setLineWidth(0.3).line(M, H - 17, W - M, H - 17);
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...GRIS);
    doc.text(
      `«Visto»: un residente del departamento abrió el reporte completo en Mantenimientos › Trabajos realizados. Cuenta solo departamentos con residentes registrados (${d.totalUnidades})${d.sinResidentes ? `; ${d.sinResidentes} sin residentes no se incluyen` : ''}.`,
      M,
      H - 13.5,
      { maxWidth: W - 2 * M },
    );
    doc.text('SIIA · soluciones inmobiliarias · siia.casa', M, H - 6.5);
    if (generadoPor) doc.text(`Generado por ${generadoPor}`, W / 2, H - 6.5, { align: 'center' });
    doc.text(`Página ${i} de ${paginas}`, W - M, H - 6.5, { align: 'right' });
  }
  return doc;
}

const limpio = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '').trim();

export async function descargarVistas(d: VistasMes, generadoPor?: string) {
  const doc = await construirVistas(d, await logo(), generadoPor);
  doc.save(`Vistas de trabajos ${limpio(nombreMes(d.mes))} ${limpio(d.condominio)}.pdf`);
}
