// Balance general acumulado en PDF (Finanzas › Balance › General / acumulado): un solo documento sencillo de enero al
// mes elegido con el saldo inicial del año, los ingresos por categoría (cuota corriente, recuperación de cartera,
// extraordinarias, amenidades, sanciones, fondo de ahorro…), los gastos por concepto, ingresos − egresos, los fondos y
// apartados y lo disponible para ejecutar, más el resumen mes por mes. jsPDF se carga solo al descargar.
import { calcularBalance, mesSiguiente, nombreMes, redondear, type Balance, type DatosFinanzas } from './balance';

const TEAL: [number, number, number] = [56, 203, 185];
const TEAL_OSCURO: [number, number, number] = [0, 124, 125];
const TEAL_CLARO: [number, number, number] = [232, 248, 246];
const TEXTO: [number, number, number] = [46, 52, 70];
const GRIS: [number, number, number] = [120, 126, 140];
const LINEA: [number, number, number] = [223, 230, 234];
const ROJO: [number, number, number] = [180, 35, 24];

const mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const dinero = (n: number) => mxn.format(n);
const pct = (n: number, total: number) => (total ? `${((n / total) * 100).toFixed(1)}%` : '—');
const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

export type OpcionesBalanceGeneral = { condominio: string; direccion?: string | null; hasta: string; datos: DatosFinanzas; generadoPor?: string };

