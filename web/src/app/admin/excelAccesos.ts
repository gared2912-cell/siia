// Excel de control de accesos (Panel › Residentes): una fila por residente con su casa, estado de pago y cada
// acceso (llavero, tarjeta, control…) con un desplegable Activado / Suspendido. Se descarga, se marca a los
// morosos como «Suspendido» y se vuelve a importar para actualizar la lista. ExcelJS se carga solo al usarlo.
import type { Schema } from '../api';
import { MAX_ACCESOS, accesosDe, claveCodigo, estadoDeAcceso, type EstadoAcceso } from '../../../amplify/functions/shared/accesos';
import { C, FUENTE, PESOS, argb, estilo, logoBase64 } from './reporteFinanzas';

type Perfil = Schema['Perfil']['type'];
type Unidad = Schema['Unidad']['type'];

const HOJA = 'Control de accesos';
const COL_ID = 'ID residente (no modificar)';
const ACTIVADO = 'Activado';
const SUSPENDIDO = 'Suspendido';
// Columnas: A casa · B residente · C estado de pago · D saldo vencido · (acceso, estado) × 6 · ID oculto
const PRIMERA_ACCESO = 5;
const COL_ID_N = PRIMERA_ACCESO + MAX_ACCESOS * 2;
const FILA_ENC = 6;

export type FilaAccesos = { u: Unidad; p?: Perfil; vencido: number | null };
const textoAcceso = (tipo: string, codigo: string) => `${tipo} · ${codigo}`;

