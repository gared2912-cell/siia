// Machote de Excel para el alta masiva de residentes: el mismo formato sirve para cualquier condominio.
// Desde un condominio se descarga ya lleno con sus casas o departamentos y residentes actuales, para
// modificarlo o agregar filas y volver a subirlo. SheetJS se carga solo al descargar o leer el archivo.

export type FilaMachote = { linea: number; numero: string; nombre: string; telefono: string; correo: string; fechaEntrega: string };

const COLUMNAS = ['Número de casa o departamento', 'Nombre del residente', 'Teléfono de contacto', 'Correo electrónico', 'Fecha de entrega'];

/** Fila del machote ya lleno: número, nombre, teléfono, correo y fecha de entrega (aaaa-mm-dd). */
export type FilaActual = [string, string, string, string, string];

export async function descargarMachote(actual?: { condominio: string; filas: FilaActual[] }) {
  const XLSX = await import('xlsx');
  const filas = (actual?.filas ?? []).map(([n, nombre, tel, correo, f]) => {
    const [a, m, d] = f.split('-').map(Number);
    return [n, nombre, tel, correo, f ? new Date(a, m - 1, d) : ''];
  });
  const hoja = XLSX.utils.aoa_to_sheet([COLUMNAS, ...filas], { cellDates: true, dateNF: 'dd/mm/yyyy' });
  hoja['!cols'] = [{ wch: 30 }, { wch: 34 }, { wch: 22 }, { wch: 34 }, { wch: 18 }];
  // Celdas de texto en número y teléfono (evita que Excel convierta «A-101» o quite ceros) y fecha dd/mm/aaaa.
  const ultima = filas.length + 1000;
  for (let r = filas.length + 1; r <= ultima; r++) {
    for (const c of [0, 2]) hoja[XLSX.utils.encode_cell({ r, c })] = { t: 's', v: '', z: '@' };
    hoja[XLSX.utils.encode_cell({ r, c: 4 })] = { t: 'z', z: 'dd/mm/yyyy' };
  }
  hoja['!ref'] = `A1:E${ultima + 1}`;

  const instrucciones = XLSX.utils.aoa_to_sheet([
    ['Alta masiva de residentes · SIIA'],
    [],
    ['1. Llena la hoja «Residentes»: una sola fila por cada casa o departamento.'],
    ['   Si lo descargaste desde un condominio, ya trae sus casas o departamentos y residentes actuales: modifica lo que necesites y agrega filas nuevas.'],
    ['2. Número: como se identifica la unidad, por ejemplo 12, A-101 o Torre B 302. El portal le antepone «Casa» o «Depto» según el condominio.'],
    ['3. Si la fila trae correo, el residente recibe por correo su usuario y una contraseña temporal para entrar al portal.'],
    ['4. Si la fila no trae correo, solo se da de alta la casa o departamento (el residente se puede agregar después).'],
    ['5. Si el número ya existe, no se duplica: se guardan los cambios (nombre, teléfono, correo, fecha de entrega). Las celdas vacías no borran datos.'],
    ['   Si cambias el correo de un residente, ese correo pasa a ser su usuario y le enviamos accesos nuevos.'],
    ['   Si un número aparece en más de una fila, esas filas no se toman en cuenta y esa casa o departamento no cambia.'],
    ['6. Fecha de entrega con formato día/mes/año (por ejemplo 15/03/2026). Es opcional.'],
    ['7. Guarda el archivo y súbelo en Administración › Condominios › Residentes › Alta masiva.'],
    [],
    ['Ejemplo (no lo copies a la hoja «Residentes»):'],
    COLUMNAS,
    ['A-101', 'Ana López Ruiz', '442 123 4567', 'ana.lopez@ejemplo.com', '15/03/2026'],
    ['A-102', 'Juan Pérez Soto', '442 765 4321', 'juan.perez@ejemplo.com', '01/04/2026'],
    ['A-103', '', '', '', '01/04/2026'],
  ]);
  instrucciones['!cols'] = [{ wch: 30 }, { wch: 34 }, { wch: 22 }, { wch: 34 }, { wch: 18 }];

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Residentes');
  XLSX.utils.book_append_sheet(libro, instrucciones, 'Instrucciones');
  const limpio = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '').trim();
  XLSX.writeFile(libro, actual ? `Residentes ${limpio(actual.condominio)} SIIA.xlsx` : 'Machote alta de residentes SIIA.xlsx');
}

