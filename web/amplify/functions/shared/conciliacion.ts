// Match automático: cruza los comprobantes «Por aprobar» con el estado de cuenta del banco (Excel que sube la
// administración). Sin dependencias de AWS: lo usan admin-api (que decide y aprueba) y scripts de prueba.
//
// Reglas (finanzas: ante la duda, NO se aprueba solo):
// - El monto debe ser exacto (al centavo). Un depósito solo puede aprobar un comprobante, y un depósito ya usado en
//   otra carga (misma clave de rastreo / recibo) no se vuelve a usar.
// - Evidencia de que es de esa casa o departamento: la clave de rastreo o el recibo escritos en el comprobante, el
//   número de la unidad en el concepto del depósito o el nombre de quien transfirió (≥ 2 palabras del residente).
// - «Coincide» (se propone aprobar): evidencia + monto exacto + fecha a ≤ 3 días + el pago cubre justo sus cargos +
//   sin señales de duplicado. Cualquier duda pasa a «Revisar» (no se marca sola) con el motivo.
// - Por cargo: si un comprobante cubre varios cargos (p. ej. cuota de noviembre $450 + proporcional de octubre $120)
//   y no hay un depósito por el total, se buscan depósitos de esa unidad por cada cargo (o grupo de cargos) por
//   separado. Cada depósito encontrado se aprueba aparte con su propio recibo; lo que no aparezca sigue por aprobar.
import { favorAUsar, r2, repartirPago } from './pagos';

export type Movimiento = {
  id: string; // clave de rastreo, «R:<recibo>» o huella de la fila
  fila: number; // fila del Excel (1 = primera)
  fecha: string; // AAAA-MM-DD
  hora: string;
  monto: number; // abono
  recibo: string;
  descripcion: string;
  ordenante: string;
  banco: string;
  cuenta: string; // últimos 4 dígitos de la cuenta que transfirió
  referencia: string;
  rastreo: string;
  concepto: string;
};

export type LecturaEstadoCuenta = {
  movimientos: Movimiento[];
  cargos: number; // salidas (comisiones, retiros): no se usan
  ignoradas: number; // filas sin fecha o sin monto
  desde: string;
  hasta: string;
};

export type PagoC = {
  id: string;
  unidadId: string;
  monto: number;
  fecha?: string | null;
  createdAt?: string | null;
  referencia?: string | null;
  estado?: string | null;
  folio?: string | null;
  cargoIds?: (string | null)[] | null;
  usarSaldoFavor?: boolean | null;
  conciliacion?: unknown;
  comprobanteRepetido?: unknown;
};
type UnidadC = { id: string; etiqueta: string; propietario?: string | null; saldoFavor?: number | null };
type PerfilC = { unidadId?: string | null; nombre?: string | null; rol?: string | null };
type CargoC = { id: string; unidadId: string; monto: number; concepto: string; estado?: string | null; vence?: string | null };

export type Nivel = 'COINCIDE' | 'REVISAR';
export type Coincidencia = {
  clave: string; // lo que se selecciona y aprueba: el id del pago, o «pagoId|movId» si es un cargo por separado
  pagoId: string;
  /** Solo si se aprueba por separado: los cargos del comprobante que cubre este depósito. */
  cargoIds?: string[];
  /** Solo si se aprueba por separado: el monto total que declaró el residente en el comprobante. */
  montoComprobante?: number;
  movId: string;
  nivel: Nivel;
  unidadId: string;
  etiqueta: string;
  monto: number;
  fechaPago: string;
  mov: Movimiento;
  razones: string[]; // por qué es de esa unidad
  alertas: string[]; // por qué hay que revisarlo (vacío = coincide)
  cubre: string; // a qué se aplica al aprobar
  notas: string[]; // información (no impide aprobar)
  duplicados: string[]; // otros comprobantes por aprobar de la misma unidad y monto (probables repetidos)
};
export type SinComprobante = { mov: Movimiento; etiqueta: string | null; motivo: string };
export type SinDeposito = { pagoId: string; etiqueta: string; monto: number; fechaPago: string; motivo: string };
export type Conciliacion = {
  resumen: { depositos: number; total: number; desde: string; hasta: string; cargos: number; ignoradas: number; yaConciliados: number };
  coincidencias: Coincidencia[];
  sinComprobante: SinComprobante[];
  sinDeposito: SinDeposito[];
  yaConciliados: { mov: Movimiento; folio: string; etiqueta: string }[];
};

