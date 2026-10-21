// API del portal para residentes y vigilantes.
// Punto único de control: nadie accede a datos si un administrador no lo aprobó,
// y cada módulo solo responde si la administración lo habilitó para su condominio.
import type { AppSyncResolverEvent } from 'aws-lambda';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  ApiError,
  byIndex,
  codigoCorto,
  fail,
  get,
  hoyMX,
  newest,
  now,
  parsePayload,
  put,
  str,
  update,
  type Item,
} from '../shared/db';
import { sinFirmas } from '../shared/firma';
import { emailDe } from '../shared/cognito';
import { enviarAUsuario } from '../shared/push';
import { FONDO_AMENIDADES, calcularFondoAmenidades } from '../shared/finanzas';
import { IMAGENES_SERVICIO, imagenServicio } from '../shared/servicios';
import { accionNotificaciones } from '../shared/push';
import { CATEGORIAS_RESIDENTE, CATEGORIAS_VIGILANTE } from '../shared/notificaciones';
import { CAMPO_LEIDO, chatSinLeer, deEquipo, leidoHasta } from '../shared/pendientes';
import { SLOTS_AMENIDADES, documentosDe } from '../shared/documentos';
import { nombreAdjunto } from '../shared/comunicados';
import { ACTIVAS, HORAS_APARTADO, apartadas, cancelarCargoReserva, cargoDeReserva, confirmarReserva, limitePago, relacionadas, vencerSiCorresponde } from '../shared/reservas';
import { enPapelera, operando, suspendido } from '../shared/condominios';
import { MAX_FOTOS_REPORTE, MAX_FOTO_REPORTE, OTRO_SERVICIO, listaJson, servicioDe, type FotoReporte } from '../shared/proveedores';

type Ctx = {
  sub: string;
  email: string;
  perfil: Item;
  condominio: Item;
  unidad?: Item;
  p: Item;
};

const pub = (c: Item) => ({
  id: c.id,
  nombre: c.nombre,
  tipo: c.tipo,
  modulos: c.modulos ?? [],
  datosPago: c.datosPago,
  telefonoCaseta: c.telefonoCaseta,
  serviciosCondominio: (c.serviciosCondominio ?? []).filter(Boolean),
  // Suspendido por SIIA o en la papelera: el portal muestra un aviso en lugar de los servicios.
  suspendido: !operando(c),
});

const sinPrivados = ({ userId, __typename, ...rest }: Item) => rest;
/** Etapas del seguimiento de un incidente (JSON guardado como texto, a veces dos veces). */
function pasosIncidente(v: unknown): Item[] {
  let h = v;
  for (let k = 0; k < 2 && typeof h === 'string'; k++) {
    try {
      h = JSON.parse(h);
    } catch {
      h = [];
    }
  }
  return Array.isArray(h) ? h : [];
}

// ---------- utilidades ----------
const s3 = new S3Client({});
async function fotoUrl(path?: string) {
  if (!path || !process.env.BUCKET) return undefined;
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.BUCKET, Key: path }), { expiresIn: 3600 });
}
// Archivos que adjunta un residente: deben estar en su carpeta del tipo correcto, haberlos subido él
// (metadato `sub` que pone el portal al subir), ser del tipo permitido y pesar máximo 8 MB.
const MAX_ARCHIVO = 8 * 1024 * 1024;
const TIPOS_ARCHIVO: Record<string, RegExp> = {
  comprobantes: /^(image\/[\w.+-]+|application\/pdf)$/,
  incidentes: /^(image\/[\w.+-]+|application\/pdf)$/,
  mascotas: /^image\/[\w.+-]+$/,
  chat: /^image\/[\w.+-]+$/,
  vigilancia: /^image\/[\w.+-]+$/,
};

// Comunicado con sus imágenes y PDF como URLs temporales (las rutas en S3 no se comparten).
// Los PDF se firman para descargarse con su nombre.
async function conImagenes(c: Item) {
  const { imagenes, adjuntos, ...rest } = sinPrivados(c);
  return {
    ...rest,
    imagenUrls: (await Promise.all(((imagenes ?? []) as string[]).map(fotoUrl))).filter(Boolean),
    adjuntos: await Promise.all(
      ((adjuntos ?? []) as string[]).map(async (path) => {
        const nombre = nombreAdjunto(path);
        const cmd = new GetObjectCommand({ Bucket: process.env.BUCKET, Key: path, ResponseContentDisposition: `attachment; filename="${nombre}"` });
        return { nombre, url: await getSignedUrl(s3, cmd, { expiresIn: 3600 }) };
      }),
    ),
  };
}

// Mensaje de chat con su foto como URL temporal (la ruta en S3 no se comparte).
const TEXTO_FOTO = '📷 Foto';
async function conImagen(m: Item) {
  const { imagenPath, ...rest } = sinPrivados(m);
  return imagenPath ? { ...rest, imagenUrl: await fotoUrl(imagenPath) } : rest;
}
/** Texto y foto de un mensaje nuevo: al menos uno de los dos. */
async function contenidoMensaje(p: Item, sub: string) {
  const imagenPath = p.imagenPath ? await archivoPropio(p.imagenPath, sub, 'chat') : null;
  const texto = str(p.texto, 2000) || (imagenPath ? TEXTO_FOTO : '');
  if (!texto) fail('Escribe un mensaje.');
  return { texto, ...(imagenPath ? { imagenPath } : {}) };
}
async function archivoPropio(path: string, sub: string, carpeta: keyof typeof TIPOS_ARCHIVO): Promise<string> {
  const p = str(path, 300);
  const [raiz, identidad, subcarpeta, nombre, ...resto] = p.split('/');
  if (raiz !== 'residentes' || !identidad || subcarpeta !== carpeta || !nombre || resto.length) fail('El archivo adjunto no es válido. Súbelo de nuevo.');
  let h;
  try {
    h = await s3.send(new HeadObjectCommand({ Bucket: process.env.BUCKET!, Key: p }));
  } catch {
    fail('No encontramos el archivo adjunto. Súbelo de nuevo.');
  }
  if (h!.Metadata?.sub !== sub) fail('El archivo adjunto no es tuyo. Súbelo de nuevo desde tu cuenta.');
  if ((h!.ContentLength ?? 0) > MAX_ARCHIVO) fail('El archivo supera 8 MB.');
  if (!TIPOS_ARCHIVO[carpeta].test(h!.ContentType ?? '')) fail(['comprobantes', 'incidentes'].includes(carpeta) ? 'Adjunta una imagen o un PDF.' : 'Adjunta una imagen.');
  return p;
}

const conFoto = async (m: Item, unidad: string) => ({ ...sinPrivados(m), fotoPath: undefined, fotoUrl: await fotoUrl(m.fotoPath), unidad });

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));



function visitaVigente(v: Item, hoy = hoyMX()) {
  if (v.estado === 'CANCELADA' || v.estado === 'DENTRO') return false;
  const fin = v.fechaFin || v.fecha;
  if (hoy < v.fecha || hoy > fin) return false;
  return v.estado === 'PROGRAMADA' || v.estado === 'AUTORIZADA' || (v.estado === 'SALIO' && fin > v.fecha);
}

async function aviso(c: Item, unidadId: string, tipo: string, titulo: string, texto?: string) {
  await put('Aviso', { condominioId: c.id, unidadId, tipo, titulo, texto, leido: false });
}

/** Notificación push a los vigilantes del condominio (respuestas a solicitudes de acceso). */
async function avisarCaseta(condominioId: string, title: string, body: string) {
  const vigilantes = (await byIndex('Perfil', 'byCondominio', 'condominioId', condominioId)).filter(
    (p) => p.rol === 'VIGILANTE' && p.estado === 'APROBADO' && !(p.notifApagadas ?? []).includes('accesos'),
  );
  await Promise.all(
    vigilantes.map((p) => enviarAUsuario(p.userId, { title, body, url: '/portal/#escanear', tag: `acceso-${condominioId}`, silent: !!p.notifSilencio }).catch(() => 0)),
  );
}

async function etiquetas(condominioId: string) {
  const unidades = await byIndex('Unidad', 'byCondominio', 'condominioId', condominioId);
  return Object.fromEntries(unidades.map((u) => [u.id as string, String(u.etiqueta)])) as Record<string, string>;
}

