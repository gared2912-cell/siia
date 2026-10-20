// Excel del corte de accesos (Panel › Residentes › Registro de activaciones). Tres hojas:
// - Para el técnico: solo los accesos por desactivar o por activar, con una columna para marcar que se hizo.
// - Morosos: casa, residente, cuotas vencidas, adeudo y sus accesos.
// - Histórico: cada acceso en este corte y los dos anteriores (los demás cortes quedan guardados en SIIA).
// ExcelJS se carga solo al usarlo.
import { ETIQUETA_CORTE, textoCriterio, type Corte, type EstadoCorte, type FilaCorte } from '../../../amplify/functions/shared/cortes';
import { C, PESOS, argb, estilo, firmarLibro, logoBase64 } from './reporteFinanzas';

type Hoja = import('exceljs').Worksheet;
const fechaLarga = (iso: string) => new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Mexico_City' });
const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Mexico_City' });
const COLOR: Record<EstadoCorte, { color: string; fill: string }> = {
  POR_DESACTIVAR: { color: C.rojo, fill: C.rojoClaro },
  DESACTIVADO: { color: C.texto, fill: 'ECEEF2' },
  POR_ACTIVAR: { color: C.verde, fill: C.verdeClaro },
  ACTIVO: { color: C.verde, fill: '' },
};

/** Logotipo, título, condominio y criterio; devuelve la fila de encabezados. */
async function cabecera(wb: import('exceljs').Workbook, ws: Hoja, cols: number, titulo: string, corte: Corte, condominio: string, nota: string) {
  const logo = await logoBase64();
  if (logo) ws.addImage(wb.addImage({ base64: logo, extension: 'png' }), { tl: { col: 0.1, row: 0.2 }, ext: { width: 150, height: 51 } });
  const ultima = Math.max(cols, 3);
  [1, 2, 3, 4].forEach((r) => {
    ws.getRow(r).height = 18;
    ws.mergeCells(r, 3, r, ultima);
  });
  ws.getCell(1, 3).value = titulo;
  estilo(ws.getCell(1, 3), { b: true, size: 15, color: C.tealOscuro, h: 'right' });
  ws.getCell(2, 3).value = `${condominio} · Corte #${corte.numero} · ${fechaLarga(corte.fecha)}`;
  estilo(ws.getCell(2, 3), { b: true, size: 11, h: 'right' });
  ws.getCell(3, 3).value = textoCriterio(corte.criterio);
  estilo(ws.getCell(3, 3), { size: 9, color: C.pizarra, h: 'right' });
  ws.getCell(4, 3).value = nota;
  estilo(ws.getCell(4, 3), { size: 9, italic: true, color: C.gris, h: 'right' });
  ws.getRow(5).height = 5;
  for (let c = 1; c <= ultima; c++) ws.getCell(5, c).fill = { type: 'pattern', pattern: 'solid', fgColor: argb(C.teal) };
  return 7;
}

function encabezados(ws: Hoja, r: number, textos: string[], derecha: number[] = []) {
  const fe = ws.getRow(r);
  fe.height = 28;
  textos.forEach((t, i) => {
    fe.getCell(i + 1).value = t;
    estilo(fe.getCell(i + 1), { b: true, color: C.blanco, fill: C.tealOscuro, h: derecha.includes(i) ? 'right' : 'left', wrap: true });
  });
}

function renglon(ws: Hoja, r: number, valores: (string | number | null)[], k: number, opts: { pesos?: number[]; derecha?: number[] } = {}) {
  const row = ws.getRow(r);
  const cebra = k % 2 ? C.cebra : undefined;
  valores.forEach((v, i) => {
    const cell = row.getCell(i + 1);
    cell.value = v;
    estilo(cell, { fill: cebra, b: i === 0, fmt: opts.pesos?.includes(i) ? PESOS : undefined, h: opts.derecha?.includes(i) ? 'right' : 'left', wrap: true });
    cell.border = { bottom: { style: 'thin', color: argb(C.linea) } };
  });
  return row;
}

