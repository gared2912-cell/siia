// API del portal para residentes y vigilantes.
// Punto único de control: nadie accede a datos si un administrador no lo aprobó,
// y cada módulo solo responde si la administración lo habilitó para su condominio.
import type { AppSyncResolverEvent } from 'aws-lambda';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
import { emailDe } from '../shared/cognito';

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
});

const sinPrivados = ({ userId, __typename, ...rest }: Item) => rest;

// ---------- utilidades ----------
const s3 = new S3Client({});
async function fotoUrl(path?: string) {
  if (!path || !process.env.BUCKET) return undefined;
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.BUCKET, Key: path }), { expiresIn: 3600 });
}
const conFoto = async (m: Item, unidad: string) => ({ ...sinPrivados(m), fotoPath: undefined, fotoUrl: await fotoUrl(m.fotoPath), unidad });

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

function visitaVigente(v: Item, hoy = hoyMX()) {
  if (v.estado === 'CANCELADA' || v.estado === 'DENTRO') return false;
  const fin = v.fechaFin || v.fecha;
  if (hoy < v.fecha || hoy > fin) return false;
  return v.estado === 'PROGRAMADA' || (v.estado === 'SALIO' && fin > v.fecha);
}

async function aviso(c: Item, unidadId: string, tipo: string, titulo: string, texto?: string) {
  await put('Aviso', { condominioId: c.id, unidadId, tipo, titulo, texto, leido: false });
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
        .filter((r) => r.fecha >= hoy && ['SOLICITADA', 'APROBADA'].includes(r.estado))
        .sort((a, b) => (a.fecha + a.horaInicio).localeCompare(b.fecha + b.horaInicio))
        .slice(0, 3)
        .map(sinPrivados),
      comunicados: comunicados.sort(newest).slice(0, 3).map(sinPrivados),
    };
  },

  async 'inicio.avisos'({ unidad }) {
    const avisos = await byIndex('Aviso', 'byUnidad', 'unidadId', unidad!.id);
    return { sinLeer: avisos.filter((a) => !a.leido).length, avisos: avisos.sort(newest).slice(0, 25).map(sinPrivados) };
  },

  async 'inicio.leerAvisos'({ unidad }) {
    const avisos = await byIndex('Aviso', 'byUnidad', 'unidadId', unidad!.id);
    await Promise.all(avisos.filter((a) => !a.leido).map((a) => update('Aviso', { id: a.id }, { leido: true })));
    return { ok: true };
  },

  // ----- Finanzas -----
  async 'finanzas.estadoCuenta'({ unidad, condominio }) {
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
      cuota: unidad!.cuota ?? null,
    };
  },

  async 'finanzas.registrarPago'({ unidad, condominio, sub, p }) {
    const monto = Number(p.monto);
    if (!(monto > 0) || monto > 1_000_000) fail('Indica un monto válido.');
    const comprobantePath = str(p.comprobantePath, 300);
    if (!comprobantePath.startsWith('residentes/')) fail('Adjunta tu comprobante de pago.');
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
    return items.sort(newest).map(sinPrivados);
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
  async 'chat.mensajes'({ condominio, unidad, p }) {
    const canal = p.canal === 'CASETA' ? 'CASETA' : 'ADMIN';
    const items = await byIndex('Mensaje', 'byHilo', 'hilo', `${condominio.id}#${unidad!.id}#${canal}`);
    return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-200).map(sinPrivados);
  },

  async 'chat.enviar'({ condominio, unidad, perfil, sub, p }) {
    const canal = p.canal === 'CASETA' ? 'CASETA' : 'ADMIN';
    const texto = str(p.texto, 2000);
    if (!texto) fail('Escribe un mensaje.');
    const m = await put('Mensaje', {
      condominioId: condominio.id,
      unidadId: unidad!.id,
      canal,
      hilo: `${condominio.id}#${unidad!.id}#${canal}`,
      autorId: sub,
      autorNombre: `${perfil.nombre ?? perfil.email} · ${unidad!.etiqueta}`,
      autorRol: 'RESIDENTE',
      texto,
    });
    return sinPrivados(m);
  },

  // ----- Incidentes y mantenimientos -----
  async 'incidentes.lista'({ unidad }) {
    const items = await byIndex('Incidente', 'byUnidad', 'unidadId', unidad!.id);
    return items.sort(newest).map(sinPrivados);
  },

  async 'incidentes.crear'({ condominio, unidad, sub, p }) {
    const titulo = str(p.titulo, 140);
    if (!titulo) fail('Describe brevemente el incidente.');
    const fotoPath = str(p.fotoPath, 300);
    const inc = await put('Incidente', {
      condominioId: condominio.id,
      unidadId: unidad!.id,
      userId: sub,
      categoria: str(p.categoria, 60) || 'General',
      titulo,
      descripcion: str(p.descripcion, 3000),
      ubicacion: str(p.ubicacion, 200),
      fotoPath: fotoPath.startsWith('residentes/') ? fotoPath : undefined,
      estado: 'ABIERTO',
    });
    return sinPrivados(inc);
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
      misReservas: reservas
        .sort((a, b) => (b.fecha + b.horaInicio).localeCompare(a.fecha + a.horaInicio))
        .map(sinPrivados),
    };
  },

  async 'amenidades.disponibilidad'({ condominio, p }) {
    const am = await get('Amenidad', { id: str(p.amenidadId, 64) });
    if (!am || am.condominioId !== condominio.id) fail('Amenidad no encontrada.');
    const fecha = FECHA.test(p.fecha) ? p.fecha : hoyMX();
    const reservas = await byIndex('Reserva', 'byAmenidad', 'amenidadId', am!.id);
    return reservas
      .filter((r) => r.fecha === fecha && ['SOLICITADA', 'APROBADA'].includes(r.estado))
      .map((r) => ({ horaInicio: r.horaInicio, horaFin: r.horaFin, estado: r.estado }))
      .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));
  },

  async 'amenidades.reservar'({ condominio, unidad, sub, p }) {
    const am = await get('Amenidad', { id: str(p.amenidadId, 64) });
    if (!am || am.condominioId !== condominio.id || am.activa === false) fail('Amenidad no disponible.');
    const fecha = String(p.fecha ?? '');
    const ini = String(p.horaInicio ?? '');
    const fin = String(p.horaFin ?? '');
    if (!FECHA.test(fecha) || fecha < hoyMX()) fail('Elige una fecha a partir de hoy.');
    if (!HORA.test(ini) || !HORA.test(fin) || minutos(ini) >= minutos(fin)) fail('Revisa el horario.');
    if (am!.horaApertura && ini < am!.horaApertura) fail(`El horario inicia a las ${am!.horaApertura}.`);
    if (am!.horaCierre && fin > am!.horaCierre) fail(`El horario termina a las ${am!.horaCierre}.`);
    if (am!.maxHoras && minutos(fin) - minutos(ini) > am!.maxHoras * 60) fail(`Máximo ${am!.maxHoras} h por reserva.`);
    const invitados = Math.max(0, Math.floor(Number(p.invitados) || 0));
    if (am!.capacidad && invitados > am!.capacidad) fail(`Capacidad máxima: ${am!.capacidad} personas.`);
    const existentes = await byIndex('Reserva', 'byAmenidad', 'amenidadId', am!.id);
    const choca = existentes.some(
      (r) =>
        r.fecha === fecha &&
        ['SOLICITADA', 'APROBADA'].includes(r.estado) &&
        minutos(ini) < minutos(r.horaFin) &&
        minutos(r.horaInicio) < minutos(fin),
    );
    if (choca) fail('Ese horario ya está reservado.');
    const r = await put('Reserva', {
      condominioId: condominio.id,
      amenidadId: am!.id,
      unidadId: unidad!.id,
      userId: sub,
      fecha,
      horaInicio: ini,
      horaFin: fin,
      invitados,
      estado: am!.requiereAprobacion ? 'SOLICITADA' : 'APROBADA',
      nota: str(p.nota, 500),
    });
    return sinPrivados(r);
  },

  async 'amenidades.cancelar'({ unidad, p }) {
    const r = await get('Reserva', { id: str(p.reservaId, 64) });
    if (!r || r.unidadId !== unidad!.id) fail('Reserva no encontrada.');
    if (!['SOLICITADA', 'APROBADA'].includes(r!.estado)) fail('La reserva ya no está activa.');
    return sinPrivados(await update('Reserva', { id: r!.id }, { estado: 'CANCELADA' }));
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
    // Código único para el QR (reintenta en el improbable caso de colisión)
    let codigo = codigoCorto();
    for (let i = 0; i < 3 && (await byIndex('Visita', 'byCodigo', 'codigo', codigo)).length; i++) codigo = codigoCorto();
    const v = await put('Visita', {
      condominioId: condominio.id,
      unidadId: unidad!.id,
      userId: sub,
      tipo,
      nombre,
      placas: str(p.placas, 20).toUpperCase(),
      fecha,
      fechaFin,
      codigo,
      origen: 'RESIDENTE',
      estado: 'PROGRAMADA',
      notas: str(p.notas, 500),
    });
    return { ...sinPrivados(v), vigente: visitaVigente(v) };
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
    const fotoPath = str(p.fotoPath, 300);
    const m = await put('Mascota', {
      condominioId: condominio.id,
      unidadId: unidad!.id,
      userId: sub,
      nombre,
      especie: str(p.especie, 40) || 'Perro',
      raza: str(p.raza, 60),
      color: str(p.color, 60),
      fotoPath: fotoPath.startsWith('residentes/') ? fotoPath : undefined,
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
      return { ...sinPrivados(v!), unidad: unidad?.etiqueta ?? '', vigente: visitaVigente(v!) };
    },
  },

  'caseta.entrada': {
    modulo: 'visitas',
    async fn({ condominio, perfil, p }) {
      const v = await get('Visita', { id: str(p.visitaId, 64) });
      if (!v || v.condominioId !== condominio.id) fail('Visita no encontrada.');
      if (!visitaVigente(v!)) fail('El pase no está vigente para hoy.');
      const r = await update('Visita', { id: v!.id }, { estado: 'DENTRO', entradaEn: now(), registradoPor: perfil.nombre ?? perfil.email });
      const tipo = v!.tipo === 'VISITA' ? 'Tu visita' : 'Tu servicio';
      await aviso(condominio, v!.unidadId, 'VISITA', `${tipo} ${v!.nombre} ingresó`, `Registrado en caseta.`);
      return sinPrivados(r);
    },
  },

  'caseta.salida': {
    modulo: 'visitas',
    async fn({ condominio, p }) {
      const v = await get('Visita', { id: str(p.visitaId, 64) });
      if (!v || v.condominioId !== condominio.id) fail('Visita no encontrada.');
      if (v!.estado !== 'DENTRO') fail('La visita no está registrada dentro.');
      return sinPrivados(await update('Visita', { id: v!.id }, { estado: 'SALIO', salidaEn: now() }));
    },
  },

  // Llegada sin pase previo (visita, servicio, paquetería): se registra y se alerta a la unidad.
  'caseta.registrar': {
    modulo: 'visitas',
    async fn({ condominio, perfil, p }) {
      const unidad = await get('Unidad', { id: str(p.unidadId, 64) });
      if (!unidad || unidad.condominioId !== condominio.id) fail('Selecciona la unidad.');
      const nombre = str(p.nombre, 120);
      if (!nombre) fail('Escribe el nombre.');
      const tipo = ['VISITA', 'SERVICIO', 'PROVEEDOR', 'PAQUETERIA'].includes(p.tipo) ? p.tipo : 'VISITA';
      const paqueteria = tipo === 'PAQUETERIA';
      const v = await put('Visita', {
        condominioId: condominio.id,
        unidadId: unidad!.id,
        tipo,
        nombre,
        placas: str(p.placas, 20).toUpperCase(),
        fecha: hoyMX(),
        origen: 'CASETA',
        estado: paqueteria ? 'SALIO' : 'DENTRO',
        entradaEn: now(),
        salidaEn: paqueteria ? now() : undefined,
        registradoPor: perfil.nombre ?? perfil.email,
        notas: str(p.notas, 500),
      });
      const titulos: Record<string, string> = {
        VISITA: `Llegó tu visita: ${nombre}`,
        SERVICIO: `Llegó un servicio: ${nombre}`,
        PROVEEDOR: `Llegó un proveedor: ${nombre}`,
        PAQUETERIA: `Tienes paquetería en caseta: ${nombre}`,
      };
      await aviso(condominio, unidad!.id, 'CASETA', titulos[tipo], str(p.notas, 500) || 'Registrado en caseta.');
      return sinPrivados(v);
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
      return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-200).map(sinPrivados);
    },
  },

  'caseta.enviar': {
    modulo: 'chat',
    async fn({ condominio, perfil, sub, p }) {
      const unidad = await get('Unidad', { id: str(p.unidadId, 64) });
      if (!unidad || unidad.condominioId !== condominio.id) fail('Selecciona la unidad.');
      const texto = str(p.texto, 2000);
      if (!texto) fail('Escribe un mensaje.');
      const m = await put('Mensaje', {
        condominioId: condominio.id,
        unidadId: unidad!.id,
        canal: 'CASETA',
        hilo: `${condominio.id}#${unidad!.id}#CASETA`,
        autorId: sub,
        autorNombre: `Caseta · ${perfil.nombre ?? ''}`.trim(),
        autorRol: 'VIGILANTE',
        texto,
      });
      return sinPrivados(m);
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
    unidad: unidad ? { id: unidad.id, etiqueta: unidad.etiqueta, cuota: unidad.cuota } : null,
  };
}

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
    if (action === 'perfil') return await perfilActual(sub, await email());

    // A partir de aquí: solo usuarios aprobados de un condominio activo
    const perfil = await get('Perfil', { userId: sub });
    if (!perfil || perfil.estado !== 'APROBADO') fail('Tu acceso aún no ha sido autorizado por la administración.');
    const condominio = await get('Condominio', { id: perfil!.condominioId });
    if (!condominio || condominio.activo === false) fail('Tu condominio no tiene el portal activo.');
    const modulos: string[] = condominio!.modulos ?? [];
    const ctx: Ctx = { sub, email: perfil!.email, perfil: perfil!, condominio: condominio!, p };

    if (perfil!.rol === 'VIGILANTE') {
      const a = caseta[action];
      if (!a) fail('Acción no permitida.');
      if (!modulos.includes(a!.modulo)) fail('Este servicio no está habilitado para tu condominio.');
      return await a!.fn(ctx);
    }

    if (perfil!.rol === 'RESIDENTE') {
      const fn = residente[action];
      if (!fn) fail('Acción no permitida.');
      const modulo = moduloDe(action);
      if (modulo !== 'inicio' && !modulos.includes(modulo)) fail('Este servicio no está habilitado para tu condominio.');
      ctx.unidad = perfil!.unidadId ? await get('Unidad', { id: perfil!.unidadId }) : undefined;
      if (!ctx.unidad || ctx.unidad.condominioId !== condominio!.id) fail('Tu cuenta no tiene una unidad asignada.');
      return await fn(ctx);
    }

    fail('Acción no permitida.');
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    console.error(action, err);
    return { error: 'Ocurrió un error. Intenta de nuevo.' };
  }
};