/** Lo que se guarda en el pago aprobado por match (y evita reutilizar el depósito). */
export type ConciliacionPago = {
  movId: string;
  fecha: string;
  hora: string;
  monto: number;
  ordenante: string;
  banco: string;
  rastreo: string;
  recibo: string;
  concepto: string;
  archivo: string;
  en: string;
};

export const MAX_FILAS_ESTADO_CUENTA = 3000;
const DIAS_COINCIDE = 3;
const DIAS_MAX = 15;

// ---------- Utilidades de texto ----------
const sinAcentos = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/�/g, '');
const mayus = (s: unknown) => sinAcentos(s).toUpperCase();
const espacios = (s: string) => s.replace(/\s+/g, ' ').trim();

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  const v = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = v[0];
    v[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = v[j];
      v[j] = Math.min(v[j] + 1, v[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return v[b.length];
}

// ---------- Lectura del Excel ----------
function numero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').replace(/[$,\s]/g, '');
  if (!s) return null;
  const n = Number(s.replace(/^\((.*)\)$/, '-$1'));
  return Number.isFinite(n) ? n : null;
}

const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
const dos = (n: number) => String(n).padStart(2, '0');

/** Fecha de una celda: número de serie de Excel, «02/11/2026» (día/mes), «2026-11-02» o «02-nov-2026». */
export function fechaCelda(v: unknown): string {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((Math.floor(v) - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`;
  }
  const s = mayus(v).trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${dos(+m[2])}-${dos(+m[3])}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${dos(+m[2])}-${dos(+m[1])}`;
  m = s.match(/^(\d{1,2})[-/ ]([A-Z]{3})[A-Z]*[-/ ](\d{2,4})/);
  if (m && MESES.includes(m[2])) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${dos(MESES.indexOf(m[2]) + 1)}-${dos(+m[1])}`;
  return '';
}

function horaCelda(v: unknown): string {
  if (typeof v === 'number' && v >= 0) {
    const seg = Math.round((v % 1) * 86400);
    return `${dos(Math.floor(seg / 3600) % 24)}:${dos(Math.floor(seg / 60) % 60)}:${dos(seg % 60)}`;
  }
  return String(v ?? '').match(/\d{1,2}:\d{2}(:\d{2})?/)?.[0] ?? '';
}

const campo = (texto: string, re: RegExp) => espacios(texto.match(re)?.[1] ?? '');

/** Datos del depósito dentro de la descripción del banco (formato SPEI de BanBajío y similares). */
export function datosDescripcion(desc: string) {
  const d = espacios(desc);
  const concepto =
    campo(d, /Concepto del Pago:\s*(.*?)\s*(?:\|\s*Recibo\s*#|$)/i) || campo(d, /Concepto:\s*(.*?)\s*(?:\||$)/i);
  return {
    banco: campo(d, /contraparte:\s*(.*?)\s*Ordenante:/i),
    ordenante: campo(d, /(?<!Cuenta )Ordenante:\s*(.*?)\s*(?:Cuenta Ordenante:|\||RFC|$)/i),
    cuenta: campo(d, /Cuenta Ordenante:\s*(\d+)/i).slice(-4),
    referencia: campo(d, /Referencia:\s*([^|]*?)\s*(?:\||$)/i),
    rastreo: campo(d, /Clave de Rastreo:\s*(\S+)/i),
    recibo: campo(d, /Recibo\s*#\s*(\d+)/i),
    concepto: concepto || d,
  };
}

/**
 * Lee las filas de la primera hoja (como las entrega SheetJS con `header: 1, raw: true`): encuentra la fila de
 * encabezados (Fecha + Abonos/Depósitos) y devuelve solo los abonos.
 */
export function leerEstadoCuenta(filas: unknown[][]): LecturaEstadoCuenta {
  const norm = (c: unknown) => mayus(c).replace(/[^A-Z]/g, '');
  const iEnc = filas.findIndex((r) => {
    const cs = (r ?? []).map(norm);
    return cs.some((c) => c.startsWith('FECHA')) && cs.some((c) => /ABONO|DEPOSITO|CREDITO|IMPORTE|MONTO/.test(c));
  });
  if (iEnc < 0) throw new Error('No encontré los encabezados del estado de cuenta (Fecha, Descripción, Abonos).');
  const enc = filas[iEnc].map(norm);
  const col = (re: RegExp, evitar?: RegExp) => enc.findIndex((c) => re.test(c) && !(evitar && evitar.test(c)));
  const cFecha = col(/^FECHA/);
  const cHora = col(/^HORA/);
  const cRecibo = col(/RECIBO|FOLIO/);
  const cDesc = col(/DESCRIP|CONCEPTO|DETALLE/);
  const cAbono = col(/ABONO|DEPOSITO|CREDITO/);
  const cCargo = col(/CARGO|RETIRO|DEBITO/);
  const cImporte = cAbono < 0 ? col(/IMPORTE|MONTO/) : -1;
  if (cFecha < 0 || cDesc < 0 || (cAbono < 0 && cImporte < 0)) throw new Error('El archivo no tiene las columnas Fecha, Descripción y Abonos.');

  const movimientos: Movimiento[] = [];
  let cargos = 0;
  let ignoradas = 0;
  const vistos = new Map<string, number>();
  filas.slice(iEnc + 1, iEnc + 1 + MAX_FILAS_ESTADO_CUENTA).forEach((r, k) => {
    const fila = iEnc + 2 + k;
    if (!r || r.every((c) => String(c ?? '').trim() === '')) return;
    const fecha = fechaCelda(r[cFecha]);
    const abono = numero(cAbono >= 0 ? r[cAbono] : r[cImporte]);
    const cargo = cCargo >= 0 ? numero(r[cCargo]) : null;
    if (!fecha) return void ignoradas++;
    if (!(abono && abono > 0)) {
      if ((cargo && cargo > 0) || (abono && abono < 0)) cargos++;
      else ignoradas++;
      return;
    }
    const descripcion = espacios(String(r[cDesc] ?? '')).slice(0, 1000);
    const d = datosDescripcion(descripcion);
    const recibo = espacios(String(cRecibo >= 0 ? r[cRecibo] ?? '' : '')) || d.recibo;
    const hora = (cHora >= 0 && horaCelda(r[cHora])) || horaCelda(descripcion.match(/Hora:\s*([\d:]+)/i)?.[1]);
    const monto = r2(abono);
    let id = d.rastreo ? `C:${mayus(d.rastreo)}` : recibo ? `R:${recibo}` : `H:${fecha}|${hora}|${monto}|${mayus(descripcion).slice(0, 80)}`;
    // Dos filas idénticas en el mismo archivo son dos depósitos distintos: se numeran.
    const n = (vistos.get(id) ?? 0) + 1;
    vistos.set(id, n);
    if (n > 1) id = `${id}#${n}`;
    movimientos.push({ ...d, id, fila, fecha, hora, monto, recibo, descripcion });
  });
  const fechas = movimientos.map((m) => m.fecha).sort();
  return { movimientos, cargos, ignoradas, desde: fechas[0] ?? '', hasta: fechas[fechas.length - 1] ?? '' };
}

// ---------- Unidades y nombres ----------
const PREFIJO = /^(CASA|DEPTO|DPTO|DEPARTAMENTO|DEP|INTERIOR|INT|LOCAL|TORRE)\.?\s*/;
/** Número de la unidad para buscarlo en el concepto: «Depto 311» → «311», «Depto A-101» → «A101». */
export const numeroUnidad = (etiqueta: string) => mayus(etiqueta).trim().replace(PREFIJO, '').replace(/[^A-Z0-9]/g, '');
const sinCeros = (s: string) => s.replace(/^0+(?=\d)/, '');
const MARCADORES = new Set(['CASA', 'DEPTO', 'DPTO', 'DEPARTAMENTO', 'DEP', 'INT', 'INTERIOR', 'NO', 'NUM', 'NUMERO', 'LOCAL']);

/** Unidades que menciona un texto. `marcadas` = las que vienen después de «Depto», «Casa» o el nombre del condominio. */
export function unidadesEnTexto(texto: string, unidades: UnidadC[], nombreCondominio = '') {
  const t = mayus(texto);
  // Separa letras de números («LAULA306MTONOV2026» → «LAULA 306 MTONOV 2026»).
  const partido = t.replace(/([A-Z])(\d)/g, '$1 $2').replace(/(\d)([A-Z])/g, '$1 $2');
  const tokens = partido.split(/[^A-Z0-9]+/).filter(Boolean);
  const condo = new Set(mayus(nombreCondominio).split(/[^A-Z0-9]+/).filter((x) => x.length >= 3));
  const encontradas = new Set<string>();
  const marcadas = new Set<string>();
  for (const u of unidades) {
    const num = numeroUnidad(u.etiqueta);
    if (!num) continue;
    if (/^\d+$/.test(num)) {
      tokens.forEach((tk, i) => {
        if (!/^\d+$/.test(tk) || sinCeros(tk) !== sinCeros(num)) return;
        const antes = tokens[i - 1] ?? '';
        // «NOV26», «OCT 2026»: es el año, no la unidad.
        if (MESES.some((m) => antes.startsWith(m)) && tk.length <= 2 && !MARCADORES.has(antes)) return;
        encontradas.add(u.id);
        if (MARCADORES.has(antes) || condo.has(antes)) marcadas.add(u.id);
      });
    } else {
      // Unidades con letras («A-101»): mismos caracteres con o sin separadores, sin pegarse a otros.
      const re = new RegExp(`(?<![A-Z0-9])${num.split('').join('[^A-Z0-9]?')}(?![0-9])`);
      if (re.test(t)) {
        encontradas.add(u.id);
        marcadas.add(u.id);
      }
    }
  }
  return { encontradas: [...encontradas], marcadas: [...marcadas] };
}

const VACIAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'E', 'MA', 'MA.', 'SR', 'SRA']);
const palabras = (s: unknown) =>
  mayus(s)
    .split(/[^A-Z]+/)
    .filter((w) => w.length >= 3 && !VACIAS.has(w));