/** Totales del año (enero → hasta): ingresos por categoría, egresos por concepto y cada mes. */
export function calcularGeneral(o: OpcionesBalanceGeneral) {
  const anio = o.hasta.slice(0, 4);
  const meses: Balance[] = [];
  for (let m = `${anio}-01`; m <= o.hasta; m = mesSiguiente(m)) meses.push(calcularBalance(o.datos, m));
  const ultimo = meses[meses.length - 1];
  const categorias = ultimo.categorias.map((c) => ({ ...c, monto: redondear(meses.reduce((s, b) => s + (b.categorias.find((x) => x.key === c.key)?.monto ?? 0), 0)) }));
  const porConcepto = new Map<string, number>();
  for (const b of meses) for (const e of b.egresos) if (e.monto) porConcepto.set(e.categoria, (porConcepto.get(e.categoria) ?? 0) + e.monto);
  const egresos = [...porConcepto].map(([categoria, monto]) => ({ categoria, monto: redondear(monto) })).sort((a, b) => b.monto - a.monto);
  const totalIngresos = redondear(meses.reduce((s, b) => s + b.totalIngresos, 0));
  const totalEgresos = redondear(meses.reduce((s, b) => s + b.totalEgresos, 0));
  return {
    anio,
    meses,
    saldoInicial: meses[0].saldoInicial,
    categorias,
    egresos,
    totalIngresos,
    totalEgresos,
    saldoFinal: ultimo.saldoFinal,
    fondos: ultimo.fondos,
    apartados: ultimo.apartados,
    totalReservado: ultimo.totalReservado,
    disponible: ultimo.disponible,
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

export async function construirBalanceGeneral(o: OpcionesBalanceGeneral, logoPng?: string) {
  const { jsPDF } = await import('jspdf');
  type AutoTable = typeof import('jspdf-autotable').default;
  const m = (await import('jspdf-autotable')) as unknown as { default: AutoTable | { default: AutoTable } };
  const autoTable: AutoTable = typeof m.default === 'function' ? m.default : m.default.default;
  const g = calcularGeneral(o);
  const periodo = `Enero a ${nombreMes(o.hasta).toLowerCase()}`;
  const clave = Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) => x.toString(16).padStart(2, '0')).join('');
  const doc = new jsPDF({ unit: 'mm', format: 'letter', encryption: { userPassword: '', ownerPassword: clave, userPermissions: ['print'] } });
  doc.setProperties({ title: `Balance general ${o.condominio} ${periodo}`, author: 'SIIA · soluciones inmobiliarias', creator: 'SIIA' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const finTabla = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  // Encabezado
  if (logoPng) doc.addImage(logoPng, 'PNG', M, 10, 52, 17.6);
  else doc.setFont('helvetica', 'bold').setFontSize(22).setTextColor(...TEAL).text('SIIA', M, 22);
  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(...TEAL_OSCURO).text('BALANCE GENERAL', W - M, 16, { align: 'right' });
  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...GRIS).text(`Acumulado · ${periodo}`, W - M, 21.5, { align: 'right' });
  let y = 32;
  doc.setFillColor(...TEAL_CLARO).roundedRect(M, y, W - 2 * M, 16, 2, 2, 'F');
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...TEXTO).text(o.condominio, M + 5, y + 6.5);
  if (o.direccion) doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GRIS).text(o.direccion, M + 5, y + 12, { maxWidth: 120 });
  doc
    .setFont('helvetica', 'normal')
    .setFontSize(8)
    .setTextColor(...GRIS)
    .text(`Emitido el ${new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}`, W - M - 5, y + 6.5, { align: 'right' });
  y += 22;

  // Indicadores
  const cajas: [string, number, boolean?][] = [
    [`Saldo al 1 de enero ${g.anio}`, g.saldoInicial],
    ['Ingresos acumulados', g.totalIngresos],
    ['Egresos acumulados', g.totalEgresos],
    ['Disponible para ejecutar', g.disponible, true],
  ];
  const cw = (W - 2 * M - 3 * 3) / 4;
  cajas.forEach(([t, v, oscuro], i) => {
    const x = M + i * (cw + 3);
    doc.setFillColor(...(oscuro ? TEAL_OSCURO : ([247, 249, 250] as [number, number, number]))).roundedRect(x, y, cw, 17, 2, 2, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(...(oscuro ? ([207, 243, 239] as [number, number, number]) : GRIS)).text(t.toUpperCase(), x + cw / 2, y + 6, { align: 'center' });
    doc.setFont('helvetica', 'bold').setFontSize(11.5).setTextColor(...(oscuro ? ([255, 255, 255] as [number, number, number]) : v < 0 ? ROJO : TEXTO)).text(dinero(v), x + cw / 2, y + 13, { align: 'center' });
  });
  y += 24;

  const estilos = {
    theme: 'grid' as const,
    margin: { left: M, right: M },
    styles: { font: 'helvetica', fontSize: 8.8, textColor: TEXTO, lineColor: LINEA, lineWidth: 0.2, cellPadding: 1.8 },
    headStyles: { fillColor: TEAL_OSCURO, textColor: [255, 255, 255] as [number, number, number], fontStyle: 'bold' as const },
    columnStyles: { 1: { halign: 'right' as const, cellWidth: 38 }, 2: { halign: 'right' as const, cellWidth: 22 } },
    footStyles: { fillColor: TEAL_CLARO, textColor: TEAL_OSCURO, fontStyle: 'bold' as const },
  };
  const titulo = (t: string) => {
    if (y > H - 50) {
      doc.addPage();
      y = 18;
    }
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...TEAL_OSCURO).text(t, M, y);
    y += 2;
  };

  // Ingresos por categoría (con color de la categoría)
  titulo('Ingresos por categoría');
  const cats = g.categorias.filter((c) => c.monto);
  autoTable(doc, {
    ...estilos,
    startY: y,
    head: [['Categoría', 'Monto', '%']],
    body: cats.length ? cats.map((c) => [`${c.label}${c.fondo ? ' (fondo)' : ''}`, dinero(c.monto), pct(c.monto, g.totalIngresos)]) : [['Sin ingresos aprobados en el periodo', dinero(0), '—']],
    foot: [['Total de ingresos', dinero(g.totalIngresos), g.totalIngresos ? '100%' : '—']],
    didDrawCell: (h) => {
      if (h.section !== 'body' || h.column.index !== 0 || !cats[h.row.index]) return;
      doc.setFillColor(...rgb(cats[h.row.index].color)).rect(h.cell.x, h.cell.y, 1.4, h.cell.height, 'F');
    },
  });
  y = finTabla() + 8;

  // Gastos por concepto
  titulo('Gastos por concepto');
  autoTable(doc, {
    ...estilos,
    startY: y,
    head: [['Concepto', 'Monto', '%']],
    body: g.egresos.length ? g.egresos.map((e) => [e.categoria, dinero(e.monto), pct(e.monto, g.totalEgresos)]) : [['Sin egresos registrados en el periodo', dinero(0), '—']],
    foot: [['Total de egresos', dinero(g.totalEgresos), g.totalEgresos ? '100%' : '—']],
  });
  y = finTabla() + 8;

  // Resultado
  titulo('Resultado del periodo');
  const filas: string[][] = [
    [`Saldo al 1 de enero ${g.anio}`, dinero(g.saldoInicial)],
    ['(+) Ingresos', dinero(g.totalIngresos)],
    ['(−) Egresos', dinero(-g.totalEgresos)],
    ['(=) Ingresos − egresos del periodo', dinero(redondear(g.totalIngresos - g.totalEgresos))],
    [`(=) Saldo al cierre de ${nombreMes(o.hasta).toLowerCase()}`, dinero(g.saldoFinal)],
    ['(−) Fondos y apartados (no disponibles para el gasto)', dinero(-g.totalReservado)],
  ];
  autoTable(doc, {
    ...estilos,
    startY: y,
    body: filas,
    foot: [['(=) Disponible para ejecutar', dinero(g.disponible)]],
    columnStyles: { 1: { halign: 'right', cellWidth: 45 } },
    didParseCell: (h) => {
      if (h.section === 'body' && h.row.index === 4) h.cell.styles.fontStyle = 'bold';
    },
  });
  y = finTabla() + 8;

  // Fondos y apartados
  if (g.fondos.some((f) => f.saldo) || g.apartados.length) {
    titulo('Fondos (guardaditos) y apartados al cierre');
    autoTable(doc, {
      ...estilos,
      startY: y,
      head: [['Fondo o apartado', 'Saldo']],
      body: [...g.fondos.map((f) => [f.label, dinero(f.saldo)]), ...g.apartados.map((a) => [`Apartado: ${a.nombre}`, dinero(a.saldo)])],
      foot: [['Total reservado', dinero(g.totalReservado)]],
      columnStyles: { 1: { halign: 'right', cellWidth: 45 } },
    });
    y = finTabla() + 8;
  }

  // Mes por mes
  titulo('Resumen mes por mes');
  autoTable(doc, {
    ...estilos,
    startY: y,
    head: [['Mes', 'Ingresos', 'Egresos', 'Saldo final']],
    body: g.meses.map((b) => [nombreMes(b.periodo), dinero(b.totalIngresos), dinero(b.totalEgresos), dinero(b.saldoFinal)]),
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
  });
  y = finTabla() + 18;

  // Firmas
  if (y > H - 40) {
    doc.addPage();
    y = 40;
  }
  doc.setDrawColor(...GRIS).setLineWidth(0.3);
  doc.line(M + 10, y, M + 75, y);
  doc.line(W - M - 75, y, W - M - 10, y);
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...GRIS);
  doc.text('Elaboró: Administración SIIA', M + 42.5, y + 5, { align: 'center' });
  doc.text('Revisó: Mesa directiva', W - M - 42.5, y + 5, { align: 'center' });

  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINEA).setLineWidth(0.3).line(M, H - 17, W - M, H - 17);
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...GRIS);
    doc.text(
      'Ingresos: comprobantes aprobados por la administración, en el mes de su fecha de pago. Los fondos (multas, amenidades, ahorro…) y apartados se acumulan y no cuentan como disponible para el gasto.',
      M,
      H - 13.5,
      { maxWidth: W - 2 * M },
    );
    doc.text('SIIA · soluciones inmobiliarias · siia.casa', M, H - 6.5);
    if (o.generadoPor) doc.text(`Generado por ${o.generadoPor}`, W / 2, H - 6.5, { align: 'center' });
    doc.text(`Página ${i} de ${paginas}`, W - M, H - 6.5, { align: 'right' });
  }
  return doc;
}

export async function descargarBalanceGeneral(o: OpcionesBalanceGeneral) {
  const doc = await construirBalanceGeneral(o, await logo());
  doc.save(`Balance general ${o.condominio.replace(/[\\/:*?"<>|]+/g, '').trim()} enero a ${nombreMes(o.hasta)}.pdf`);
}