const sinAcentos = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** dd/mm/aaaa, aaaa-mm-dd o fecha de Excel → aaaa-mm-dd ('' si no se reconoce). */
function fechaISO(v: unknown): string {
  if (v instanceof Date && !isNaN(+v)) {
    // SheetJS entrega la fecha a medianoche local; se toman los componentes locales.
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const anio = m[3].length === 2 ? `20${m[3]}` : m[3];
    const d = new Date(Number(anio), Number(m[2]) - 1, Number(m[1]));
    if (d.getMonth() === Number(m[2]) - 1) return `${anio}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return '';
}

/** Lee el machote (xlsx, xls o csv). Detecta las columnas por su encabezado; si no lo encuentra, usa el orden del machote. */
export async function leerMachote(file: File): Promise<{ filas: FilaMachote[]; fechasInvalidas: number[] }> {
  if (file.size > 5 * 1024 * 1024) throw new Error('El archivo supera 5 MB.');
  const XLSX = await import('xlsx');
  const libro = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const nombreHoja = libro.SheetNames.find((n) => sinAcentos(n) === 'residentes') ?? libro.SheetNames[0];
  const datos = XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets[nombreHoja], { header: 1, raw: true, defval: '' });

  const iEnc = datos.findIndex((r) => r.some((c) => /numero|casa|depto|departamento/.test(sinAcentos(String(c)))));
  const enc = iEnc >= 0 ? datos[iEnc].map((c) => sinAcentos(String(c))) : [];
  const col = (re: RegExp, porDefecto: number) => {
    const i = enc.findIndex((c) => re.test(c));
    return i >= 0 ? i : porDefecto;
  };
  const cNumero = col(/numero|casa|depto|departamento|unidad/, 0);
  const cNombre = col(/nombre|residente/, 1);
  const cTel = col(/tel|celular|movil/, 2);
  const cCorreo = col(/correo|mail/, 3);
  const cFecha = col(/fecha|entrega/, 4);

  const filas: FilaMachote[] = [];
  const fechasInvalidas: number[] = [];
  datos.forEach((r, i) => {
    if (i <= iEnc) return;
    const txt = (c: number) =>
      String(r[c] ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    const fila: FilaMachote = {
      linea: i + 1,
      numero: txt(cNumero),
      nombre: txt(cNombre),
      telefono: txt(cTel),
      correo: txt(cCorreo).toLowerCase(),
      fechaEntrega: fechaISO(r[cFecha]),
    };
    if (!fila.numero && !fila.nombre && !fila.correo) return;
    if (txt(cFecha) && !fila.fechaEntrega) fechasInvalidas.push(fila.linea);
    filas.push(fila);
  });
  return { filas, fechasInvalidas };
}

// ---------- Reporte de una encuesta cerrada ----------
export type ReporteEncuesta = {
  condominio: string;
  pregunta: string;
  descripcion?: string | null;
  cierra?: string | null;
  opciones: string[];
  unidades: { id: string; etiqueta: string }[];
  votos: { unidadId: string; opcion: string; createdAt: string; nombre?: string | null; email?: string | null }[];
};

/** Excel con el resultado (ganador y votos por opción), quién votó y por qué opción, y qué unidades no votaron. */
export async function descargarReporteEncuesta(r: ReporteEncuesta) {
  const XLSX = await import('xlsx');
  const total = r.votos.length;
  const conteo = r.opciones.map((o) => ({ o, n: r.votos.filter((v) => v.opcion === o).length })).sort((a, b) => b.n - a.n);
  const max = conteo[0]?.n ?? 0;
  const ganadoras = conteo.filter((c) => c.n === max && max > 0);
  const segundo = conteo.find((c) => c.n < max)?.n ?? 0;
  const pct = (n: number) => (total ? n / total : 0);
  const etiqueta = (id: string) => r.unidades.find((u) => u.id === id)?.etiqueta ?? '—';

  const resultado =
    !ganadoras.length
      ? 'Sin votos'
      : ganadoras.length > 1
        ? `Empate entre ${ganadoras.map((g) => `«${g.o}»`).join(' y ')} con ${max} votos cada una`
        : `«${ganadoras[0].o}» con ${max} de ${total} votos (${Math.round(pct(max) * 100)}%)` +
          (conteo.length > 1 ? `, ganó por ${max - segundo} voto${max - segundo === 1 ? '' : 's'} de diferencia` : '');

  const hojaRes = XLSX.utils.aoa_to_sheet([
    ['Resultado de la encuesta · SIIA'],
    [],
    ['Condominio', r.condominio],
    ['Pregunta', r.pregunta],
    ...(r.descripcion ? [['Descripción', r.descripcion]] : []),
    ...(r.cierra ? [['Fecha de cierre', r.cierra]] : []),
    ['Participación', `${total} de ${r.unidades.length} unidades`],
    ['Ganador', resultado],
    [],
    ['Opción', 'Votos', 'Porcentaje'],
    ...conteo.map((c) => [c.o, c.n, pct(c.n)]),
    ['Total', total, total ? 1 : 0],
  ]);
  const inicio = (r.descripcion ? 1 : 0) + (r.cierra ? 1 : 0) + 8;
  for (let k = 0; k <= conteo.length; k++) {
    const celda = hojaRes[XLSX.utils.encode_cell({ r: inicio + k, c: 2 })];
    if (celda) celda.z = '0%';
  }
  hojaRes['!cols'] = [{ wch: 34 }, { wch: 60 }, { wch: 12 }];

  const votos = [...r.votos].sort((a, b) => etiqueta(a.unidadId).localeCompare(etiqueta(b.unidadId), 'es', { numeric: true }));
  const hojaVotos = XLSX.utils.aoa_to_sheet(
    [
      ['Casa o departamento', 'Votó', 'Correo', 'Votó por', 'Fecha y hora'],
      ...votos.map((v) => [etiqueta(v.unidadId), v.nombre ?? '', v.email ?? '', v.opcion, new Date(v.createdAt)]),
    ],
    { cellDates: true, dateNF: 'dd/mm/yyyy hh:mm' },
  );
  hojaVotos['!cols'] = [{ wch: 22 }, { wch: 32 }, { wch: 32 }, { wch: 34 }, { wch: 18 }];

  const votaron = new Set(r.votos.map((v) => v.unidadId));
  const sinVoto = r.unidades.filter((u) => !votaron.has(u.id)).sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es', { numeric: true }));
  const hojaSin = XLSX.utils.aoa_to_sheet([['Casa o departamento sin votar'], ...sinVoto.map((u) => [u.etiqueta])]);
  hojaSin['!cols'] = [{ wch: 30 }];

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hojaRes, 'Resultado');
  XLSX.utils.book_append_sheet(libro, hojaVotos, 'Votos');
  XLSX.utils.book_append_sheet(libro, hojaSin, 'Sin votar');
  const limpio = (s: string) => s.replace(/[\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  XLSX.writeFile(libro, `Encuesta ${limpio(r.pregunta)} ${limpio(r.condominio)}.xlsx`);
}