// ---------- acciones de residentes (prefijo = módulo requerido) ----------
const residente: Record<string, (ctx: Ctx) => Promise<unknown>> = {
  async 'inicio.resumen'({ condominio, unidad }) {
    const mods: string[] = condominio.modulos ?? [];
    const u = unidad!.id;
    const hoy = hoyMX();
    const [avisos, cargos, visitas, reservas, comunicados] = await Promise.all([
      byIndex('Aviso', 'byUnidad', 'unidadId', u),
      mods.includes('finanzas') ? byIndex('Cargo', 'byUnidad', 'unidadId', u) : [],
      mods.includes('visitas') ? byIndex('Visita', 'byUnidad', 'unidadId', u) : [],
      mods.includes('amenidades') ? byIndex('Reserva', 'byUnidad', 'unidadId', u) : [],
      mods.includes('comunicados') ? byIndex('Comunicado', 'byCondominio', 'condominioId', condominio.id) : [],
    ]);
    return {
      saldo: cargos.filter((c) => c.estado === 'PENDIENTE').reduce((s, c) => s + (c.monto ?? 0), 0),
      cargosVencidos: cargos.filter((c) => c.estado === 'PENDIENTE' && c.vence && c.vence < hoy).length,
      avisos: avisos.sort(newest).slice(0, 8).map(sinPrivados),
      avisosSinLeer: avisos.filter((a) => !a.leido).length,
      visitasHoy: visitas.filter((v) => visitaVigente(v, hoy) || v.estado === 'DENTRO').length,
      proximasReservas: reservas
        .filter((r) => r.fecha >= hoy && ACTIVAS.includes(r.estado))
        .sort((a, b) => (a.fecha + a.horaInicio).localeCompare(b.fecha + b.horaInicio))
        .slice(0, 3)
        .map(sinPrivados),
      comunicados: await Promise.all(comunicados.sort(newest).slice(0, 3).map(conImagenes)),
    };
  },

  // Campana: avisos de la unidad que faltan por ver (al verlos desaparecen) + mensajes de chat que este residente aún no ve
  async 'inicio.avisos'({ condominio, unidad, perfil }) {
    const [avisos, chat] = await Promise.all([byIndex('Aviso', 'byUnidad', 'unidadId', unidad!.id), chatSinLeer(perfil, condominio, unidad!.id)]);
    const sinLeer = avisos.filter((a) => !a.leido);
    return { sinLeer: sinLeer.length, avisos: sinLeer.sort(newest).slice(0, 50).map(sinPrivados), chat };
  },

  async 'inicio.leerAvisos'({ unidad }) {
    const avisos = await byIndex('Aviso', 'byUnidad', 'unidadId', unidad!.id);
    await Promise.all(avisos.filter((a) => !a.leido).map((a) => update('Aviso', { id: a.id }, { leido: true })));
    return { ok: true };
  },

  // Tocar un aviso en la campana o en la notificación push lo marca como leído
  async 'inicio.leerAviso'({ unidad, p }) {
    const a = await get('Aviso', { id: str(p.id, 64) });
    if (a && a.unidadId === unidad!.id && !a.leido) await update('Aviso', { id: a.id }, { leido: true });
    return { ok: true };
  },

  // ----- Finanzas -----
  async 'finanzas.estadoCuenta'({ unidad, condominio, perfil, email }) {
    const [cargos, pagos] = await Promise.all([
      byIndex('Cargo', 'byUnidad', 'unidadId', unidad!.id),
      byIndex('Pago', 'byUnidad', 'unidadId', unidad!.id),
    ]);
    const pendientes = cargos.filter((c) => c.estado === 'PENDIENTE');
    return {
      saldo: pendientes.reduce((s, c) => s + (c.monto ?? 0), 0),
      cargos: cargos
        .filter((c) => c.estado !== 'CANCELADO')
        .sort((a, b) => String(b.periodo ?? b.createdAt).localeCompare(String(a.periodo ?? a.createdAt)))
        .map(sinPrivados),
      pagos: pagos.sort(newest).map(sinPrivados),
      datosPago: condominio.datosPago ?? null,
      cuota: condominio.cuotaMensual ?? unidad!.cuota ?? null,
      // Para el historial de pagos en PDF
      titular: { condominio: condominio.nombre, direccion: condominio.direccion ?? null, unidad: unidad!.etiqueta, residente: perfil.nombre || email },
    };
  },

  async 'finanzas.registrarPago'({ unidad, condominio, sub, p }) {
    const monto = Number(p.monto);
    if (!(monto > 0) || monto > 1_000_000) fail('Indica un monto válido.');
    if (!p.comprobantePath) fail('Adjunta tu comprobante de pago.');
    const comprobantePath = await archivoPropio(p.comprobantePath, sub, 'comprobantes');
    const fecha = FECHA.test(p.fecha) ? p.fecha : hoyMX();
    const cargoIds: string[] = Array.isArray(p.cargoIds) ? p.cargoIds.slice(0, 50).map(String) : [];
    if (cargoIds.length) {
      const cargos = await byIndex('Cargo', 'byUnidad', 'unidadId', unidad!.id);
      const validos = new Set(cargos.filter((c) => c.estado === 'PENDIENTE').map((c) => c.id));
      if (!cargoIds.every((id) => validos.has(id))) fail('Alguno de los cargos seleccionados ya no está pendiente.');
    }
    const pago = await put('Pago', {
      condominioId: condominio.id,
      unidadId: unidad!.id,
      userId: sub,
      monto,
      fecha,
      referencia: str(p.referencia, 120),
      comprobantePath,
      cargoIds,
      estado: 'EN_REVISION',
    });
    // Confirmación en la sesión del residente: comprobante recibido (el segundo aviso llega al aprobarse).
    const mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(monto);
    await aviso(
      condominio,
      unidad!.id,
      'PAGO',
      'Comprobante de pago recibido',
      `Recibimos tu comprobante por ${mxn}. La administración lo revisará y te avisaremos cuando tu pago sea aprobado.`,
    );
    return sinPrivados(pago);
  },

  async 'finanzas.recibo'({ unidad, condominio, p }) {
    const pago = await get('Pago', { id: str(p.pagoId, 64) });
    if (!pago || pago.unidadId !== unidad!.id || pago.estado !== 'VALIDADO') fail('Recibo no disponible.');
    const cargos = await Promise.all((pago!.cargoIds ?? []).map((id: string) => get('Cargo', { id })));
    return {
      pago: sinPrivados(pago!),
      cargos: cargos.filter(Boolean).map((c) => sinPrivados(c!)),
      condominio: { nombre: condominio.nombre, direccion: condominio.direccion },
      unidad: { etiqueta: unidad!.etiqueta, propietario: unidad!.propietario },
    };
  },

  // ----- Comunicados y encuestas -----
  async 'comunicados.lista'({ condominio }) {
    const items = await byIndex('Comunicado', 'byCondominio', 'condominioId', condominio.id);
    return Promise.all(items.sort(newest).map(conImagenes));
  },

  async 'encuestas.lista'({ condominio, unidad }) {
    const encuestas = await byIndex('Encuesta', 'byCondominio', 'condominioId', condominio.id);
    const hoy = hoyMX();
    return Promise.all(
      encuestas.sort(newest).map(async (e) => {
        const votos = await byIndex('Voto', 'byEncuesta', 'encuestaId', e.id);
        const mio = votos.find((v) => v.unidadId === unidad!.id);
        const cerrada = e.estado === 'CERRADA' || (e.cierra && e.cierra < hoy);
        const resultados =
          mio || cerrada
            ? Object.fromEntries((e.opciones ?? []).map((o: string) => [o, votos.filter((v) => v.opcion === o).length]))
            : null;
        return { ...sinPrivados(e), cerrada: !!cerrada, miVoto: mio?.opcion ?? null, resultados, totalVotos: votos.length };
      }),
    );
  },

  async 'encuestas.votar'({ condominio, unidad, sub, p }) {
    const e = await get('Encuesta', { id: str(p.encuestaId, 64) });
    if (!e || e.condominioId !== condominio.id) fail('Encuesta no encontrada.');
    if (e!.estado === 'CERRADA' || (e!.cierra && e!.cierra < hoyMX())) fail('La encuesta ya cerró.');
    const opcion = str(p.opcion, 200);
    if (!(e!.opciones ?? []).includes(opcion)) fail('Opción no válida.');
    try {
      await put(
        'Voto',
        { id: `${e!.id}#${unidad!.id}`, encuestaId: e!.id, condominioId: condominio.id, unidadId: unidad!.id, opcion, userId: sub },
        { ifNotExists: 'id' },
      );
    } catch (err: any) {
      if (err?.name === 'ConditionalCheckFailedException') fail('Tu unidad ya votó en esta encuesta.');
      throw err;
    }
    return { ok: true };
  },

  // ----- Chat con administración / caseta -----
  async 'chat.mensajes'({ condominio, unidad, perfil, p }) {
    const canal = p.canal === 'CASETA' ? 'CASETA' : 'ADMIN';
    const items = await byIndex('Mensaje', 'byHilo', 'hilo', `${condominio.id}#${unidad!.id}#${canal}`);
    // Abrir la conversación la marca como leída (solo se escribe si llegó algo nuevo)
    const ultimo = items.filter(deEquipo).reduce((max, m) => (m.createdAt > max ? m.createdAt : max), '');
    if (ultimo > leidoHasta(perfil, canal, items)) await update('Perfil', { userId: perfil.userId }, { [CAMPO_LEIDO[canal]]: ultimo });
    return Promise.all(items.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-200).map(conImagen));
  },

  async 'chat.enviar'({ condominio, unidad, perfil, sub, p }) {
    const canal = p.canal === 'CASETA' ? 'CASETA' : 'ADMIN';
    const contenido = await contenidoMensaje(p, sub);
    const m = await put('Mensaje', {
      condominioId: condominio.id,
      unidadId: unidad!.id,
      canal,
      hilo: `${condominio.id}#${unidad!.id}#${canal}`,
      autorId: sub,
      autorNombre: `${perfil.nombre ?? perfil.email} · ${unidad!.etiqueta}`,
      autorRol: 'RESIDENTE',
      ...contenido,
    });
    return conImagen(m);
  },

  // ----- Incidentes y mantenimientos -----
  async 'incidentes.lista'({ unidad }) {
    const items = await byIndex('Incidente', 'byUnidad', 'unidadId', unidad!.id);
    // El residente ve todo el seguimiento (etapa, descripción, fecha y foto de evidencia), sin el nombre ni el
    // correo de quién lo atendió: para él lo hizo «Administración».
    return Promise.all(
      items.sort(newest).map(async ({ historial, evidenciaPath, ...i }) => ({
        ...sinPrivados(i),
        // Foto del reporte: la ve cualquier residente de la unidad (la carpeta de quien la subió es privada).
        fotoUrl: i.fotoPath ? await fotoUrl(i.fotoPath) : null,
        seguimiento: await Promise.all(
          pasosIncidente(historial).map(async (h) => ({
            estado: h.estado,
            respuesta: h.respuesta ?? null,
            en: h.en,
            reabierto: !!h.reabierto,
            foto: h.fotoPath ? await fotoUrl(h.fotoPath) : null,
            fotoPdf: /\.pdf$/i.test(h.fotoPath ?? ''),
          })),
        ),
      })),
    );
  },

  async 'incidentes.crear'({ condominio, unidad, sub, p }) {
    const titulo = str(p.titulo, 140);
    if (!titulo) fail('Describe brevemente el incidente.');
    const fotoPath = p.fotoPath ? await archivoPropio(p.fotoPath, sub, 'incidentes') : undefined;
    const inc = await put('Incidente', {
      condominioId: condominio.id,
      unidadId: unidad!.id,
      userId: sub,
      categoria: str(p.categoria, 60) || 'General',
      titulo,
      descripcion: str(p.descripcion, 3000),
      ubicacion: str(p.ubicacion, 200),
      fotoPath,
      estado: 'ABIERTO',
    });
    return sinPrivados(inc);
  },

  // Reportes de proveedores para los residentes (los últimos 60 días), con sus fotos.
  async 'mantenimientos.trabajos'({ condominio }) {
    const desde = hoyMX(new Date(Date.now() - 60 * 86400000));
    const items = (await byIndex('ReporteProveedor', 'byCondominio', 'condominioId', condominio.id)).filter((r) => r.destino === 'RESIDENTES' && r.fecha >= desde);
    return Promise.all(
      items.sort(newest).map(async (r) => ({
        id: r.id,
        fecha: r.fecha,
        createdAt: r.createdAt,
        servicio: servicioDe(r.tipo, r.tipoOtro),
        descripcion: r.descripcion ?? null,
        proveedor: r.empresa || r.proveedorNombre || 'Proveedor',
        fotos: await Promise.all(listaJson<FotoReporte>(r.fotos).map(async (f) => ({ descripcion: f.descripcion, url: await fotoUrl(f.path) }))),
      })),
    );
  },

  async 'mantenimientos.lista'({ condominio }) {
    const items = await byIndex('Mantenimiento', 'byCondominio', 'condominioId', condominio.id);
    return items.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).map(sinPrivados);
  },

  // ----- Amenidades -----
  async 'amenidades.lista'({ condominio, unidad }) {
    const [amenidades, reservas] = await Promise.all([
      byIndex('Amenidad', 'byCondominio', 'condominioId', condominio.id),
      byIndex('Reserva', 'byUnidad', 'unidadId', unidad!.id),
    ]);
    return {
      amenidades: amenidades.filter((a) => a.activa !== false).map(sinPrivados),
      // Reglamento y términos de uso que el residente acepta al reservar (se abren con amenidades.documento).
      documentos: documentosDe(condominio.documentos)
        .filter((d) => SLOTS_AMENIDADES.includes(d.slot))
        .map(({ slot, titulo }) => ({ slot, titulo })),
      misReservas: reservas
        .sort((a, b) => (b.fecha + b.horaInicio).localeCompare(a.fecha + a.horaInicio))
        .map((r) => ({ ...sinPrivados(r), ...(r.estado === 'PENDIENTE_PAGO' ? { limitePago: limitePago(r).toISOString() } : {}) })),
    };
  },

  // Ahorro de amenidades del condominio: cuánto se ha recaudado por reservas, en qué se ha gastado y cuánto queda.
  async 'amenidades.fondo'({ condominio }) {
    const [pagos, cargos, egresos] = await Promise.all([
      byIndex('Pago', 'byCondominio', 'condominioId', condominio.id),
      byIndex('Cargo', 'byCondominio', 'condominioId', condominio.id),
      byIndex('Egreso', 'byCondominio', 'condominioId', condominio.id),
    ]);
    const f = calcularFondoAmenidades({ pagos: pagos as any, cargos: cargos as any, egresos: egresos as any }, hoyMX().slice(0, 7));
    const gastos = egresos
      .filter((e) => e.fondo === FONDO_AMENIDADES)
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
      .map((e) => {
        let ev: any = e.evidencias;
        for (let k = 0; k < 2 && typeof ev === 'string'; k++) ev = JSON.parse(ev);
        return {
          id: e.id,
          fecha: e.fecha,
          categoria: e.categoria,
          concepto: e.concepto,
          proveedor: e.proveedor ?? null,
          monto: e.monto,
          evidencias: (Array.isArray(ev) ? ev : []).map((x: Item) => ({ path: x.path, nombre: x.nombre })),
        };
      });
    return { ...f, gastos };
  },

  // URL firmada de una evidencia de gasto del fondo de amenidades (transparencia para los residentes).
  async 'amenidades.fondoEvidencia'({ condominio, p }) {
    const e = await get('Egreso', { id: str(p.id, 64) });
    if (!e || e.condominioId !== condominio.id || e.fondo !== FONDO_AMENIDADES) fail('Archivo no disponible.');
    let ev: any = e!.evidencias;
    for (let k = 0; k < 2 && typeof ev === 'string'; k++) ev = JSON.parse(ev);
    const path = str(p.path, 400);
    if (!Array.isArray(ev) || !ev.some((x: Item) => x.path === path)) fail('Archivo no disponible.');
    return { url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.BUCKET!, Key: path }), { expiresIn: 900 }) };
  },

  async 'amenidades.documento'({ condominio, p }) {
    const d = documentosDe(condominio.documentos).find((x) => x.slot === str(p.slot, 30) && SLOTS_AMENIDADES.includes(x.slot));
    if (!d) fail('Documento no disponible.');
    return { url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.BUCKET, Key: d!.path }), { expiresIn: 900 }) };
  },

  // Horarios apartados de una amenidad en un día, incluidas las reservas de la amenidad completa o de sus
  // secciones. Las pendientes de pago vencidas (48 h sin comprobante) se cancelan aquí y no aparecen.
  async 'amenidades.disponibilidad'({ condominio, p }) {
    const am = await get('Amenidad', { id: str(p.amenidadId, 64) });
    if (!am || am.condominioId !== condominio.id) fail('Amenidad no encontrada.');
    const fecha = FECHA.test(p.fecha) ? p.fecha : hoyMX();
    const todas = await byIndex('Amenidad', 'byCondominio', 'condominioId', condominio.id);
    const ids = relacionadas(am!, todas);
    const reservas = (await Promise.all(ids.map((id) => byIndex('Reserva', 'byAmenidad', 'amenidadId', id)))).flat();
    const nombre = (id: string) => todas.find((a) => a.id === id)?.nombre ?? '';
    const delDia = reservas.filter((r) => r.fecha === fecha && ACTIVAS.includes(r.estado));
    const vigentes = [];
    for (const r of delDia) if (!(await vencerSiCorresponde(r))) vigentes.push(r);
    return vigentes
      .map((r) => ({ horaInicio: r.horaInicio, horaFin: r.horaFin, estado: r.estado, por: r.amenidadId === am!.id ? null : nombre(r.amenidadId) }))
      .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));
  },

  // Calendario del mes: horarios apartados por día (desde hoy) de la amenidad, la amenidad completa y sus secciones.
  // No dice qué unidad reservó.
  async 'amenidades.calendario'({ condominio, p }) {
    const am = await get('Amenidad', { id: str(p.amenidadId, 64) });
    if (!am || am.condominioId !== condominio.id) fail('Amenidad no encontrada.');
    const hoy = hoyMX();
    const mes = /^\d{4}-\d{2}$/.test(p.mes) ? p.mes : hoy.slice(0, 7);
    const todas = await byIndex('Amenidad', 'byCondominio', 'condominioId', condominio.id);
    const ids = relacionadas(am!, todas);
    const reservas = (await Promise.all(ids.map((id) => byIndex('Reserva', 'byAmenidad', 'amenidadId', id)))).flat();
    const nombre = (id: string) => todas.find((a) => a.id === id)?.nombre ?? '';
    const delMes = reservas.filter((r) => r.fecha?.startsWith(mes) && r.fecha >= hoy && ACTIVAS.includes(r.estado));
    const vigentes = [];
    for (const r of delMes) if (!(await vencerSiCorresponde(r))) vigentes.push(r);
    return vigentes
      .map((r) => ({ fecha: r.fecha, horaInicio: r.horaInicio, horaFin: r.horaFin, estado: r.estado, por: r.amenidadId === am!.id ? null : nombre(r.amenidadId) }))
      .sort((a, b) => (a.fecha + a.horaInicio).localeCompare(b.fecha + b.horaInicio));
  },

  // Reserva una amenidad, o una o varias secciones de la misma amenidad (una reserva por sección).
  async 'amenidades.reservar'({ condominio, unidad, sub, p }) {
    const pedidas: string[] = Array.isArray(p.amenidadIds) ? p.amenidadIds.map((x: unknown) => str(x, 64)) : [str(p.amenidadId, 64)];
    const unicas = [...new Set(pedidas.filter(Boolean))];
    if (!unicas.length || unicas.length > 10) fail('Elige qué quieres reservar.');
    const todas = await byIndex('Amenidad', 'byCondominio', 'condominioId', condominio.id);
    const ams = unicas.map((id) => todas.find((a) => a.id === id));
    if (ams.some((a) => !a || a.activa === false)) fail('Amenidad no disponible.');
    if (ams.length > 1 && ams.some((a) => !a!.parteDeId || a!.parteDeId !== ams[0]!.parteDeId)) fail('Solo puedes reservar juntas secciones de la misma amenidad.');
    const documentos = documentosDe(condominio.documentos).filter((d) => SLOTS_AMENIDADES.includes(d.slot));
    if (documentos.length && p.aceptaTerminos !== true) fail('Debes aceptar el reglamento y los términos de uso de las amenidades.');

    const fecha = String(p.fecha ?? '');
    const ini = String(p.horaInicio ?? '');
    const fin = String(p.horaFin ?? '');
    if (!FECHA.test(fecha) || fecha < hoyMX()) fail('Elige una fecha a partir de hoy.');
    if (!HORA.test(ini) || !HORA.test(fin) || minutos(ini) >= minutos(fin)) fail('Revisa el horario.');
    const invitados = Math.max(0, Math.floor(Number(p.invitados) || 0));
    for (const am of ams) {
      const n = am!.nombre;
      if (am!.horaApertura && ini < am!.horaApertura) fail(`${n}: el horario inicia a las ${am!.horaApertura}.`);
      if (am!.horaCierre && fin > am!.horaCierre) fail(`${n}: el horario termina a las ${am!.horaCierre}.`);
      if (am!.maxHoras && minutos(fin) - minutos(ini) > am!.maxHoras * 60) fail(`${n}: máximo ${am!.maxHoras} h por reserva.`);
    }
    const capacidad = ams.reduce((s, a) => s + (a!.capacidad || 0), 0);
    if (capacidad && ams.every((a) => a!.capacidad) && invitados > capacidad) fail(`Capacidad máxima: ${capacidad} personas.`);

    // Preferencia a quien pidió primero: cualquier reserva activa de la misma amenidad, de la amenidad completa
    // o de sus secciones aparta el horario (las pendientes de pago, hasta 48 h sin comprobante).
    const pedida = { fecha, horaInicio: ini, horaFin: fin };
    for (const am of ams) {
      const ids = relacionadas(am!, todas);
      const existentes = (await Promise.all(ids.map((id) => byIndex('Reserva', 'byAmenidad', 'amenidadId', id)))).flat();
      const [choca] = await apartadas(existentes, pedida);
      if (choca) {
        const otra = todas.find((a) => a.id === choca.amenidadId)?.nombre;
        const espera = choca.estado === 'APROBADA' ? '' : ' (apartado por otra unidad, en espera de confirmación)';
        fail(
          choca.amenidadId === am!.id
            ? `${am!.nombre} ya está reservada en ese horario${espera}.`
            : `${am!.nombre} no está disponible en ese horario: hay una reserva de ${otra}${espera}.`,
        );
      }
    }

    const juntas = ams.length > 1 ? `Reservada junto con: ${ams.map((a) => a!.nombre).join(', ')}.` : '';
    const nota = [str(p.nota, 500), juntas].filter(Boolean).join(' ');
    // Con costo: se carga al estado de cuenta y el horario se aparta al validar el pago.
    // Sin costo: se aprueba al momento, o queda solicitada si la amenidad requiere aprobación.
    const padre = ams[0]!.parteDeId ? todas.find((a) => a.id === ams[0]!.parteDeId) : undefined;
    const creadas = [];
    for (const am of ams) {
      const costo = Number(am!.costo) > 0 ? Math.round(Number(am!.costo) * 100) / 100 : 0;
      const r = await put('Reserva', {
        condominioId: condominio.id,
        amenidadId: am!.id,
        unidadId: unidad!.id,
        userId: sub,
        fecha,
        horaInicio: ini,
        horaFin: fin,
        invitados,
        // Las gratuitas sin aprobación se confirman enseguida (confirmarReserva); no avisan a la administración.
        estado: !costo && am!.requiereAprobacion ? 'SOLICITADA' : 'PENDIENTE_PAGO',
        nota,
        terminosAceptados: documentos.length ? now() : null,
      });
      if (costo) {
        await put('Cargo', {
          id: cargoDeReserva(r.id),
          condominioId: condominio.id,
          unidadId: unidad!.id,
          concepto: `Reserva ${am!.nombre}${padre ? ` · ${padre.nombre}` : ''} · ${fecha} ${ini}–${fin}`,
          periodo: fecha.slice(0, 7),
          monto: costo,
          vence: fecha,
          estado: 'PENDIENTE',
        });
      } else if (!am!.requiereAprobacion) {
        const c = await confirmarReserva(r);
        if (!c.ok) {
          await update('Reserva', { id: r.id }, { estado: 'CANCELADA' });
          fail(`${am!.nombre} no está disponible en ese horario: hay una reserva de ${c.nombre}.`);
        }
        r.estado = 'APROBADA';
      }
      creadas.push(r);
    }
    const total = creadas.filter((r) => r.estado === 'PENDIENTE_PAGO').length;
    if (total) {
      const monto = ams.reduce((s, a) => s + (Number(a!.costo) > 0 ? Number(a!.costo) : 0), 0);
      await put('Aviso', {
        condominioId: condominio.id,
        unidadId: unidad!.id,
        tipo: 'RESERVA',
        titulo: `Reserva pendiente de pago: ${new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(monto)}`,
        texto: `Ya está en tu estado de cuenta. El ${fecha} de ${ini} a ${fin} queda apartado para ti: sube tu comprobante en Finanzas antes de ${HORAS_APARTADO} horas o la reserva se cancelará automáticamente. Se confirma cuando la administración valide tu pago.`,
        leido: false,
      });
    }
    return creadas.map(sinPrivados);
  },

  async 'amenidades.cancelar'({ unidad, p }) {
    const r = await get('Reserva', { id: str(p.reservaId, 64) });
    if (!r || r.unidadId !== unidad!.id) fail('Reserva no encontrada.');
    if (!ACTIVAS.includes(r!.estado)) fail('La reserva ya no está activa.');
    const cancelada = await update('Reserva', { id: r!.id }, { estado: 'CANCELADA' });
    await cancelarCargoReserva(r!.id);
    return sinPrivados(cancelada);
  },

  // ----- Visitas -----
  async 'visitas.lista'({ unidad }) {
    const items = await byIndex('Visita', 'byUnidad', 'unidadId', unidad!.id);
    const hoy = hoyMX();
    return items
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || newest(a, b))
      .slice(0, 100)
      .map((v) => ({ ...sinPrivados(v), vigente: visitaVigente(v, hoy) }));
  },

  async 'visitas.crear'({ condominio, unidad, sub, p }) {
    const nombre = str(p.nombre, 120);
    if (!nombre) fail('Escribe el nombre de tu visita.');
    const tipo = ['VISITA', 'SERVICIO', 'PROVEEDOR', 'PAQUETERIA'].includes(p.tipo) ? p.tipo : 'VISITA';
    const hoy = hoyMX();
    const fecha = FECHA.test(p.fecha) ? p.fecha : hoy;
    if (fecha < hoy) fail('La fecha no puede ser anterior a hoy.');
    let fechaFin = FECHA.test(p.fechaFin) ? p.fechaFin : undefined;
    if (fechaFin && fechaFin < fecha) fail('La fecha final debe ser posterior a la inicial.');
    if (fechaFin && (Date.parse(fechaFin) - Date.parse(fecha)) / 86400000 > 90) fail('La vigencia máxima es de 90 días.');
    if (fechaFin === fecha) fechaFin = undefined;
    const placas = str(p.placas, 20).toUpperCase();
    if (p.enAuto && !placas) fail('Escribe las placas del auto de tu visita.');
    // Código único para el QR (reintenta en el improbable caso de colisión)
    let codigo = codigoCorto();
    for (let i = 0; i < 3 && (await byIndex('Visita', 'byCodigo', 'codigo', codigo)).length; i++) codigo = codigoCorto();
    const v = await put('Visita', {
      condominioId: condominio.id,
      unidadId: unidad!.id,
      userId: sub,
      tipo,
      nombre,
      placas,
      enAuto: !!p.enAuto || !!placas,
      fecha,
      fechaFin,
      codigo,
      origen: 'RESIDENTE',
      estado: 'PROGRAMADA',
      notas: str(p.notas, 500),
    });
    return { ...sinPrivados(v), vigente: visitaVigente(v) };
  },

  // Alguien llegó sin pase y la caseta pide permiso: el residente autoriza o rechaza el acceso.
  async 'visitas.responder'({ condominio, unidad, perfil, p }) {
    const v = await get('Visita', { id: str(p.visitaId, 64) });
    if (!v || v.unidadId !== unidad!.id) fail('Solicitud no encontrada.');
    if (v!.estado !== 'POR_AUTORIZAR') fail(v!.estado === 'CANCELADA' ? 'La caseta canceló esta solicitud.' : 'Esta solicitud ya fue respondida.');
    const autorizar = !!p.autorizar;
    const nota = str(p.nota, 300) || null;
    const quien = `${perfil.nombre ?? perfil.email} · ${unidad!.etiqueta}`;
    const r = await update(
      'Visita',
      { id: v!.id },
      { estado: autorizar ? 'AUTORIZADA' : 'RECHAZADA', respuestaPor: quien, respuestaEn: now(), respuestaVia: 'RESIDENTE', respuestaNota: nota },
      { estado: 'POR_AUTORIZAR' },
    );
    await avisarCaseta(
      condominio.id,
      autorizar ? `✅ ${unidad!.etiqueta} autorizó el acceso` : `⛔ ${unidad!.etiqueta} rechazó el acceso`,
      `${v!.nombre}${nota ? ` · «${nota}»` : ''}`,
    );
    return sinPrivados(r);
  },

  async 'visitas.cancelar'({ unidad, p }) {
    const v = await get('Visita', { id: str(p.visitaId, 64) });
    if (!v || v.unidadId !== unidad!.id) fail('Visita no encontrada.');
    if (v!.estado === 'DENTRO') fail('La visita está dentro del condominio.');
    return sinPrivados(await update('Visita', { id: v!.id }, { estado: 'CANCELADA' }));
  },

  // ----- Mascota segura -----
  async 'mascotas.lista'({ condominio, unidad }) {
    const items = await byIndex('Mascota', 'byCondominio', 'condominioId', condominio.id);
    const et = await etiquetas(condominio.id);
    return {
      mias: items.filter((m) => m.unidadId === unidad!.id).map(sinPrivados),
      extraviadas: await Promise.all(
        items.filter((m) => m.extraviada && m.estado === 'APROBADA').map((m) => conFoto(m, et[m.unidadId] ?? '')),
      ),
    };
  },

  async 'mascotas.registrar'({ condominio, unidad, sub, p }) {
    const nombre = str(p.nombre, 60);
    if (!nombre) fail('Escribe el nombre de tu mascota.');
    const fotoPath = p.fotoPath ? await archivoPropio(p.fotoPath, sub, 'mascotas') : undefined;
    const m = await put('Mascota', {
      condominioId: condominio.id,
      unidadId: unidad!.id,
      userId: sub,
      nombre,
      especie: str(p.especie, 40) || 'Perro',
      raza: str(p.raza, 60),
      color: str(p.color, 60),
      fotoPath,
      vacunaAntirrabica: FECHA.test(p.vacunaAntirrabica) ? p.vacunaAntirrabica : undefined,
      estado: 'PENDIENTE',
      extraviada: false,
      notas: str(p.notas, 500),
    });
    return sinPrivados(m);
  },

  async 'mascotas.extraviada'({ unidad, p }) {
    const m = await get('Mascota', { id: str(p.mascotaId, 64) });
    if (!m || m.unidadId !== unidad!.id) fail('Mascota no encontrada.');
    if (m!.estado !== 'APROBADA') fail('Tu mascota aún no ha sido aprobada por la administración.');
    return sinPrivados(await update('Mascota', { id: m!.id }, { extraviada: !!p.extraviada }));
  },
};