function pintarEstado(cell: import('exceljs').Cell, e: EstadoCorte | null) {
  if (!e) return;
  const c = COLOR[e];
  estilo(cell, { b: e !== 'ACTIVO', color: c.color, fill: c.fill || undefined, h: 'center' });
}

const motivoDe = (f: FilaCorte) =>
  f.moroso
    ? `Moroso: ${f.cuotas} cuota(s)${f.extras ? ` y ${f.extras} cargo(s) extraordinario(s)` : ''} vencidos`
    : 'Ya pagó';
const textoEstado = (e: EstadoCorte, manual?: boolean) => (e === 'DESACTIVADO' && manual ? 'Desactivado (a mano)' : ETIQUETA_CORTE[e]);

export async function descargarExcelCorte(o: { condominio: string; corte: Corte; previos: Corte[]; generadoPor?: string }) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const { corte } = o;
  const filas = corte.filas ?? [];
  const vista = { state: 'frozen' as const, ySplit: 7, showGridLines: false };
  const pagina = { orientation: 'landscape' as const, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '7:7' };

  // ---------- Para el técnico ----------
  const tec = wb.addWorksheet('Para el técnico', { views: [vista], properties: { tabColor: argb(C.rojo) }, pageSetup: pagina });
  tec.columns = [{ width: 18 }, { width: 28 }, { width: 30 }, { width: 18 }, { width: 24 }, { width: 34 }, { width: 12 }];
  let r = await cabecera(wb, tec, 7, 'CORTE DE ACCESOS · TÉCNICO', corte, o.condominio, 'Desactiva o activa cada acceso y marca la columna «Hecho». En el siguiente corte SIIA lo da por aplicado.');
  encabezados(tec, r, ['Casa o departamento', 'Residente', 'Acceso', 'Código', 'Acción', 'Motivo', 'Hecho']);
  const tareas = filas.flatMap((f) => f.accesos.filter((a) => a.estado === 'POR_DESACTIVAR' || a.estado === 'POR_ACTIVAR').map((a) => ({ f, a })));
  tareas.sort((x, y) => (x.a.estado === y.a.estado ? 0 : x.a.estado === 'POR_DESACTIVAR' ? -1 : 1));
  tareas.forEach(({ f, a }, k) => {
    const row = renglon(tec, ++r, [f.unidad, f.residente, a.tipo, a.codigo, a.estado === 'POR_DESACTIVAR' ? 'POR DESACTIVAR' : 'POR ACTIVAR', motivoDe(f), '☐'], k);
    pintarEstado(row.getCell(5), a.estado);
    estilo(row.getCell(7), { h: 'center', size: 13 });
  });
  if (!tareas.length) {
    tec.mergeCells(++r, 1, r, 7);
    tec.getCell(r, 1).value = 'Sin accesos por desactivar ni por activar en este corte.';
    estilo(tec.getCell(r, 1), { italic: true, color: C.gris });
  }

  // ---------- Morosos ----------
  const mor = wb.addWorksheet('Morosos', { views: [vista], properties: { tabColor: argb(C.tealOscuro) }, pageSetup: pagina });
  const conExtras = corte.criterio.extraordinarios;
  mor.columns = [{ width: 18 }, { width: 28 }, { width: 12 }, ...(conExtras ? [{ width: 14 }] : []), { width: 15 }, { width: 60 }];
  const nMor = conExtras ? 6 : 5;
  r = await cabecera(wb, mor, nMor, 'MOROSOS', corte, o.condominio, 'Adeudo vencido a la fecha del corte (incluye recargos por pago tardío).');
  encabezados(mor, r, ['Casa o departamento', 'Residente', 'Cuotas vencidas', ...(conExtras ? ['Cargos extraord. vencidos'] : []), 'Adeudo vencido', 'Accesos'], conExtras ? [2, 3, 4] : [2, 3]);
  const morosos = filas.filter((f) => f.moroso);
  morosos.forEach((f, k) => {
    const accesos = f.accesos.map((a) => `${a.tipo} ${a.codigo}: ${textoEstado(a.estado, a.manual)}`).join('\n') || 'Sin accesos registrados';
    const vals = [f.unidad, f.residente, f.cuotas, ...(conExtras ? [f.extras] : []), f.monto, accesos];
    const row = renglon(mor, ++r, vals, k, { pesos: [nMor - 2], derecha: conExtras ? [2, 3, 4] : [2, 3] });
    estilo(row.getCell(nMor - 1), { b: true, color: C.rojo, fmt: PESOS, h: 'right', fill: k % 2 ? C.cebra : undefined });
    row.height = Math.max(18, f.accesos.length * 14);
  });
  const unidadesMorosas = new Set(morosos.map((f) => f.unidadId)).size;
  r += 2;
  mor.getCell(r, 1).value = `${unidadesMorosas} casa(s) o departamento(s) morosos`;
  estilo(mor.getCell(r, 1), { b: true, color: C.tealOscuro });
  mor.getCell(r, nMor - 1).value = corte.resumen.monto;
  estilo(mor.getCell(r, nMor - 1), { b: true, color: C.rojo, fmt: PESOS, h: 'right' });

  // ---------- Histórico (este corte y los dos anteriores) ----------
  const cortes = [...o.previos.slice(0, 2)].reverse().concat(corte);
  const his = wb.addWorksheet('Histórico', { views: [vista], properties: { tabColor: argb(C.gris) }, pageSetup: pagina });
  const nHis = 4 + cortes.length;
  his.columns = [{ width: 18 }, { width: 28 }, { width: 30 }, { width: 16 }, ...cortes.map(() => ({ width: 22 }))];
  r = await cabecera(wb, his, nHis, 'HISTÓRICO DE ACTIVACIONES', corte, o.condominio, 'Este corte y los dos anteriores. Lo que no aparece en un corte estaba activo.');
  encabezados(his, r, ['Casa o departamento', 'Residente', 'Acceso', 'Código', ...cortes.map((c) => `Corte #${c.numero}\n${fechaCorta(c.fecha)}`)]);
  // Un renglón por acceso que tuvo algo distinto de «Activo» en alguno de los tres cortes.
  const accesos = new Map<string, { f: FilaCorte; tipo: string; codigo: string }>();
  for (const c of cortes)
    for (const f of c.filas ?? []) for (const a of f.accesos) if (a.estado !== 'ACTIVO' || accesos.has(a.id)) accesos.set(a.id, { f, tipo: a.tipo, codigo: a.codigo });
  const lista = [...accesos.entries()].sort(([, x], [, y]) => x.f.unidad.localeCompare(y.f.unidad, 'es', { numeric: true }));
  lista.forEach(([id, x], k) => {
    const estados = cortes.map((c) => {
      for (const f of c.filas ?? []) {
        const a = f.accesos.find((y) => y.id === id);
        if (a) return a;
      }
      return null;
    });
    const row = renglon(his, ++r, [x.f.unidad, x.f.residente, x.tipo, x.codigo, ...estados.map((a) => (a ? textoEstado(a.estado, a.manual) : 'Activo'))], k);
    estados.forEach((a, i) => pintarEstado(row.getCell(5 + i), a?.estado ?? 'ACTIVO'));
  });
  if (!lista.length) {
    his.mergeCells(++r, 1, r, nHis);
    his.getCell(r, 1).value = 'Todos los accesos han estado activos en estos cortes.';
    estilo(his.getCell(r, 1), { italic: true, color: C.gris });
  }

  firmarLibro(wb, o.generadoPor);
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `Corte de accesos ${corte.numero} ${o.condominio.replace(/[\\/:*?"<>|]+/g, '').trim()} ${corte.fecha.slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