const parecidas = (a: string, b: string) => {
  if (a === b) return true;
  const n = Math.min(a.length, b.length);
  const d = levenshtein(a, b);
  return (n >= 5 && d <= 1) || (n >= 8 && d <= 2);
};
/** Palabras del ordenante que aparecen en el nombre (cada palabra del nombre se usa una vez). */
export function palabrasEnComun(ordenante: string, nombre: string) {
  const resto = palabras(nombre);
  let n = 0;
  for (const w of palabras(ordenante)) {
    const i = resto.findIndex((r) => parecidas(w, r));
    if (i >= 0) {
      n++;
      resto.splice(i, 1);
    }
  }
  return n;
}

// ---------- Cruce ----------
/**
 * Cargos cuya suma es exactamente `monto`: primero un solo cargo, luego grupos de 2, 3… (el grupo más chico;
 * en empate, los que vencen antes). null si ninguna combinación cuadra al centavo.
 */
export function grupoExacto<T extends { monto: number; vence?: string | null }>(cargos: T[], monto: number): T[] | null {
  const lista = [...cargos].sort((a, b) => String(a.vence ?? '').localeCompare(String(b.vence ?? ''))).slice(0, 12);
  let mejor: T[] | null = null;
  for (let mask = 1; mask < 1 << lista.length; mask++) {
    const g = lista.filter((_, i) => mask & (1 << i));
    if (mejor && g.length >= mejor.length) continue;
    if (Math.abs(g.reduce((s, c) => s + c.monto, 0) - monto) <= 0.004) mejor = g;
  }
  return mejor;
}