// Módulo requerido por cada grupo de acciones del residente
const moduloDe = (action: string) => action.split('.')[0];

// ---------- estacionamiento de visitas ----------
// Lugares configurados en el condominio; los ocupa cada visita en auto que está dentro (ocupaLugar).
async function estacionamiento(condominio: Item, visitas?: Item[]) {
  const total = Math.max(0, Math.floor(Number(condominio.estacionamientoVisitas) || 0));
  if (!total) return { total: 0, ocupados: 0, libres: 0 };
  const lista = visitas ?? (await byIndex('Visita', 'byCondominio', 'condominioId', condominio.id));
  const ocupados = lista.filter((v) => v.estado === 'DENTRO' && v.ocupaLugar).length;
  return { total, ocupados, libres: Math.max(0, total - ocupados) };
}
/** Estacionamiento contando ya el cambio recién guardado (el índice por condominio tarda un instante en reflejarlo). */
async function estacionamientoCon(condominio: Item, cambio: Item) {
  const lista = await byIndex('Visita', 'byCondominio', 'condominioId', condominio.id);
  return estacionamiento(condominio, [...lista.filter((v) => v.id !== cambio.id), cambio]);
}
const SIN_LUGAR = 'No hay lugares de estacionamiento de visitas disponibles.';
/** ¿La visita que entra ocupa un lugar? Falla si no hay lugar, salvo que la caseta la registre «sin lugar». */
async function lugarAlEntrar(condominio: Item, enAuto: boolean, sinLugar: boolean) {
  if (!enAuto) return false;
  const e = await estacionamiento(condominio);
  if (!e.total) return false;
  if (e.libres > 0) return true;
  if (!sinLugar) fail(SIN_LUGAR);
  return false;
}