export async function descargarExcelAccesos(o: { condominio: string; hoy: string; filas: FilaAccesos[]; generadoPor?: string }) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  // Este archivo se vuelve a importar: la firma va solo en las propiedades del archivo, no como fila.
  wb.creator = o.generadoPor ? `${o.generadoPor} · SIIA` : 'SIIA · soluciones inmobiliarias';
  const ws = wb.addWorksheet(HOJA, {
    views: [{ state: 'frozen', ySplit: FILA_ENC, xSplit: 2, showGridLines: false }],
    properties: { tabColor: argb(C.tealOscuro) },
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${FILA_ENC}:${FILA_ENC}` },
  });
  ws.columns = [
    { width: 18 },
    { width: 28 },
    { width: 16 },
    { width: 14 },
    ...Array.from({ length: MAX_ACCESOS }, () => [{ width: 30 }, { width: 13 }]).flat(),
    { width: 38, hidden: true },
  ];
  const ultima = COL_ID_N - 1;

  // Encabezado con logotipo e instrucciones
  const logo = await logoBase64();
  if (logo) ws.addImage(wb.addImage({ base64: logo, extension: 'png' }), { tl: { col: 0.1, row: 0.2 }, ext: { width: 150, height: 51 } });
  [1, 2, 3].forEach((r) => (ws.getRow(r).height = 20));
  ws.mergeCells(1, 4, 1, ultima);
  ws.mergeCells(2, 4, 2, ultima);
  ws.mergeCells(3, 4, 3, ultima);
  ws.getCell(1, 4).value = 'CONTROL DE ACCESOS';
  estilo(ws.getCell(1, 4), { b: true, size: 15, color: C.tealOscuro, h: 'right' });
  ws.getCell(2, 4).value = `${o.condominio} · ${new Date(`${o.hoy}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}`;
  estilo(ws.getCell(2, 4), { b: true, size: 11, h: 'right' });
  ws.getCell(3, 4).value = 'Cambia el estado de cada acceso con el desplegable (Activado / Suspendido) y vuelve a importar este archivo en SIIA.';
  estilo(ws.getCell(3, 4), { size: 9, italic: true, color: C.gris, h: 'right' });
  ws.getRow(4).height = 5;
  for (let c = 1; c <= ultima; c++) ws.getCell(4, c).fill = { type: 'pattern', pattern: 'solid', fgColor: argb(C.teal) };

  // Encabezados de la tabla
  const enc = ['Casa o departamento', 'Residente', 'Estado de pago', 'Saldo vencido', ...Array.from({ length: MAX_ACCESOS }, (_, i) => [`Acceso ${i + 1}`, `Estado ${i + 1}`]).flat(), COL_ID];
  const fe = ws.getRow(FILA_ENC);
  fe.height = 28;
  enc.forEach((t, i) => {
    const cell = fe.getCell(i + 1);
    cell.value = t;
    const esEstado = i >= PRIMERA_ACCESO - 1 && (i - (PRIMERA_ACCESO - 1)) % 2 === 1;
    estilo(cell, { b: true, color: C.blanco, fill: esEstado ? C.teal : C.tealOscuro, h: i === 3 ? 'right' : esEstado ? 'center' : 'left', wrap: true });
  });

  o.filas.forEach((f, k) => {
    const r = FILA_ENC + 1 + k;
    const row = ws.getRow(r);
    const cebra = k % 2 ? C.cebra : undefined;
    const pago = f.vencido === null ? '—' : f.vencido > 0 ? 'Saldo pendiente' : 'Al corriente';
    const valores: (string | number | null)[] = [f.u.etiqueta, f.p ? f.p.nombre || f.p.email : 'Sin residente', pago, f.vencido || null];
    valores.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v;
      estilo(cell, { fill: cebra, h: i === 3 ? 'right' : 'left', fmt: i === 3 ? PESOS : undefined, b: i === 0 });
    });
    const cp = row.getCell(3);
    if (pago === 'Saldo pendiente') estilo(cp, { b: true, color: C.rojo, fill: C.rojoClaro });
    else if (pago === 'Al corriente') estilo(cp, { b: true, color: C.verde, fill: C.verdeClaro });
    if (f.vencido) row.getCell(4).font = { name: FUENTE, size: 10, bold: true, color: argb(C.rojo) };
    const accesos = f.p ? accesosDe(f.p.accesos) : [];
    for (let i = 0; i < MAX_ACCESOS; i++) {
      const a = accesos[i];
      const ca = row.getCell(PRIMERA_ACCESO + i * 2);
      const ce = row.getCell(PRIMERA_ACCESO + i * 2 + 1);
      estilo(ca, { fill: cebra, size: 9.5 });
      estilo(ce, { fill: cebra, h: 'center' });
      if (!a) continue;
      ca.value = textoAcceso(a.tipo, a.codigo);
      ce.value = estadoDeAcceso(a) === 'SUSPENDIDO' ? SUSPENDIDO : ACTIVADO;
      ce.dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: [`"${ACTIVADO},${SUSPENDIDO}"`],
        showErrorMessage: true,
        errorTitle: 'Estado no válido',
        error: 'Elige Activado o Suspendido.',
      };
      estilo(ce, { b: true, h: 'center', fill: cebra });
    }
    row.getCell(COL_ID_N).value = f.p?.userId ?? '';
    for (let c = 1; c <= ultima; c++) row.getCell(c).border = { bottom: { style: 'thin', color: argb(C.linea) } };
  });

  // Color automático del estado (también al cambiarlo en Excel)
  const ini = FILA_ENC + 1;
  const fin = FILA_ENC + Math.max(o.filas.length, 1);
  for (let i = 0; i < MAX_ACCESOS; i++) {
    const col = ws.getColumn(PRIMERA_ACCESO + i * 2 + 1).letter;
    ws.addConditionalFormatting({
      ref: `${col}${ini}:${col}${fin}`,
      rules: [
        { type: 'containsText', operator: 'containsText', text: SUSPENDIDO, priority: 1, style: { font: { color: argb(C.rojo), bold: true }, fill: { type: 'pattern', pattern: 'solid', bgColor: argb(C.rojoClaro) } } },
        { type: 'containsText', operator: 'containsText', text: ACTIVADO, priority: 2, style: { font: { color: argb(C.verde), bold: true }, fill: { type: 'pattern', pattern: 'solid', bgColor: argb(C.verdeClaro) } } },
      ],
    });
  }
  ws.autoFilter = { from: { row: FILA_ENC, column: 1 }, to: { row: fin, column: ultima } };

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `Control de accesos ${o.condominio.replace(/[\\/:*?"<>|]+/g, '').trim()} ${o.hoy}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export type CambioAcceso = { userId: string; accesoId: string; estado: EstadoAcceso; unidad: string; residente: string; acceso: string; antes: EstadoAcceso };

const sinAcentos = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

/** Lee el Excel y devuelve los accesos cuyo estado cambió (y avisos de lo que no se reconoció). */
export async function leerExcelAccesos(file: File, perfiles: Perfil[], etiqueta: (unidadId?: string | null) => string) {
  if (file.size > 5 * 1024 * 1024) throw new Error('El archivo supera 5 MB.');
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new Error('No se pudo leer el archivo. Usa el Excel descargado de «Control de accesos» (formato .xlsx).');
  }
  const ws = wb.getWorksheet(HOJA) ?? wb.worksheets[0];
  if (!ws) throw new Error('El archivo no tiene hojas.');
  // Fila de encabezados: la que tiene la columna del ID
  let filaEnc = 0;
  let colId = 0;
  ws.eachRow((row, r) => {
    if (filaEnc) return;
    row.eachCell((cell, c) => {
      if (sinAcentos(String(cell.value ?? '')).startsWith('id residente')) {
        filaEnc = r;
        colId = c;
      }
    });
  });
  if (!filaEnc) throw new Error('Este no parece el Excel de control de accesos: falta la columna «ID residente». Descárgalo de nuevo desde SIIA.');

  const enc = ws.getRow(filaEnc);
  const pares: { acceso: number; estado: number }[] = [];
  enc.eachCell((cell, c) => {
    const t = sinAcentos(String(cell.value ?? ''));
    if (/^acceso \d+$/.test(t)) pares.push({ acceso: c, estado: c + 1 });
  });

  const porId = new Map(perfiles.map((p) => [p.userId, p]));
  const cambios: CambioAcceso[] = [];
  const avisos: string[] = [];
  const texto = (v: unknown) => {
    if (v && typeof v === 'object' && 'richText' in (v as object)) return (v as { richText: { text: string }[] }).richText.map((x) => x.text).join('');
    if (v && typeof v === 'object' && 'result' in (v as object)) return String((v as { result: unknown }).result ?? '');
    return String(v ?? '');
  };
  for (let r = filaEnc + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const userId = texto(row.getCell(colId).value).trim();
    if (!userId) continue;
    const p = porId.get(userId);
    if (!p) {
      avisos.push(`Fila ${r}: residente no encontrado en este condominio.`);
      continue;
    }
    const accesos = accesosDe(p.accesos);
    for (const par of pares) {
      const t = texto(row.getCell(par.acceso).value).trim();
      const e = sinAcentos(texto(row.getCell(par.estado).value));
      if (!t) continue;
      const i = t.lastIndexOf(' · ');
      const tipo = i > 0 ? t.slice(0, i) : '';
      const codigo = i > 0 ? t.slice(i + 3) : t;
      const a = accesos.find((x) => claveCodigo(x.tipo, x.codigo) === claveCodigo(tipo || x.tipo, codigo));
      if (!a) {
        avisos.push(`Fila ${r}: «${t}» no es un acceso registrado de ${p.nombre || p.email}; se ignoró.`);
        continue;
      }
      const nuevo: EstadoAcceso | null = e.startsWith('susp') ? 'SUSPENDIDO' : e.startsWith('activ') ? 'ACTIVO' : null;
      if (!nuevo) {
        avisos.push(`Fila ${r}: el estado de «${t}» debe ser Activado o Suspendido; se ignoró.`);
        continue;
      }
      if (nuevo !== estadoDeAcceso(a))
        cambios.push({ userId, accesoId: a.id, estado: nuevo, antes: estadoDeAcceso(a), unidad: etiqueta(p.unidadId), residente: p.nombre || p.email, acceso: textoAcceso(a.tipo, a.codigo) });
    }
  }
  return { cambios, avisos };
}