const diasEntre = (a: string, b: string) => Math.round(Math.abs(Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000);
const diaPago = (p: PagoC) => p.fecha || String(p.createdAt ?? '').slice(0, 10);
const fechaCorta = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number);
  return y ? `${dd} ${MESES[m - 1]?.toLowerCase()} ${y}` : d;
};
const pesos = (n: number) => `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const jsonDe = (v: unknown): any => {
  let x = v;
  for (let k = 0; k < 2 && typeof x === 'string'; k++) {
    try {
      x = JSON.parse(x);
    } catch {
      return null;
    }
  }
  return x && typeof x === 'object' ? x : null;
};
/** Depósito con que se concilió un pago (si se aprobó por match). */
export const conciliacionDe = (p: { conciliacion?: unknown }): ConciliacionPago | null => jsonDe(p.conciliacion);

export function conciliar(args: {
  lectura: LecturaEstadoCuenta;
  pagos: PagoC[];
  unidades: UnidadC[];
  perfiles: PerfilC[];
  cargos: CargoC[];
  nombreCondominio?: string;
}): Conciliacion {
  const { lectura, pagos, unidades, perfiles, cargos } = args;
  const U = new Map(unidades.map((u) => [u.id, u]));
  const etiqueta = (id: string) => U.get(id)?.etiqueta ?? 'Unidad';
  const nombres = new Map<string, string[]>();
  for (const p of perfiles) if (p.unidadId && p.nombre && (!p.rol || p.rol === 'RESIDENTE')) (nombres.get(p.unidadId) ?? nombres.set(p.unidadId, []).get(p.unidadId)!).push(p.nombre);
  for (const u of unidades) if (u.propietario) (nombres.get(u.id) ?? nombres.set(u.id, []).get(u.id)!).push(u.propietario);
  const nombreCoincide = (ordenante: string, unidadId: string) => Math.max(0, ...(nombres.get(unidadId) ?? []).map((n) => palabrasEnComun(ordenante, n)));

  // Los comprobantes que ya se habían subido antes no entran al match: la administración los revisa y aprueba a mano.
  const repetidos = pagos.filter((p) => p.estado === 'EN_REVISION' && p.comprobanteRepetido);
  const pend = pagos.filter((p) => p.estado === 'EN_REVISION' && !p.comprobanteRepetido);
  const aprobados = pagos.filter((p) => p.estado === 'VALIDADO');
  // Depósitos ya usados por un match anterior.
  const usados = new Map<string, PagoC>();
  for (const p of aprobados) {
    const c = conciliacionDe(p);
    if (c?.movId) usados.set(c.movId, p);
  }

  // Vista previa de cómo se aplicaría cada comprobante (mismo cálculo que admin-api validarPago).
  const cargosPorId = new Map(cargos.map((c) => [c.id, c]));
  const pendientesDe = (p: PagoC) =>
    (p.cargoIds ?? []).map((id) => (id ? cargosPorId.get(id) : undefined)).filter((c): c is CargoC => !!c && c.estado === 'PENDIENTE' && c.unidadId === p.unidadId);
  const aplicacion = (p: PagoC) => {
    const propios = pendientesDe(p);
    const total = r2(propios.reduce((s, c) => s + c.monto, 0));
    const favor = p.usarSaldoFavor ? favorAUsar(U.get(p.unidadId)?.saldoFavor ?? 0, total, p.monto) : 0;
    const plan = repartirPago(propios, p.monto + favor);
    const lista = propios.map((c) => `${c.concepto} (${pesos(c.monto)})`).join(', ');
    if (!propios.length) return { ok: false, texto: `No tiene cargos pendientes ligados: los ${pesos(p.monto)} quedarían como saldo a favor` };
    if (Math.abs(plan.diferencia) <= 0.004) return { ok: true, texto: `Cubre: ${lista}${favor ? ` (usa ${pesos(favor)} de saldo a favor)` : ''}` };
    return plan.diferencia < 0
      ? { ok: false, texto: `Es menor que sus cargos (${lista}): quedaría pendiente ${pesos(-plan.diferencia)}` }
      : { ok: false, texto: `Es mayor que sus cargos (${lista}): ${pesos(plan.diferencia)} quedarían como saldo a favor` };
  };

  type Par = { mov: Movimiento; pago: PagoC; score: number; razones: string[]; dias: number; porUnidad: boolean; conflicto: string | null };
  const pares: Par[] = [];
  const yaConciliados: Conciliacion['yaConciliados'] = [];
  const nuevos: Movimiento[] = [];
  const detectadas = new Map<string, { encontradas: string[]; marcadas: string[]; ref: string[]; nombre: string[] }>();

  /** ¿El depósito es de la unidad del comprobante? (sin revisar el monto). null = no hay evidencia suficiente. */
  function evidencia(mov: Movimiento, p: PagoC) {
    const det = detectadas.get(mov.id)!;
    const unidadesConcepto = det.encontradas;
    const rastreo = mayus(mov.rastreo).replace(/[^A-Z0-9]/g, '');
    const refPago = mayus(p.referencia).replace(/[^A-Z0-9]/g, '');
    const porRastreo = (rastreo.length >= 8 && refPago.includes(rastreo)) || (mov.recibo.length >= 6 && refPago.includes(mov.recibo));
    const porUnidad = unidadesConcepto.includes(p.unidadId) || (!unidadesConcepto.length && det.ref.includes(p.unidadId));
    const comun = mov.ordenante ? nombreCoincide(mov.ordenante, p.unidadId) : 0;
    if (!porRastreo && !porUnidad && comun < 2) return null;
    const dias = diasEntre(mov.fecha, diaPago(p) || mov.fecha);
    if (dias > DIAS_MAX && !porRastreo) return null;
    const razones: string[] = [];
    if (porRastreo) razones.push('La clave de rastreo del banco está en el comprobante');
    if (porUnidad) razones.push(unidadesConcepto.includes(p.unidadId) ? `El concepto dice ${etiqueta(p.unidadId)}` : `La referencia dice ${etiqueta(p.unidadId)}`);
    if (comun >= 2) razones.push('Quien transfirió es residente de la unidad');
    razones.push('Monto exacto');
    if (dias <= DIAS_COINCIDE) razones.push(dias === 0 ? 'Misma fecha' : `Fecha con ${dias} día${dias === 1 ? '' : 's'} de diferencia`);
    const otras = unidadesConcepto.filter((id) => id !== p.unidadId);
    const conflicto = !porRastreo && otras.length ? `El concepto del depósito menciona ${otras.map(etiqueta).join(', ')}` : null;
    const score = (porRastreo ? 100 : 0) + (porUnidad ? 50 : 0) + (comun >= 2 ? 20 + comun : 0) - (conflicto ? 40 : 0) - Math.min(dias, DIAS_MAX);
    return { score, razones, dias, porUnidad, conflicto };
  }

  for (const mov of lectura.movimientos) {
    const previo = usados.get(mov.id);
    if (previo) {
      yaConciliados.push({ mov, folio: previo.folio ?? '', etiqueta: etiqueta(previo.unidadId) });
      continue;
    }
    nuevos.push(mov);
    const enConcepto = unidadesEnTexto(mov.concepto, unidades, args.nombreCondominio);
    // Si el concepto menciona varias unidades, cuentan las que van después de «Depto», «Casa» o el nombre del condominio.
    const unidadesConcepto = enConcepto.encontradas.length > 1 && enConcepto.marcadas.length ? enConcepto.marcadas : enConcepto.encontradas;
    const ref = /^\s*[A-Z0-9-]{1,6}\s*$/i.test(mov.referencia) ? unidadesEnTexto(mov.referencia, unidades).encontradas : [];
    const porNombre = mov.ordenante ? unidades.filter((u) => nombreCoincide(mov.ordenante, u.id) >= 2).map((u) => u.id) : [];
    detectadas.set(mov.id, { encontradas: unidadesConcepto, marcadas: enConcepto.marcadas, ref, nombre: porNombre });
    for (const p of pend) {
      if (Math.abs(p.monto - mov.monto) > 0.004) continue;
      const ev = evidencia(mov, p);
      if (ev) pares.push({ mov, pago: p, ...ev });
    }
  }

  // Asignación uno a uno: primero las coincidencias más sólidas; en empate, el comprobante enviado primero.
  pares.sort((a, b) => b.score - a.score || String(a.pago.createdAt ?? '').localeCompare(String(b.pago.createdAt ?? '')));
  const movUsado = new Set<string>();
  const pagoUsado = new Set<string>();
  const coincidencias: Coincidencia[] = [];
  for (const par of pares) {
    if (movUsado.has(par.mov.id) || pagoUsado.has(par.pago.id)) continue;
    movUsado.add(par.mov.id);
    pagoUsado.add(par.pago.id);
    const p = par.pago;
    const alertas: string[] = [];
    if (par.conflicto) alertas.push(par.conflicto);
    if (par.dias > DIAS_COINCIDE)
      alertas.push(`El depósito es del ${fechaCorta(par.mov.fecha)} y el residente dijo que pagó el ${fechaCorta(diaPago(p))} (${par.dias} días de diferencia)`);
    // ¿Ya hay un pago aprobado igual (misma unidad y monto, fecha cercana)? Puede ser el mismo depósito aprobado a mano.
    const gemelo = aprobados.find(
      (a) => a.unidadId === p.unidadId && Math.abs(a.monto - p.monto) <= 0.004 && !conciliacionDe(a) && diasEntre(diaPago(a) || par.mov.fecha, par.mov.fecha) <= DIAS_COINCIDE,
    );
    if (gemelo) alertas.push(`Ya hay un pago aprobado de ${etiqueta(p.unidadId)} por ${pesos(p.monto)} (recibo ${gemelo.folio ?? 's/f'}): revisa que no sea este mismo depósito`);
    const ap = aplicacion(p);
    if (!ap.ok) alertas.push(ap.texto);
    coincidencias.push({
      clave: p.id,
      pagoId: p.id,
      movId: par.mov.id,
      nivel: alertas.length ? 'REVISAR' : 'COINCIDE',
      unidadId: p.unidadId,
      etiqueta: etiqueta(p.unidadId),
      monto: p.monto,
      fechaPago: diaPago(p),
      mov: par.mov,
      razones: par.razones,
      alertas,
      cubre: ap.ok ? ap.texto : '',
      notas: [],
      duplicados: [],
    });
  }

  // Por cargo: comprobantes de varios cargos sin un depósito por el total. Se buscan depósitos de la misma unidad por
  // el monto de cada cargo (o de un grupo de sus cargos); cada uno se aprueba por separado con su propio recibo.
  // Un cargo que ya cubre otra coincidencia no se vuelve a usar.
  const cargosCubiertos = new Set<string>();
  for (const c of coincidencias) for (const x of pendientesDe(pend.find((p) => p.id === c.pagoId)!)) cargosCubiertos.add(x.id);
  const porCargo: Coincidencia[] = [];
  for (const p of [...pend].sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))) {
    if (pagoUsado.has(p.id) || p.usarSaldoFavor || pendientesDe(p).length < 2) continue;
    let restantes = pendientesDe(p).filter((c) => !cargosCubiertos.has(c.id));
    if (!restantes.length) continue;
    const candidatos = nuevos
      .filter((m) => !movUsado.has(m.id))
      .map((m) => ({ mov: m, ev: evidencia(m, p) }))
      .filter((x): x is { mov: Movimiento; ev: NonNullable<ReturnType<typeof evidencia>> } => !!x.ev)
      .sort((a, b) => b.ev.score - a.ev.score || a.mov.fecha.localeCompare(b.mov.fecha));
    const partes: Coincidencia[] = [];
    for (const { mov, ev } of candidatos) {
      const grupo = grupoExacto(restantes, mov.monto);
      if (!grupo) continue;
      movUsado.add(mov.id);
      restantes = restantes.filter((c) => !grupo.includes(c));
      grupo.forEach((c) => cargosCubiertos.add(c.id));
      const alertas: string[] = [];
      if (ev.conflicto) alertas.push(ev.conflicto);
      if (ev.dias > DIAS_COINCIDE)
        alertas.push(`El depósito es del ${fechaCorta(mov.fecha)} y el residente dijo que pagó el ${fechaCorta(diaPago(p))} (${ev.dias} días de diferencia)`);
      const gemelo = aprobados.find(
        (a) => a.unidadId === p.unidadId && Math.abs(a.monto - mov.monto) <= 0.004 && !conciliacionDe(a) && diasEntre(diaPago(a) || mov.fecha, mov.fecha) <= DIAS_COINCIDE,
      );
      if (gemelo) alertas.push(`Ya hay un pago aprobado de ${etiqueta(p.unidadId)} por ${pesos(mov.monto)} (recibo ${gemelo.folio ?? 's/f'}): revisa que no sea este mismo depósito`);
      partes.push({
        clave: `${p.id}|${mov.id}`,
        pagoId: p.id,
        cargoIds: grupo.map((c) => c.id),
        montoComprobante: p.monto,
        movId: mov.id,
        nivel: alertas.length ? 'REVISAR' : 'COINCIDE',
        unidadId: p.unidadId,
        etiqueta: etiqueta(p.unidadId),
        monto: mov.monto,
        fechaPago: diaPago(p),
        mov,
        razones: [...ev.razones.filter((r) => r !== 'Monto exacto'), grupo.length === 1 ? 'Monto exacto del cargo' : 'Monto exacto de sus cargos'],
        alertas,
        cubre: `Cubre: ${grupo.map((c) => `${c.concepto} (${pesos(c.monto)})`).join(', ')} · con su propio recibo`,
        notas: [],
        duplicados: [],
      });
      if (!restantes.length) break;
    }
    if (!partes.length) continue;
    pagoUsado.add(p.id);
    const suma = r2(partes.reduce((s, x) => s + x.monto, 0));
    const nota = restantes.length
      ? `El comprobante de ${pesos(p.monto)} cubre varios cargos y se pagaron por separado. Sin depósito en este archivo: ${restantes
          .map((c) => `${c.concepto} (${pesos(c.monto)})`)
          .join(', ')}; seguirá en «Por aprobar».`
      : Math.abs(suma - p.monto) <= 0.004
        ? `El comprobante de ${pesos(p.monto)} cubre ${partes.length > 1 ? `${partes.length} depósitos que suman lo mismo` : 'este depósito'}: cada depósito lleva su recibo.`
        : `El residente declaró ${pesos(p.monto)} y los depósitos suman ${pesos(suma)}: cada cargo se aprueba por lo que llegó al banco.`;
    for (const x of partes) x.notas.push(nota);
    porCargo.push(...partes);
  }
  coincidencias.push(...porCargo);

  // Comprobantes sin depósito en este archivo; los de la misma unidad y monto que uno ya emparejado son probables repetidos.
  const sinDeposito: SinDeposito[] = [];
  for (const p of pend) {
    if (pagoUsado.has(p.id)) continue;
    const gemelo = coincidencias.find((c) => c.unidadId === p.unidadId && Math.abs(c.monto - p.monto) <= 0.004);
    if (gemelo) gemelo.duplicados.push(p.id);
    const mismaUnidad = nuevos.filter((m) => {
      const d = detectadas.get(m.id);
      return d && (d.encontradas.includes(p.unidadId) || d.nombre.includes(p.unidadId)) && !movUsado.has(m.id);
    });
    const iguales = pend.filter((o) => o.id !== p.id && o.unidadId === p.unidadId && Math.abs(o.monto - p.monto) <= 0.004 && !pagoUsado.has(o.id)).length;
    const motivo = gemelo
      ? `Posible comprobante repetido: el depósito de ${pesos(p.monto)} del ${fechaCorta(gemelo.mov.fecha)} ya se emparejó con otro comprobante de ${etiqueta(p.unidadId)}`
      : mismaUnidad.length
        ? `Hay un depósito de ${etiqueta(p.unidadId)} por ${mismaUnidad.map((m) => pesos(m.monto)).join(', ')}: el monto no coincide, revísalo a mano`
        : `No aparece en este estado de cuenta${iguales ? ` · hay ${iguales + 1} comprobantes iguales de esta unidad (posible repetido)` : ''}`;
    sinDeposito.push({ pagoId: p.id, etiqueta: etiqueta(p.unidadId), monto: p.monto, fechaPago: diaPago(p), motivo });
  }
  for (const p of repetidos)
    sinDeposito.push({
      pagoId: p.id,
      etiqueta: etiqueta(p.unidadId),
      monto: p.monto,
      fechaPago: diaPago(p),
      motivo: 'Comprobante que ya se había subido antes: revísalo y apruébalo personalmente desde «Por aprobar»',
    });
  // Otros comprobantes por aprobar de la misma unidad (otros montos): se informa para revisarlos después.
  for (const c of coincidencias) {
    const otros = sinDeposito.filter((s) => s.etiqueta === c.etiqueta && !c.duplicados.includes(s.pagoId));
    if (otros.length) c.notas.push(`${c.etiqueta} tiene ${otros.length === 1 ? 'otro comprobante' : `otros ${otros.length} comprobantes`} por aprobar que no aparece${otros.length === 1 ? '' : 'n'} en este archivo (${otros.map((s) => pesos(s.monto)).join(', ')})`);
  }
  // Duplicados: la tarjeta que coincide pasa a «Revisar» para que la administración lo vea antes de aprobar.
  for (const c of coincidencias) {
    if (!c.duplicados.length) continue;
    c.alertas.push(`${etiqueta(c.unidadId)} tiene ${c.duplicados.length + 1} comprobantes iguales por aprobar y un solo depósito: los demás parecen repetidos`);
    c.nivel = 'REVISAR';
  }

  // Depósitos sin comprobante por aprobar.
  const sinComprobante: SinComprobante[] = nuevos
    .filter((m) => !movUsado.has(m.id))
    .map((mov) => {
      const d = detectadas.get(mov.id)!;
      const cand = d.encontradas.length ? d.encontradas : d.ref.length ? d.ref : d.nombre;
      const et = cand.length === 1 ? etiqueta(cand[0]) : null;
      const pendUnidad = cand.length === 1 ? pend.filter((p) => p.unidadId === cand[0] && !pagoUsado.has(p.id)) : [];
      const motivo =
        cand.length > 1
          ? `El concepto menciona varias unidades (${cand.map(etiqueta).join(', ')})`
          : !et
            ? 'No se identificó la casa o departamento (ni en el concepto ni por el nombre)'
            : pendUnidad.length
              ? `${et} tiene comprobante por aprobar, pero por otro monto (${pendUnidad.map((p) => pesos(p.monto)).join(', ')})`
              : `${et} no tiene comprobante por aprobar`;
      return { mov, etiqueta: et, motivo };
    });

  const orden = (a: { etiqueta: string }, b: { etiqueta: string }) => a.etiqueta.localeCompare(b.etiqueta, 'es', { numeric: true });
  coincidencias.sort((a, b) => (a.nivel === b.nivel ? orden(a, b) : a.nivel === 'COINCIDE' ? -1 : 1));
  sinDeposito.sort(orden);
  return {
    resumen: {
      depositos: lectura.movimientos.length,
      total: r2(lectura.movimientos.reduce((s, m) => s + m.monto, 0)),
      desde: lectura.desde,
      hasta: lectura.hasta,
      cargos: lectura.cargos,
      ignoradas: lectura.ignoradas,
      yaConciliados: yaConciliados.length,
    },
    coincidencias,
    sinComprobante,
    sinDeposito,
    yaConciliados,
  };
}