// ---------- acciones de caseta (vigilantes) ----------
const caseta: Record<string, { modulo: string; fn: (ctx: Ctx) => Promise<unknown> }> = {
  'caseta.panel': {
    modulo: 'visitas',
    async fn({ condominio }) {
      const hoy = hoyMX();
      const [visitas, et, mascotas] = await Promise.all([
        byIndex('Visita', 'byCondominio', 'condominioId', condominio.id),
        etiquetas(condominio.id),
        (condominio.modulos ?? []).includes('mascotas')
          ? byIndex('Mascota', 'byCondominio', 'condominioId', condominio.id)
          : [],
      ]);
      const conUnidad = (v: Item) => ({ ...sinPrivados(v), unidad: et[v.unidadId] ?? '' });
      return {
        hoy,
        estacionamiento: await estacionamiento(condominio, visitas),
        // Llegadas sin pase esperando o ya respondidas por el residente (del día)
        solicitudes: visitas
          .filter((v) => ['POR_AUTORIZAR', 'AUTORIZADA', 'RECHAZADA'].includes(v.estado) && v.fecha === hoy)
          .sort((a, b) => String(b.solicitadoEn ?? b.createdAt).localeCompare(String(a.solicitadoEn ?? a.createdAt)))
          .map(conUnidad),
        dentro: visitas.filter((v) => v.estado === 'DENTRO').map(conUnidad),
        esperadas: visitas.filter((v) => visitaVigente(v, hoy)).map(conUnidad),
        bitacora: visitas
          .filter((v) => (v.entradaEn && hoyMX(new Date(v.entradaEn)) === hoy) || (v.salidaEn && hoyMX(new Date(v.salidaEn)) === hoy))
          .sort((a, b) => String(b.entradaEn).localeCompare(String(a.entradaEn)))
          .map(conUnidad),
        unidades: Object.entries(et)
          .map(([id, etiqueta]) => ({ id, etiqueta }))
          .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es', { numeric: true })),
        extraviadas: await Promise.all(
          mascotas.filter((m) => m.extraviada && m.estado === 'APROBADA').map((m) => conFoto(m, et[m.unidadId] ?? '')),
        ),
      };
    },
  },

  'caseta.validar': {
    modulo: 'visitas',
    async fn({ condominio, p }) {
      const codigo = str(p.codigo, 40).toUpperCase().replace(/^SIIA[:-]/, '').replace(/[^A-Z0-9]/g, '');
      if (!codigo) fail('Escanea o escribe un código.');
      const [v] = (await byIndex('Visita', 'byCodigo', 'codigo', codigo)).filter((x) => x.condominioId === condominio.id);
      if (!v) fail('Código no registrado en este condominio.');
      const unidad = await get('Unidad', { id: v!.unidadId });
      return { ...sinPrivados(v!), unidad: unidad?.etiqueta ?? '', vigente: visitaVigente(v!), estacionamiento: await estacionamiento(condominio) };
    },
  },

  'caseta.entrada': {
    modulo: 'visitas',
    async fn({ condominio, perfil, p }) {
      const v = await get('Visita', { id: str(p.visitaId, 64) });
      if (!v || v.condominioId !== condominio.id) fail('Visita no encontrada.');
      if (!visitaVigente(v!)) fail('El pase no está vigente para hoy.');
      const ocupaLugar = await lugarAlEntrar(condominio, !!v!.enAuto, !!p.sinLugar);
      const r = await update('Visita', { id: v!.id }, { estado: 'DENTRO', entradaEn: now(), registradoPor: perfil.nombre ?? perfil.email, ocupaLugar });
      const tipo = v!.tipo === 'VISITA' ? 'Tu visita' : 'Tu servicio';
      await aviso(
        condominio,
        v!.unidadId,
        'VISITA',
        `${tipo} ${v!.nombre} ingresó`,
        ocupaLugar ? 'Registrado en caseta. Ocupa un lugar de estacionamiento de visitas.' : 'Registrado en caseta.',
      );
      return { ...sinPrivados(r), estacionamiento: await estacionamientoCon(condominio, r) };
    },
  },

  'caseta.salida': {
    modulo: 'visitas',
    async fn({ condominio, p }) {
      const v = await get('Visita', { id: str(p.visitaId, 64) });
      if (!v || v.condominioId !== condominio.id) fail('Visita no encontrada.');
      if (v!.estado !== 'DENTRO') fail('La visita no está registrada dentro.');
      // Al salir se libera su lugar de estacionamiento y se avisa al residente
      const r = await update('Visita', { id: v!.id }, { estado: 'SALIO', salidaEn: now(), ocupaLugar: false });
      const tipo = v!.tipo === 'VISITA' ? 'Tu visita' : v!.tipo === 'PROVEEDOR' ? 'Tu proveedor' : 'Tu servicio';
      await aviso(condominio, v!.unidadId, 'VISITA', `${tipo} ${v!.nombre} salió`, 'Salida registrada en caseta.');
      return { ...sinPrivados(r), estacionamiento: await estacionamientoCon(condominio, r) };
    },
  },

  // Llegada sin pase previo. Paquetería: se registra y se avisa a la unidad. Visita, servicio o proveedor: se pide
  // permiso al residente (POR_AUTORIZAR); entra cuando lo autoriza (o la caseta lo confirma por llamada).
  'caseta.registrar': {
    modulo: 'visitas',
    async fn({ condominio, perfil, p }) {
      const unidad = await get('Unidad', { id: str(p.unidadId, 64) });
      if (!unidad || unidad.condominioId !== condominio.id) fail('Selecciona la unidad.');
      const nombre = str(p.nombre, 120);
      if (!nombre) fail('Escribe el nombre.');
      const tipo = ['VISITA', 'SERVICIO', 'PROVEEDOR', 'PAQUETERIA'].includes(p.tipo) ? p.tipo : 'VISITA';
      const quien = perfil.nombre ?? perfil.email;
      const notas = str(p.notas, 500);
      if (tipo === 'PAQUETERIA') {
        const v = await put('Visita', {
          condominioId: condominio.id,
          unidadId: unidad!.id,
          tipo,
          nombre,
          fecha: hoyMX(),
          origen: 'CASETA',
          estado: 'SALIO',
          entradaEn: now(),
          salidaEn: now(),
          registradoPor: quien,
          notas,
        });
        await aviso(condominio, unidad!.id, 'CASETA', `Tienes paquetería en caseta: ${nombre}`, notas || 'Registrado en caseta.');
        return sinPrivados(v);
      }
      const enAuto = !!p.enAuto;
      const placas = str(p.placas, 20).toUpperCase();
      if (enAuto && !placas) fail('Escribe las placas del auto.');
      const v = await put('Visita', {
        condominioId: condominio.id,
        unidadId: unidad!.id,
        tipo,
        nombre,
        placas,
        enAuto,
        fecha: hoyMX(),
        origen: 'CASETA',
        estado: 'POR_AUTORIZAR',
        solicitadoPor: quien,
        solicitadoEn: now(),
        notas,
      });
      const que: Record<string, string> = { VISITA: 'Una visita', SERVICIO: 'Un servicio', PROVEEDOR: 'Un proveedor' };
      const detalle = [enAuto ? `Llega en auto, placas ${placas}` : 'Llega a pie', notas].filter(Boolean).join(' · ');
      await aviso(condominio, unidad!.id, 'ACCESO', `${que[tipo]} pide acceso: ${nombre}`, `${detalle}. Autoriza o rechaza en Visitas.`);
      return sinPrivados(v);
    },
  },

  // La caseta confirma el permiso por llamada (el residente no respondió en la app) o cancela la solicitud.
  'caseta.solicitud': {
    modulo: 'visitas',
    async fn({ condominio, perfil, p }) {
      const v = await get('Visita', { id: str(p.visitaId, 64) });
      if (!v || v.condominioId !== condominio.id) fail('Solicitud no encontrada.');
      if (v!.estado !== 'POR_AUTORIZAR') fail('Esta solicitud ya fue respondida.');
      const quien = perfil.nombre ?? perfil.email;
      if (p.accion === 'LLAMADA') {
        const nota = str(p.nota, 300);
        if (!nota) fail('Escribe con quién hablaste por teléfono.');
        const r = await update(
          'Visita',
          { id: v!.id },
          { estado: 'AUTORIZADA', respuestaPor: quien, respuestaEn: now(), respuestaVia: 'LLAMADA', respuestaNota: nota },
          { estado: 'POR_AUTORIZAR' },
        );
        await aviso(condominio, v!.unidadId, 'VISITA', `Caseta autorizó por teléfono el acceso de ${v!.nombre}`, nota);
        return sinPrivados(r);
      }
      if (p.accion === 'CANCELAR') {
        const r = await update('Visita', { id: v!.id }, { estado: 'CANCELADA', respuestaPor: quien, respuestaEn: now() }, { estado: 'POR_AUTORIZAR' });
        await aviso(condominio, v!.unidadId, 'VISITA', `Se canceló la solicitud de acceso de ${v!.nombre}`, 'La persona ya no está en caseta.');
        return sinPrivados(r);
      }
      fail('Acción no válida.');
    },
  },

  // ----- Registro de vigilancia: cambios de turno (no se editan; solo se agregan notas) -----
  'vigilancia.turnos': {
    modulo: 'visitas',
    async fn({ condominio }) {
      const items = (await byIndex('TurnoVigilancia', 'byCondominio', 'condominioId', condominio.id)).sort(newest).slice(0, 60);
      return Promise.all(
        items.map(async ({ fotoGuardiaPath, fotoCasetaPath, registradoId, ...t }) => ({
          ...sinPrivados(t),
          fotoGuardiaUrl: await fotoUrl(fotoGuardiaPath),
          fotoCasetaUrl: await fotoUrl(fotoCasetaPath),
        })),
      );
    },
  },

  'vigilancia.cambioTurno': {
    modulo: 'visitas',
    async fn({ condominio, perfil, sub, p }) {
      const entra = str(p.entra, 120);
      const sale = str(p.sale, 120);
      if (!entra) fail('Escribe el nombre de quien recibe el turno.');
      if (!sale) fail('Escribe el nombre de quien entrega el turno.');
      if (!p.fotoGuardiaPath) fail('Toma la foto del guardia en la caseta.');
      if (!p.fotoCasetaPath) fail('Toma la foto de la caseta limpia.');
      if (!p.casetaLimpia) fail('Confirma que la caseta se entrega limpia y en orden.');
      const fotoGuardiaPath = await archivoPropio(p.fotoGuardiaPath, sub, 'vigilancia');
      const fotoCasetaPath = await archivoPropio(p.fotoCasetaPath, sub, 'vigilancia');
      const quien = perfil.nombre ?? perfil.email;
      const texto = str(p.nota, 2000);
      const visitas = await byIndex('Visita', 'byCondominio', 'condominioId', condominio.id);
      const t = await put('TurnoVigilancia', {
        condominioId: condominio.id,
        entra,
        sale,
        registradoPor: quien,
        registradoId: sub,
        fotoGuardiaPath,
        fotoCasetaPath,
        casetaLimpia: true,
        equipo: (Array.isArray(p.equipo) ? p.equipo : []).map((x: unknown) => str(x, 60)).filter(Boolean).slice(0, 15),
        notas: JSON.stringify(texto ? [{ texto, en: now(), por: quien }] : []),
        // Situación al momento del cambio (la registra el sistema)
        visitasDentro: visitas.filter((v) => v.estado === 'DENTRO').length,
        lugaresOcupados: (await estacionamiento(condominio, visitas)).ocupados,
      });
      const { fotoGuardiaPath: _g, fotoCasetaPath: _c, registradoId: _r, ...publico } = t;
      return sinPrivados(publico);
    },
  },

  // Agregar una nota a un cambio de turno (lo anterior no se modifica).
  'vigilancia.nota': {
    modulo: 'visitas',
    async fn({ condominio, perfil, p }) {
      const t = await get('TurnoVigilancia', { id: str(p.turnoId, 64) });
      if (!t || t.condominioId !== condominio.id) fail('Turno no encontrado.');
      const texto = str(p.texto, 2000);
      if (!texto) fail('Escribe la nota.');
      let notas: any = t!.notas;
      for (let k = 0; k < 2 && typeof notas === 'string'; k++) notas = JSON.parse(notas);
      const lista = [...(Array.isArray(notas) ? notas : []), { texto, en: now(), por: perfil.nombre ?? perfil.email }];
      if (lista.length > 100) fail('Este turno ya tiene el máximo de notas.');
      await update('TurnoVigilancia', { id: t!.id }, { notas: JSON.stringify(lista) });
      return { notas: lista };
    },
  },

  // Aviso de servicios: la caseta avisa a TODOS los residentes que acaba de entrar un servicio del condominio.
  'caseta.servicio': {
    modulo: 'visitas',
    async fn({ condominio, perfil, p }) {
      const servicios: string[] = (condominio.serviciosCondominio ?? []).filter(Boolean);
      const servicio = str(p.servicio, 60);
      if (!servicios.includes(servicio)) fail('Elige un servicio de la lista del condominio.');
      const nota = str(p.nota, 300);
      const imagen = imagenServicio(servicio);
      const conocido = IMAGENES_SERVICIO.find((x) => `/servicios/${x.clave}.jpg` === imagen);
      const titulo = conocido ? `${conocido.titulo} 🚪` : `Acaba de entrar el servicio de ${servicio.toLowerCase()}`;
      const unidades = await byIndex('Unidad', 'byCondominio', 'condominioId', condominio.id);
      for (let i = 0; i < unidades.length; i += 25) {
        await Promise.all(
          unidades.slice(i, i + 25).map((u) =>
            put('Aviso', {
              condominioId: condominio.id,
              unidadId: u.id,
              tipo: 'SERVICIO',
              titulo,
              texto: nota || `${servicio} · aviso de caseta`,
              imagen,
              leido: false,
            }),
          ),
        );
      }
      return { enviados: unidades.length, servicio, imagen };
    },
  },

  'caseta.alertar': {
    modulo: 'visitas',
    async fn({ condominio, p }) {
      const unidad = await get('Unidad', { id: str(p.unidadId, 64) });
      if (!unidad || unidad.condominioId !== condominio.id) fail('Selecciona la unidad.');
      const titulo = str(p.titulo, 140);
      if (!titulo) fail('Escribe el aviso.');
      await aviso(condominio, unidad!.id, 'CASETA', titulo, str(p.texto, 1000));
      return { ok: true };
    },
  },

  'caseta.hilos': {
    modulo: 'chat',
    async fn({ condominio }) {
      const [mensajes, et] = await Promise.all([
        byIndex('Mensaje', 'byCondominio', 'condominioId', condominio.id),
        etiquetas(condominio.id),
      ]);
      const hilos = new Map<string, Item>();
      for (const m of mensajes.filter((x) => x.canal === 'CASETA').sort(newest)) {
        if (!hilos.has(m.unidadId)) hilos.set(m.unidadId, { unidadId: m.unidadId, unidad: et[m.unidadId] ?? '', ultimo: sinPrivados(m) });
      }
      return [...hilos.values()];
    },
  },

  'caseta.mensajes': {
    modulo: 'chat',
    async fn({ condominio, p }) {
      const items = await byIndex('Mensaje', 'byHilo', 'hilo', `${condominio.id}#${str(p.unidadId, 64)}#CASETA`);
      return Promise.all(items.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-200).map(conImagen));
    },
  },

  'caseta.enviar': {
    modulo: 'chat',
    async fn({ condominio, perfil, sub, p }) {
      const unidad = await get('Unidad', { id: str(p.unidadId, 64) });
      if (!unidad || unidad.condominioId !== condominio.id) fail('Selecciona la unidad.');
      const contenido = await contenidoMensaje(p, sub);
      const m = await put('Mensaje', {
        condominioId: condominio.id,
        unidadId: unidad!.id,
        canal: 'CASETA',
        hilo: `${condominio.id}#${unidad!.id}#CASETA`,
        autorId: sub,
        autorNombre: `Caseta · ${perfil.nombre ?? ''}`.trim(),
        autorRol: 'VIGILANTE',
        ...contenido,
      });
      return conImagen(m);
    },
  },
};

