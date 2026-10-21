// Excel de Cotizaciones (Panel › Cotizaciones › Descargar Excel): todas las solicitudes del sitio web, de la más
// reciente a la más antigua, con quién y cuándo se respondió cada una. ExcelJS se carga solo al usarlo.
import type { Cotizacion } from './Cotizaciones';
import { ORIGEN, fechaCompleta } from './Cotizaciones';
import { C, argb, estilo, firmarLibro, logoBase64 } from './reporteFinanzas';

const COLUMNAS: [string, number, (c: Cotizacion) => string | number | null][] = [
  ['Recibida', 22, (c) => fechaCompleta(c.createdAt)],
  ['Origen', 12, (c) => ORIGEN[c.origen]],
  ['Estado', 13, (c) => (c.estado === 'PENDIENTE' ? 'Pendiente' : 'Respondida')],
  ['Nombre', 26, (c) => c.nombre],
  ['Soy…', 20, (c) => c.rol ?? null],
  ['Teléfono / WhatsApp', 18, (c) => c.telefono ?? null],
  ['Correo', 28, (c) => c.correo ?? null],
  ['Tipo de desarrollo', 20, (c) => c.tipoDesarrollo ?? null],
  ['Casas o deptos.', 11, (c) => c.unidades ?? null],
  ['Condominio / fraccionamiento / empresa', 28, (c) => c.desarrollo ?? null],
  ['Municipio / ciudad', 18, (c) => c.ubicacion ?? null],
  ['¿Cuentan con administración?', 16, (c) => c.administracionActual ?? null],
  ['Servicios de interés', 34, (c) => c.servicios?.filter(Boolean).join(', ') || null],
  ['Motivo', 22, (c) => c.motivo ?? null],
  ['Mensaje / comentarios', 46, (c) => c.mensaje ?? null],
  ['Respondida por', 22, (c) => c.respondidaPor?.nombre ?? null],
  ['Fecha de respuesta', 22, (c) => (c.respondidaEn ? fechaCompleta(c.respondidaEn) : null)],
  ['Nota de seguimiento', 36, (c) => c.notaRespuesta ?? null],
];

export async function descargarExcelCotizaciones(lista: Cotizacion[], generadoPor?: string) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Cotizaciones', {
    views: [{ state: 'frozen', ySplit: 7, xSplit: 4, showGridLines: false }],
    properties: { tabColor: argb(C.tealOscuro) },
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '7:7' },
  });
  ws.columns = COLUMNAS.map(([, width]) => ({ width }));
  const n = COLUMNAS.length;

  // Cabecera: logotipo, título y resumen
  const logo = await logoBase64();
  if (logo) ws.addImage(wb.addImage({ base64: logo, extension: 'png' }), { tl: { col: 0.1, row: 0.2 }, ext: { width: 150, height: 51 } });
  const pendientes = lista.filter((c) => c.estado === 'PENDIENTE').length;
  [1, 2, 3, 4].forEach((r) => {
    ws.getRow(r).height = 18;
    ws.mergeCells(r, 4, r, 9);
  });
  ws.getCell(1, 4).value = 'SOLICITUDES DEL SITIO WEB';
  estilo(ws.getCell(1, 4), { b: true, size: 15, color: C.tealOscuro });
  ws.getCell(2, 4).value = 'Cotizaciones y mensajes de contacto';
  estilo(ws.getCell(2, 4), { b: true, size: 11 });
  ws.getCell(3, 4).value = `${lista.length} solicitud(es) · ${pendientes} pendiente(s) · ${lista.length - pendientes} respondida(s)`;
  estilo(ws.getCell(3, 4), { size: 9, color: C.pizarra });
  ws.getCell(4, 4).value = `Corte al ${fechaCompleta(new Date().toISOString())}`;
  estilo(ws.getCell(4, 4), { size: 9, italic: true, color: C.gris });
  ws.getRow(5).height = 5;
  for (let c = 1; c <= n; c++) ws.getCell(5, c).fill = { type: 'pattern', pattern: 'solid', fgColor: argb(C.teal) };

  // Encabezados
  const fe = ws.getRow(7);
  fe.height = 30;
  COLUMNAS.forEach(([t], i) => {
    fe.getCell(i + 1).value = t;
    estilo(fe.getCell(i + 1), { b: true, color: C.blanco, fill: C.tealOscuro, wrap: true });
  });
  ws.autoFilter = { from: { row: 7, column: 1 }, to: { row: 7, column: n } };

  // Renglones
  lista.forEach((c, k) => {
    const row = ws.getRow(8 + k);
    const cebra = k % 2 ? C.cebra : undefined;
    COLUMNAS.forEach(([, , valor], i) => {
      const cell = row.getCell(i + 1);
      cell.value = valor(c);
      estilo(cell, { fill: cebra, b: i === 3, wrap: true, h: i === 8 ? 'right' : 'left' });
      cell.alignment = { ...cell.alignment, vertical: 'top' };
      cell.border = { bottom: { style: 'thin', color: argb(C.linea) } };
    });
    const estado = row.getCell(3);
    estilo(estado, c.estado === 'PENDIENTE' ? { b: true, color: C.ambar, fill: C.ambarClaro } : { b: true, color: C.verde, fill: C.verdeClaro });
  });
  if (!lista.length) {
    ws.mergeCells(8, 1, 8, n);
    ws.getCell(8, 1).value = 'Aún no hay solicitudes.';
    estilo(ws.getCell(8, 1), { italic: true, color: C.gris });
  }

  firmarLibro(wb, generadoPor);
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `Cotizaciones SIIA ${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