// ---------- perfil (también para cuentas aún no aprobadas) ----------
async function perfilActual(sub: string, email: string) {
  const perfil = await get('Perfil', { userId: sub });
  if (!perfil) return { email, perfil: null };
  // Perfiles antiguos sin correo: se completa con el de Cognito
  if (!perfil.email && email) await update('Perfil', { userId: sub }, { email });
  const [condominio, unidad] = await Promise.all([
    perfil.condominioId ? get('Condominio', { id: perfil.condominioId }) : undefined,
    perfil.unidadId ? get('Unidad', { id: perfil.unidadId }) : undefined,
  ]);
  return {
    email,
    perfil: sinPrivados(perfil),
    condominio: condominio ? pub(condominio) : null,
    unidad: unidad ? { id: unidad.id, etiqueta: unidad.etiqueta, cuota: condominio?.cuotaMensual ?? unidad.cuota } : null,
  };
}

// ---------- proveedores (siia.casa/proveedores; ver shared/proveedores.ts) ----------
type CtxProveedor = { sub: string; perfil: Item; p: Item };
/** Condominios activos que atiende el proveedor. */
async function condominiosProveedor(perfil: Item) {
  const ids: string[] = perfil.condominiosServicio ?? [];
  const condos = await Promise.all(ids.map((id) => get('Condominio', { id })));
  return condos.filter((c): c is Item => !!c && c.activo !== false && operando(c));
}
async function condominioDelProveedor(perfil: Item, id: unknown) {
  const c = (await condominiosProveedor(perfil)).find((x) => x.id === str(id, 64));
  if (!c) fail('Elige uno de los condominios que atiendes.');
  return c!;
}
const TIPOS_FOTO_REPORTE: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' };

const proveedor: Record<string, (c: CtxProveedor) => Promise<unknown>> = {
  async 'proveedor.inicio'({ perfil }) {
    return {
      nombre: perfil.nombre ?? null,
      email: perfil.email,
      empresa: perfil.empresa ?? null,
      servicios: perfil.servicios ?? [],
      condominios: (await condominiosProveedor(perfil)).map((c) => ({ id: c.id, nombre: c.nombre })),
    };
  },

  // URL firmada para subir una foto del reporte (10 minutos, 10 MB).
  async 'proveedor.subirFoto'({ sub, perfil, p }) {
    const c = await condominioDelProveedor(perfil, p.condominioId);
    const nombre = str(p.nombre, 120).normalize('NFD').replace(/[^\w.-]+/g, '_') || 'foto.jpg';
    const ext = nombre.split('.').pop()?.toLowerCase() ?? '';
    if (!TIPOS_FOTO_REPORTE[ext]) fail('Sube una foto (JPG, PNG, WEBP o HEIC).');
    if (!(Number(p.tamano) > 0) || Number(p.tamano) > MAX_FOTO_REPORTE) fail('Cada foto debe pesar máximo 10 MB.');
    const path = `condominios/${c.id}/proveedores/${sub}/${randomUUID()}-${nombre}`;
    const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: process.env.BUCKET!, Key: path, ContentType: TIPOS_FOTO_REPORTE[ext] }), { expiresIn: 600 });
    return { url, path, contentType: TIPOS_FOTO_REPORTE[ext] };
  },

  // Enviar = guardar: el reporte queda en su bitácora y ya no se modifica.
  async 'proveedor.enviar'({ sub, perfil, p }) {
    const c = await condominioDelProveedor(perfil, p.condominioId);
    const destino = p.destino === 'RESIDENTES' ? 'RESIDENTES' : p.destino === 'ADMIN' ? 'ADMIN' : '';
    if (!destino) fail('Elige para quién es el reporte.');
    const tipo = str(p.tipo, 60);
    const tipoOtro = tipo === OTRO_SERVICIO ? str(p.tipoOtro, 80) : '';
    // Solo los mantenimientos que le asignó la administración («Otro» también se asigna).
    if (!tipo || !(perfil.servicios ?? []).includes(tipo)) fail('Elige uno de los mantenimientos que tienes asignados.');
    if (tipo === OTRO_SERVICIO && !tipoOtro) fail('Escribe qué tipo de mantenimiento realizaste.');
    const descripcion = str(p.descripcion, 2000);
    if (!descripcion) fail('Escribe una descripción del trabajo.');
    const fotos: FotoReporte[] = (Array.isArray(p.fotos) ? p.fotos : []).map((f: Item) => ({ path: str(f?.path, 400), descripcion: str(f?.descripcion, 1000) }));
    if (!fotos.length) fail('Agrega al menos una foto.');
    if (fotos.length > MAX_FOTOS_REPORTE) fail(`Máximo ${MAX_FOTOS_REPORTE} fotos por reporte.`);
    for (const [i, f] of fotos.entries()) {
      if (!f.path.startsWith(`condominios/${c.id}/proveedores/${sub}/`)) fail(`La foto ${i + 1} no es válida.`);
      if (!f.descripcion) fail(`Escribe la descripción de la foto ${i + 1}.`);
      const h = await s3.send(new HeadObjectCommand({ Bucket: process.env.BUCKET!, Key: f.path })).catch(() => undefined);
      if (!h) fail(`No encontramos la foto ${i + 1}. Vuelve a subirla.`);
    }
    const reporte = await put('ReporteProveedor', {
      condominioId: c.id,
      proveedorId: sub,
      proveedorNombre: perfil.nombre || perfil.email,
      empresa: perfil.empresa || null,
      destino,
      tipo,
      tipoOtro: tipoOtro || null,
      descripcion,
      fecha: hoyMX(),
      fotos: JSON.stringify(fotos),
    });
    // El reporte para residentes les llega como aviso (campana y notificación) si el condominio tiene Mantenimientos.
    if (destino === 'RESIDENTES' && (c.modulos ?? []).includes('mantenimientos')) {
      const unidades = await byIndex('Unidad', 'byCondominio', 'condominioId', c.id);
      const titulo = `Trabajo realizado: ${servicioDe(tipo, tipoOtro)}`.slice(0, 140);
      const texto = `${descripcion.slice(0, 600)}${perfil.empresa ? ` · ${perfil.empresa}` : ''}`;
      for (let i = 0; i < unidades.length; i += 25) {
        await Promise.all(unidades.slice(i, i + 25).map((u) => put('Aviso', { condominioId: c.id, unidadId: u.id, tipo: 'TRABAJO', titulo, texto, leido: false })));
      }
    }
    return { id: reporte.id, fecha: reporte.fecha, destino };
  },

  // Su bitácora: reportes de un mes (AAAA-MM) con sus fotos.
  async 'proveedor.mios'({ sub, perfil, p }) {
    const mes = /^\d{4}-\d{2}$/.test(p.mes) ? p.mes : hoyMX().slice(0, 7);
    const nombres = new Map((await condominiosProveedor(perfil)).map((c) => [c.id, c.nombre]));
    const items = (await byIndex('ReporteProveedor', 'byProveedor', 'proveedorId', sub)).filter((r) => String(r.fecha).startsWith(mes));
    return Promise.all(
      items.sort(newest).map(async ({ __typename, ...r }) => ({
        ...r,
        condominio: nombres.get(r.condominioId) ?? 'Condominio',
        fotos: await Promise.all(listaJson<FotoReporte>(r.fotos).map(async (f) => ({ descripcion: f.descripcion, url: await fotoUrl(f.path) }))),
      })),
    );
  },
};

// ---------- entrada ----------
export const handler = async (event: AppSyncResolverEvent<{ action: string; payload?: unknown }>) => {
  const identity = event.identity as any;
  const sub: string = identity?.sub;
  const claimEmail: string = identity?.claims?.email ?? '';
  const action = String(event.arguments.action ?? '');
  const p = parsePayload(event.arguments.payload);

  try {
    if (!sub) fail('Sesión no válida.');

    const email = async () => claimEmail || (await emailDe(sub));
    if (action === 'perfil') return sinFirmas(await perfilActual(sub, await email()));

    // A partir de aquí: solo usuarios aprobados de un condominio activo
    const perfil = await get('Perfil', { userId: sub });
    if (!perfil || perfil.estado !== 'APROBADO') fail('Tu acceso aún no ha sido autorizado por la administración.');
    if (perfil!.rol === 'PROVEEDOR') {
      // Puede instalar la app; por ahora no recibe notificaciones (sin categorías).
      if (action.startsWith('notificaciones.')) return await accionNotificaciones(action, p, sub, [], '/proveedores/');
      const fn = proveedor[action];
      if (!fn) fail('Acción no permitida.');
      return await fn({ sub, perfil: perfil!, p });
    }
    if (action.startsWith('proveedor.')) fail('Acción no permitida.');
    const condominio = await get('Condominio', { id: perfil!.condominioId });
    if (!condominio || condominio.activo === false || enPapelera(condominio)) fail('Tu condominio no tiene el portal activo.');
    if (suspendido(condominio)) fail('El portal de tu condominio está suspendido. Comunícate con la administración.');
    const modulos: string[] = condominio!.modulos ?? [];
    const ctx: Ctx = { sub, email: perfil!.email, perfil: perfil!, condominio: condominio!, p };

    // App y notificaciones push (cualquier usuario aprobado del portal).
    if (action.startsWith('notificaciones.')) {
      const esVigilante = perfil!.rol === 'VIGILANTE';
      const categorias = esVigilante
        ? CATEGORIAS_VIGILANTE.filter((c) => c.key !== 'chat' || modulos.includes('chat'))
        : CATEGORIAS_RESIDENTE.filter((c) => c.key !== 'chat' || modulos.includes('chat'));
      return await accionNotificaciones(action, p, sub, categorias, esVigilante ? '/portal/#hoy' : '/portal/#inicio');
    }

    if (perfil!.rol === 'VIGILANTE') {
      const a = caseta[action];
      if (!a) fail('Acción no permitida.');
      if (!modulos.includes(a!.modulo)) fail('Este servicio no está habilitado para tu condominio.');
      return sinFirmas(await a!.fn(ctx));
    }

    if (perfil!.rol === 'RESIDENTE') {
      const fn = residente[action];
      if (!fn) fail('Acción no permitida.');
      const modulo = moduloDe(action);
      if (modulo !== 'inicio' && !modulos.includes(modulo)) fail('Este servicio no está habilitado para tu condominio.');
      ctx.unidad = perfil!.unidadId ? await get('Unidad', { id: perfil!.unidadId }) : undefined;
      if (!ctx.unidad || ctx.unidad.condominioId !== condominio!.id) fail('Tu cuenta no tiene una unidad asignada.');
      return sinFirmas(await fn(ctx));
    }

    fail('Acción no permitida.');
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    console.error(action, err);
    return { error: 'Ocurrió un error. Intenta de nuevo.' };
  }
};
