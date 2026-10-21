// API de administración (/admin). AppSync solo deja entrar a los grupos SUPERADMIN y ADMIN;
// aquí se aplica lo fino: un ADMIN solo usa las secciones y acciones de su rol de administración
// (RolAdmin) y solo en sus condominios asignados. Los ADMIN no leen tablas directo: todo su CRUD
// pasa por la acción `db`, que valida permiso, condominio y campos, y escribe con el cliente de datos
// (mismas validaciones del esquema que AppSync).
import type { AppSyncResolverEvent } from 'aws-lambda';
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  ListUsersCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminUserGlobalSignOutCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomInt, randomUUID } from 'node:crypto';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';
import { cognito, emailDe } from '../shared/cognito';
import { accionNotificaciones } from '../shared/push';
import { CATEGORIAS_ADMIN } from '../shared/notificaciones';
import { claveUnidad, etiquetaUnidad } from '../shared/unidades';
import { SLOTS_AMENIDADES, SLOTS_DOC, documentosDe, type Documento } from '../shared/documentos';
import { nombreAdjunto } from '../shared/comunicados';
import { crearCuotas } from '../shared/cuotas';
import { cancelarCargoReserva, choqueAprobado, confirmarReserva } from '../shared/reservas';
import { MAX_ACCESOS, TIPOS_ACCESO, accesosDe, claveCodigo, estadoDeAcceso } from '../shared/accesos';
import { MIN_CUOTAS_DEFECTO, jsonCorte, type AccesoCorte, type Corte, type CriterioCorte, type EstadoCorte, type FilaCorte, type ResumenCorte } from '../shared/cortes';
import { CATEGORIAS_EGRESO, FONDO_AMENIDADES, MAX_EVIDENCIAS_EGRESO, TIPOS_CARGO_MANUAL, tipoDeCargo } from '../shared/finanzas';
import { guardarActividad } from '../shared/actividad';
import { enPapelera, fechaBorrado, jsonDe, suspendido, type OrdenPapelera } from '../shared/condominios';
import { listaJson, type FotoReporte } from '../shared/proveedores';
import { MODELOS_FIRMADOS, anotar, firmarComo, registrarCambio, selloFirma, sinCorreos, tomarCambios, cambioRelevante } from '../shared/firma';
import { ApiError, byIndex, ddb, fail, get, hoyMX, now, parsePayload, put, remove, scan, str, table, update, type Item } from '../shared/db';
import {
  EXTRAS,
  ROLES_INICIALES,
  SECCIONES_PERMISO,
  SIN_PERMISOS,
  TODOS_LOS_PERMISOS,
  alcanza,
  normalizarPermisos,
  type Nivel,
  type Permisos,
} from '../shared/permisos';

const UserPoolId = process.env.USER_POOL_ID!;
const ROLES = ['SUPERADMIN', 'ADMIN', 'RESIDENTE', 'VIGILANTE', 'PROVEEDOR'] as const;
type Rol = (typeof ROLES)[number];
const ES_ADMIN = (rol?: string | null) => rol === 'ADMIN' || rol === 'SUPERADMIN';

// ---------- quién llama y qué puede hacer ----------
type Yo = {
  sub: string;
  email: string;
  nombre: string;
  superadmin: boolean;
  permisos: Permisos;
  condos: '*' | Set<string>;
  rolNombre: string;
  /** Condominios suspendidos y en la papelera (solo el superadministrador entra a los suspendidos). */
  suspendidos: Set<string>;
  eliminados: Set<string>;
};

async function cargarYo(identity: any): Promise<Yo> {
  const grupos: string[] = identity?.groups ?? identity?.claims?.['cognito:groups'] ?? [];
  const sub: string = identity?.sub;
  const email = identity?.claims?.email || (await emailDe(sub).catch(() => sub));
  const [perfil, condominios] = await Promise.all([sub ? get('Perfil', { userId: sub }) : undefined, scan('Condominio')]);
  const nombre = perfil?.nombre || email;
  const suspendidos = new Set(condominios.filter((c) => suspendido(c)).map((c) => c.id as string));
  const eliminados = new Set(condominios.filter((c) => enPapelera(c)).map((c) => c.id as string));
  if (grupos.includes('SUPERADMIN')) {
    return { sub, email, nombre, superadmin: true, permisos: TODOS_LOS_PERMISOS, condos: '*', rolNombre: 'Superadministrador', suspendidos, eliminados };
  }
  if (!grupos.includes('ADMIN')) fail('Acceso solo para administradores.');
  if (!perfil || perfil.estado !== 'APROBADO' || perfil.rol !== 'ADMIN') fail('Tu cuenta de administración no está activa.');
  const rol = perfil!.rolAdminId ? await get('RolAdmin', { id: perfil!.rolAdminId }) : undefined;
  const lista: string[] = (perfil!.condominiosAdmin ?? []).filter(Boolean);
  return {
    sub,
    email,
    nombre,
    superadmin: false,
    permisos: rol ? normalizarPermisos(rol.permisos) : SIN_PERMISOS,
    condos: lista.includes('*') ? '*' : new Set(lista),
    rolNombre: rol?.nombre ?? 'Sin rol asignado',
    suspendidos,
    eliminados,
  };
}

/** Condominios que ve: los asignados que no están en la papelera (los suspendidos se listan, pero no se trabajan). */
const enAlcance = (yo: Yo, condominioId?: string | null) =>
  !!condominioId && !yo.eliminados.has(condominioId) && (yo.condos === '*' || yo.condos.has(condominioId));

function exigir(yo: Yo, seccion: string, nivel: Nivel) {
  if (yo.superadmin) return;
  if (!alcanza(yo.permisos.secciones[seccion], nivel)) {
    const s = SECCIONES_PERMISO.find((x) => x.key === seccion)?.label ?? seccion;
    fail(nivel === 'ver' ? `Tu rol no tiene acceso a ${s}.` : `Tu rol solo permite consultar ${s}.`);
  }
}
function exigirExtra(yo: Yo, extra: string) {
  if (yo.superadmin || yo.permisos.extras.includes(extra)) return;
  fail(`Tu rol no permite: ${EXTRAS.find((e) => e.key === extra)?.label.toLowerCase() ?? extra}.`);
}
function exigirCondo(yo: Yo, condominioId?: string | null) {
  if (condominioId && yo.eliminados.has(condominioId)) fail('Este condominio está en la papelera.');
  if (!enAlcance(yo, condominioId)) fail('No tienes asignado ese condominio.');
  if (!yo.superadmin && yo.suspendidos.has(condominioId!)) fail('Este condominio está suspendido. Comunícate con SIIA.');
}
function exigirSuper(yo: Yo) {
  if (!yo.superadmin) fail('Solo el superadministrador puede hacer esto.');
}
/** Un ADMIN solo administra residentes y vigilantes de sus condominios; el SUPERADMIN, a todos. */
function exigirGestionable(yo: Yo, perfil: Item) {
  if (yo.superadmin) return;
  if (ES_ADMIN(perfil.rol)) fail('Solo el superadministrador administra cuentas de administración.');
  // Un proveedor atiende varios condominios: basta con tener asignado uno de ellos.
  if (perfil.rol === 'PROVEEDOR') {
    if (!(perfil.condominiosServicio ?? []).some((c: string) => enAlcance(yo, c))) fail('Ese proveedor no atiende tus condominios.');
    return;
  }
  exigirCondo(yo, perfil.condominioId);
}
/** Sección de permisos con la que se gestiona una cuenta: los proveedores, en «Proveedores». */
const seccionDe = (perfil: Item) => (perfil.rol === 'PROVEEDOR' ? 'proveedores' : 'usuarios');

// ---------- cliente de datos (IAM) para el CRUD ----------
let dataClient: ReturnType<typeof generateClient<Schema>> | undefined;
async function datos() {
  if (!dataClient) {
    // Las variables AMPLIFY_DATA_* las agrega allow.resource(adminApi) en el esquema.
    const env = process.env as unknown as Parameters<typeof getAmplifyDataClientConfig>[0];
    const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
    Amplify.configure(resourceConfig, libraryOptions);
    dataClient = generateClient<Schema>();
  }
  return dataClient;
}
const modelo = async (m: string) => ((await datos()).models as any)[m];

async function leerTodo(fn: (o: { nextToken?: string | null; limit: number }) => Promise<any>) {
  const out: Item[] = [];
  let nextToken: string | null | undefined;
  do {
    const r = await fn({ nextToken, limit: 1000 });
    if (r.errors?.length) throw new Error(r.errors[0].message);
    out.push(...(r.data ?? []).filter(Boolean));
    nextToken = r.nextToken;
  } while (nextToken);
  return out;
}
function resultado(r: { data?: any; errors?: { message: string }[] }) {
  if (r.errors?.length) {
    console.error('data', r.errors);
    fail('No se pudo guardar. Revisa los datos e intenta de nuevo.');
  }
  return r.data;
}

/**
 * Reglas del CRUD por modelo.
 * - seccion: permiso requerido (ver para leer, editar para escribir). Unidad y Condominio se leen con solo tener el condominio.
 * - indices: consultas permitidas y el campo que define el condominio.
 * - crear / editar: campos que se aceptan; `fijos` se ponen en el servidor.
 * - extras: campos que además requieren un permiso especial si cambian.
 */
type Regla = {
  seccion: string;
  lecturaLibre?: boolean;
  indices: Record<string, 'condominioId' | 'encuestaId' | 'hilo'>;
  crear?: string[];
  editar?: string[];
  borrar?: boolean;
  extras?: Record<string, string>;
  valores?: Record<string, string[]>; // valores permitidos al editar
};
// Datos bancarios y cuota del condominio: requieren el permiso «condominios.datosPago».
const CAMPOS_PAGO = ['datosPago', 'banco', 'beneficiario', 'clabe', 'cuentaBancaria', 'referenciaPago', 'notasPago', 'cuotaMensual', 'diaVencimiento', 'recargoActivo', 'recargoMonto', 'recargoDesde', 'cuotaAutomatica', 'diaCargo', 'cuotaAutomaticaDesde'];

const REGLAS: Record<string, Regla> = {
  Condominio: {
    seccion: 'condominios',
    lecturaLibre: true,
    indices: {},
    crear: ['nombre', 'tipo', 'tipoUnidad', 'direccion', 'telefonoCaseta', 'estacionamientoVisitas', 'serviciosCondominio', 'modulos', 'activo', ...CAMPOS_PAGO],
    editar: ['nombre', 'tipo', 'tipoUnidad', 'direccion', 'telefonoCaseta', 'estacionamientoVisitas', 'serviciosCondominio', 'modulos', 'activo', ...CAMPOS_PAGO],
    extras: {
      modulos: 'condominios.servicios',
      activo: 'condominios.servicios',
      ...Object.fromEntries(CAMPOS_PAGO.map((k) => [k, 'condominios.datosPago'])),
    },
  },
  Unidad: {
    seccion: 'condominios',
    lecturaLibre: true,
    indices: { unidadesPorCondominio: 'condominioId' },
    crear: ['condominioId', 'etiqueta', 'cuota', 'propietario', 'fechaEntrega', 'notas'],
    editar: ['etiqueta', 'cuota', 'propietario', 'fechaEntrega', 'notas'],
    borrar: true,
  },
  Cargo: {
    seccion: 'finanzas',
    indices: { cargosPorCondominio: 'condominioId' },
    crear: ['condominioId', 'unidadId', 'concepto', 'periodo', 'monto', 'vence', 'estado', 'tipo'],
    editar: ['estado'],
    valores: { estado: ['CANCELADO'] },
  },
  Pago: { seccion: 'finanzas', indices: { pagosPorCondominio: 'condominioId' } },
  // Egresos y saldos iniciales se escriben con las acciones egresos.* y saldos.inicial.
  Egreso: { seccion: 'finanzas', indices: { egresosPorCondominio: 'condominioId' } },
  SaldoMensual: { seccion: 'finanzas', indices: { saldosPorCondominio: 'condominioId' } },
  Comunicado: {
    seccion: 'comunicados',
    indices: { comunicadosPorCondominio: 'condominioId' },
    crear: ['condominioId', 'titulo', 'cuerpo', 'importante', 'autor'],
    editar: ['titulo', 'cuerpo', 'importante'],
    borrar: true,
  },
  Encuesta: {
    seccion: 'encuestas',
    indices: { encuestasPorCondominio: 'condominioId' },
    crear: ['condominioId', 'pregunta', 'descripcion', 'opciones', 'cierra', 'estado'],
    editar: ['estado', 'cierra', 'descripcion'],
    borrar: true,
  },
  Voto: { seccion: 'encuestas', indices: { votosPorEncuesta: 'encuestaId' } },
  Mensaje: {
    seccion: 'chat',
    indices: { mensajesPorCondominio: 'condominioId', mensajesPorHilo: 'hilo' },
    crear: ['condominioId', 'unidadId', 'canal', 'hilo', 'autorNombre', 'autorRol', 'autorId', 'texto', 'imagenPath'],
  },
  // Se atiende con la acción incidentes.atender (foto de evidencia obligatoria y bitácora).
  Incidente: { seccion: 'incidentes', indices: { incidentesPorCondominio: 'condominioId' } },
  Mantenimiento: {
    seccion: 'mantenimientos',
    indices: { mantenimientosPorCondominio: 'condominioId' },
    crear: ['condominioId', 'titulo', 'tipo', 'area', 'fecha', 'estado', 'proveedor', 'notas'],
    editar: ['titulo', 'tipo', 'area', 'fecha', 'estado', 'proveedor', 'notas'],
    borrar: true,
  },
  Amenidad: {
    seccion: 'amenidades',
    indices: { amenidadesPorCondominio: 'condominioId' },
    crear: [
      'condominioId',
      'nombre',
      'descripcion',
      'horaApertura',
      'horaCierre',
      'maxHoras',
      'capacidad',
      'costo',
      'requiereAprobacion',
      'activa',
      'reglas',
      'parteDeId',
    ],
    editar: ['nombre', 'descripcion', 'horaApertura', 'horaCierre', 'maxHoras', 'capacidad', 'costo', 'requiereAprobacion', 'activa', 'reglas', 'parteDeId'],
  },
  Reserva: { seccion: 'amenidades', indices: { reservasPorCondominio: 'condominioId' }, editar: ['estado', 'nota'] },
  Visita: { seccion: 'visitas', indices: { visitasPorCondominio: 'condominioId' } },
  // Registro de vigilancia (cambios de turno): la administración solo consulta.
  TurnoVigilancia: { seccion: 'visitas', indices: { turnosPorCondominio: 'condominioId' } },
  Mascota: { seccion: 'mascotas', indices: { mascotasPorCondominio: 'condominioId' }, editar: ['estado', 'notas'] },
};

const condoDe = (m: string, item: Item) => (m === 'Condominio' ? item.id : item.condominioId);

/** Una sección pertenece a una amenidad completa del mismo condominio; no hay secciones de secciones. */
async function validarParte(input: Item, condominioId: string, id?: string) {
  const parte = str(input.parteDeId, 64);
  if (!parte) {
    if ('parteDeId' in input) input.parteDeId = null;
    return;
  }
  if (parte === id) fail('Una amenidad no puede ser sección de sí misma.');
  const padre = await get('Amenidad', { id: parte });
  if (!padre || padre.condominioId !== condominioId) fail('Amenidad principal no encontrada.');
  if (padre!.parteDeId) fail('Elige una amenidad principal (no otra sección).');
  if (id && (await byIndex('Amenidad', 'byCondominio', 'condominioId', condominioId)).some((a) => a.parteDeId === id)) {
    fail('Esta amenidad tiene secciones; no puede ser sección de otra.');
  }
}

function soloCampos(input: Item, permitidos: string[], omitir: string[] = []) {
  const fuera = Object.keys(input).filter((k) => !permitidos.includes(k) && !omitir.includes(k));
  if (fuera.length) fail(`Campo no permitido: ${fuera.join(', ')}.`);
}

/** Perfiles visibles para quien llama (sin datos de administradores para un ADMIN). */
async function perfilesVisibles(yo: Yo) {
  const todos = await scan('Perfil');
  const visibles = yo.superadmin ? todos : todos.filter((p) => !ES_ADMIN(p.rol) && enAlcance(yo, p.condominioId));
  return visibles.map(({ __typename, ...p }) => p);
}

/**
 * Aviso a todas las unidades cuando se programa (o cambia de fecha) un mantenimiento: les llega a la campana y como
 * notificación. Solo si el condominio tiene el servicio de mantenimientos y aún no está terminado ni ya pasó.
 */
async function avisarMantenimiento(m: Item, reprogramado: boolean) {
  if (m.estado === 'TERMINADO' || (m.fecha && m.fecha < hoyMX())) return;
  const c = await get('Condominio', { id: m.condominioId });
  if (!c || !(c.modulos ?? []).includes('mantenimientos')) return;
  const cuando = m.fecha
    ? new Date(`${m.fecha}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Mexico_City' })
    : '';
  const texto = [cuando && `${reprogramado ? 'Nueva fecha' : 'Fecha'}: ${cuando}`, m.area && `Área: ${m.area}`, m.notas].filter(Boolean).join(' · ');
  const unidades = await byIndex('Unidad', 'byCondominio', 'condominioId', m.condominioId);
  for (let i = 0; i < unidades.length; i += 25) {
    await Promise.all(
      unidades.slice(i, i + 25).map((u) =>
        put('Aviso', {
          condominioId: m.condominioId,
          unidadId: u.id,
          tipo: 'MANTENIMIENTO',
          titulo: `${reprogramado ? 'Mantenimiento reprogramado' : 'Mantenimiento programado'}: ${str(m.titulo, 100)}`,
          texto: texto.slice(0, 1000),
          leido: false,
        }),
      ),
    );
  }
}

async function db(p: Item, yo: Yo) {
  const m = str(p.model, 40);
  const op = str(p.op, 60);

  if (m === 'Perfil' && op === 'list') {
    exigir(yo, 'usuarios', 'ver');
    return perfilesVisibles(yo);
  }
  if (m === 'Condominio' && op === 'list') {
    const condos = await leerTodo(async (o) => (await modelo('Condominio')).list(o));
    return condos.filter((c) => enAlcance(yo, c.id));
  }

  const regla = REGLAS[m];
  if (!regla) fail('Operación no permitida.');
  const M = await modelo(m);

  // ----- consultas por índice -----
  if (op in regla!.indices) {
    if (!regla!.lecturaLibre) exigir(yo, regla!.seccion, 'ver');
    const campo = regla!.indices[op];
    const valor = str(p.args?.[campo], 200);
    if (!valor) fail('Consulta incompleta.');
    if (campo === 'condominioId') exigirCondo(yo, valor);
    if (campo === 'hilo') exigirCondo(yo, valor.split('#')[0]);
    if (campo === 'encuestaId') exigirCondo(yo, (await get('Encuesta', { id: valor }))?.condominioId);
    const items = await leerTodo((o) => M[op]({ [campo]: valor }, o));
    // Fotos del cambio de turno: URL temporal en lugar de la ruta en S3.
    if (m === 'TurnoVigilancia') {
      const firmar = (k: string) => getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.BUCKET!, Key: k }), { expiresIn: 3600 });
      return Promise.all(
        items.map(async ({ fotoGuardiaPath, fotoCasetaPath, registradoId, ...x }) => ({
          ...x,
          fotoGuardiaUrl: fotoGuardiaPath ? await firmar(fotoGuardiaPath) : null,
          fotoCasetaUrl: fotoCasetaPath ? await firmar(fotoCasetaPath) : null,
        })),
      );
    }
    // Fotos del chat: URL temporal en lugar de la ruta en S3.
    if (m === 'Mensaje') {
      return Promise.all(
        items.map(async ({ imagenPath, ...x }) =>
          imagenPath ? { ...x, imagenUrl: await getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.BUCKET!, Key: imagenPath }), { expiresIn: 3600 }) } : x,
        ),
      );
    }
    // Todos los administradores ven el nombre de quien registró cada etapa; el correo solo el superadministrador.
    if (m === 'Incidente' && !yo.superadmin) {
      return items.map((i) => ({
        ...i,
        historial: JSON.stringify(historialDe(i).map(({ por, porNombre, ...h }) => ({ ...h, porNombre: porNombre || por || null }))),
      }));
    }
    return items;
  }

  // ----- escrituras -----
  const input: Item = p.input && typeof p.input === 'object' ? { ...p.input } : {};
  if (op === 'create') {
    if (!regla!.crear) fail('Operación no permitida.');
    if (m === 'Condominio') {
      exigir(yo, 'condominios', 'editar');
      exigirExtra(yo, 'condominios.alta');
    } else {
      exigir(yo, regla!.seccion, 'editar');
      exigirCondo(yo, input.condominioId);
    }
    soloCampos(input, regla!.crear!);
    if (!yo.superadmin && m === 'Condominio') {
      // Lo que requiere permiso especial se crea vacío si no lo tiene.
      if (!yo.permisos.extras.includes('condominios.servicios')) Object.assign(input, { modulos: [], activo: true });
      if (!yo.permisos.extras.includes('condominios.datosPago')) CAMPOS_PAGO.forEach((k) => delete input[k]);
    }
    if (input.unidadId) {
      const u = await get('Unidad', { id: str(input.unidadId, 64) });
      if (!u || u.condominioId !== input.condominioId) fail('La unidad no pertenece al condominio.');
    }
    if (m === 'Amenidad') await validarParte(input, input.condominioId);
    if (m === 'Cargo') {
      input.estado = 'PENDIENTE';
      input.tipo = (TIPOS_CARGO_MANUAL as readonly string[]).includes(input.tipo) ? input.tipo : 'OTRO';
    }
    if (m === 'Mensaje') {
      // Foto de la administración: subida con chat.subirImagen a la carpeta del condominio.
      if (input.imagenPath) {
        const path = str(input.imagenPath, 400);
        if (!path.startsWith(`condominios/${input.condominioId}/chat/`)) fail('Foto no válida.');
        const h = await s3.send(new HeadObjectCommand({ Bucket: process.env.BUCKET!, Key: path })).catch(() => undefined);
        if (!h) fail('No encontramos la foto. Vuelve a subirla.');
        input.imagenPath = path;
      } else delete input.imagenPath;
      if (!str(input.texto, 2000)) {
        if (!input.imagenPath) fail('Escribe un mensaje.');
        input.texto = '📷 Foto';
      }
      Object.assign(input, {
        canal: 'ADMIN',
        hilo: `${input.condominioId}#${input.unidadId}#ADMIN`,
        autorId: yo.sub,
        autorRol: 'ADMIN',
        autorNombre: 'Administración SIIA',
      });
    }
    if (MODELOS_FIRMADOS.has(m)) input.firma = selloFirma();
    const creado = resultado(await M.create(input));
    registrarCambio(m, 'alta', undefined, creado);
    if (m === 'Mantenimiento') await avisarMantenimiento(creado, false);
    // Un ADMIN con condominios específicos queda asignado al condominio que creó.
    if (m === 'Condominio' && yo.condos !== '*' && creado?.id) {
      await update('Perfil', { userId: yo.sub }, { condominiosAdmin: [...yo.condos, creado.id] });
    }
    return creado;
  }

  if (op === 'update' || op === 'delete') {
    const id = str(input.id, 200);
    const actual = id ? await get(m, { id }) : undefined;
    if (!actual) fail('Registro no encontrado.');
    exigirCondo(yo, condoDe(m, actual!));
    if (op === 'delete') {
      exigir(yo, regla!.seccion, 'editar');
      if (!regla!.borrar) fail('Operación no permitida.');
      const borrado = resultado(await M.delete({ id }));
      registrarCambio(m, 'baja', actual, undefined);
      return borrado;
    }
    if (!regla!.editar) fail('Operación no permitida.');
    soloCampos(input, regla!.editar!, ['id']);
    // Firma de quien modifica y su registro en la actividad (solo si cambia algo de verdad).
    const actualizar = async (x: Item) => {
      const { id: _id, ...campos } = x;
      const relevante = cambioRelevante(campos) && MODELOS_FIRMADOS.has(m);
      const r = resultado(await M.update(relevante ? { ...x, firmaCambio: selloFirma() } : x));
      if (relevante) registrarCambio(m, 'cambio', actual, x);
      return r;
    };
    // Solo cuentan los campos que realmente cambian ('' = vacío; activo es true por defecto).
    const norm = (campo: string, v: unknown) =>
      JSON.stringify(campo === 'activo' ? v !== false : v === '' || v == null || (Array.isArray(v) && !v.length) ? null : v);
    const cambian = Object.keys(input).filter((k) => k !== 'id' && norm(k, input[k]) !== norm(k, actual![k]));
    // Un campo con permiso especial pide ese permiso; cualquier otro, «Gestionar» en la sección.
    for (const campo of cambian) {
      const extra = regla!.extras?.[campo];
      if (extra) exigirExtra(yo, extra);
      else exigir(yo, regla!.seccion, 'editar');
    }
    for (const [campo, permitidos] of Object.entries(regla!.valores ?? {})) {
      if (campo in input && !permitidos.includes(input[campo])) fail('Cambio no permitido.');
    }
    if (m === 'Amenidad' && 'parteDeId' in input) await validarParte(input, actual!.condominioId, actual!.id);
    if (m === 'Reserva' && input.estado === 'APROBADA' && actual!.estado !== 'APROBADA') {
      // Las que tienen costo se aprueban al validar su pago; las gratuitas, aquí (bloquean el horario).
      if (actual!.estado === 'PENDIENTE_PAGO') fail('Esta reserva se confirma al validar su pago en Finanzas.');
      const nota = 'nota' in input ? input.nota : undefined;
      const c = await confirmarReserva(actual!);
      if (!c.ok) fail(`Ese horario ya está apartado por una reserva de ${c.nombre}.`);
      return actualizar({ id: actual!.id, ...(nota !== undefined ? { nota } : {}) });
    }
    if (m === 'Reserva' && (input.estado === 'RECHAZADA' || input.estado === 'CANCELADA')) await cancelarCargoReserva(actual!.id);
    const r = await actualizar(input);
    if (m === 'Mantenimiento' && cambian.includes('fecha')) await avisarMantenimiento({ ...actual!, ...input }, true);
    return r;
  }

  fail('Operación no permitida.');
}

// ---------- archivos (URLs firmadas solo de registros del condominio) ----------
const s3 = new S3Client({});
const ARCHIVOS: Record<string, { seccion: string; campo: string }> = {
  Pago: { seccion: 'finanzas', campo: 'comprobantePath' },
  Incidente: { seccion: 'incidentes', campo: 'fotoPath' },
  Mascota: { seccion: 'mascotas', campo: 'fotoPath' },
};
async function archivo(p: Item, yo: Yo) {
  const a = ARCHIVOS[str(p.model, 40)];
  if (!a) fail('Archivo no disponible.');
  const item = await get(str(p.model, 40), { id: str(p.id, 64) });
  if (!item?.[a!.campo]) fail('Archivo no disponible.');
  exigirCondo(yo, item!.condominioId);
  exigir(yo, a!.seccion, 'ver');
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.BUCKET!, Key: item![a!.campo] }), { expiresIn: 900 });
  return { url };
}

// ---------- documentos del condominio (reglamento y otros dos con título libre) ----------
const SLOTS = SLOTS_DOC.map((x) => x.slot);
const MAX_DOC = 20 * 1024 * 1024;
const TIPOS_DOC: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

/** Los documentos de amenidades piden permiso en Amenidades; los generales, en Condominios. */
const seccionDoc = (slot: string) => (SLOTS_AMENIDADES.includes(slot) ? 'amenidades' : 'condominios');

async function condoDoc(p: Item, yo: Yo, nivel: Nivel) {
  exigir(yo, seccionDoc(str(p.slot, 30)), nivel);
  const c = await get('Condominio', { id: str(p.condominioId, 64) });
  if (!c) fail('Selecciona el condominio.');
  exigirCondo(yo, c!.id);
  return c!;
}

const accionesDocumentos: Record<string, (p: Item, yo: Yo) => Promise<unknown>> = {
  // URL firmada para subir el archivo directo a S3 (válida 10 minutos).
  async 'documentos.subir'(p, yo) {
    const c = await condoDoc(p, yo, 'editar');
    const slot = str(p.slot, 30);
    if (!SLOTS.includes(slot)) fail('Documento no válido.');
    const nombre = str(p.nombre, 120).normalize('NFD').replace(/[^\w.-]+/g, '_');
    const ext = nombre.split('.').pop()?.toLowerCase() ?? '';
    if (!TIPOS_DOC[ext]) fail('Sube un archivo PDF, Word, Excel o imagen (JPG o PNG).');
    if (!(Number(p.tamano) > 0) || Number(p.tamano) > MAX_DOC) fail('El archivo debe pesar máximo 20 MB.');
    const path = `condominios/${c.id}/documentos/${slot}-${Date.now()}-${nombre}`;
    const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: process.env.BUCKET!, Key: path, ContentType: TIPOS_DOC[ext] }), { expiresIn: 600 });
    return { url, path, contentType: TIPOS_DOC[ext] };
  },

  // Registra el archivo ya subido (o solo cambia el título) en el condominio.
  async 'documentos.guardar'(p, yo) {
    const c = await condoDoc(p, yo, 'editar');
    const slot = str(p.slot, 30);
    if (!SLOTS.includes(slot)) fail('Documento no válido.');
    const titulo = SLOTS_DOC.find((x) => x.slot === slot)?.titulo ?? str(p.titulo, 80);
    if (!titulo) fail('Escribe el título del documento.');
    const docs = documentosDe(c.documentos);
    const actual = docs.find((d) => d.slot === slot);
    let doc: Documento;
    const path = str(p.path, 400);
    if (path) {
      if (!path.startsWith(`condominios/${c.id}/documentos/${slot}-`)) fail('Archivo no válido.');
      const h = await s3.send(new HeadObjectCommand({ Bucket: process.env.BUCKET!, Key: path })).catch(() => undefined);
      if (!h) fail('No encontramos el archivo. Vuelve a subirlo.');
      if ((h!.ContentLength ?? 0) > MAX_DOC) fail('El archivo debe pesar máximo 20 MB.');
      doc = { slot, titulo, path, nombre: str(p.nombre, 120) || path.split('/').pop()!, tamano: h!.ContentLength ?? 0, subido: now() };
    } else {
      if (!actual) fail('Sube el archivo.');
      doc = { ...actual!, titulo };
    }
    const documentos = [...docs.filter((d) => d.slot !== slot), doc];
    await update('Condominio', { id: c.id }, { documentos: JSON.stringify(documentos) });
    return documentos;
  },

  // Quita el documento del condominio (el archivo se conserva en el historial del bucket).
  async 'documentos.quitar'(p, yo) {
    const c = await condoDoc(p, yo, 'editar');
    const documentos = documentosDe(c.documentos).filter((d) => d.slot !== str(p.slot, 30));
    await update('Condominio', { id: c.id }, { documentos: JSON.stringify(documentos) });
    return documentos;
  },

  // URL firmada para ver o descargar (15 minutos).
  async 'documentos.url'(p, yo) {
    const c = await condoDoc(p, yo, 'ver');
    const d = documentosDe(c.documentos).find((x) => x.slot === str(p.slot, 30));
    if (!d) fail('Documento no disponible.');
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.BUCKET!, Key: d!.path }), { expiresIn: 900 });
    return { url };
  },
};

// ---------- finanzas: egresos con evidencia y saldo inicial del balance ----------
const TIPOS_EVIDENCIA: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', pdf: 'application/pdf' };
const fechaValida = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) ? v : '');

async function condominioFinanzas(p: Item, yo: Yo, nivel: Nivel) {
  exigir(yo, 'finanzas', nivel);
  const c = await get('Condominio', { id: str(p.condominioId, 64) });
  if (!c) fail('Selecciona el condominio.');
  exigirCondo(yo, c!.id);
  return c!;
}

async function condominioCortes(p: Item, yo: Yo) {
  const c = await get('Condominio', { id: str(p.condominioId, 64) });
  if (!c) fail('Selecciona el condominio.');
  exigirCondo(yo, c!.id);
  return c!;
}
const corteDe = (i: Item): Corte => ({
  id: i.id,
  condominioId: i.condominioId,
  numero: i.numero,
  fecha: i.fecha,
  porNombre: i.porNombre ?? null,
  criterio: jsonCorte(i.criterio, { tipos: [], extraordinarios: false, minCuotas: MIN_CUOTAS_DEFECTO }),
  resumen: jsonCorte(i.resumen, { morosos: 0, monto: 0, porDesactivar: 0, porActivar: 0, desactivados: 0, aplicados: 0 }),
  filas: jsonCorte<FilaCorte[]>(i.filas, []),
});
/** Cortes del condominio, del más reciente al más antiguo. */
const cortesDe = async (condominioId: string) =>
  (await byIndex('CorteAccesos', 'byCondominio', 'condominioId', condominioId)).map(corteDe).sort((a, b) => b.numero - a.numero);

const accionesFinanzas: Record<string, (p: Item, yo: Yo) => Promise<unknown>> = {
  // URL firmada para subir un archivo de evidencia del egreso (PDF o imagen, 10 MB, 10 minutos).
  async 'egresos.subirEvidencia'(p, yo) {
    const c = await condominioFinanzas(p, yo, 'editar');
    const nombre = str(p.nombre, 120).normalize('NFD').replace(/[^\w.-]+/g, '_') || 'evidencia.pdf';
    const ext = nombre.split('.').pop()?.toLowerCase() ?? '';
    if (!TIPOS_EVIDENCIA[ext]) fail('La evidencia debe ser PDF o imagen (JPG, PNG, WEBP o HEIC).');
    if (!(Number(p.tamano) > 0) || Number(p.tamano) > 10 * 1024 * 1024) fail('Cada archivo debe pesar máximo 10 MB.');
    const path = `condominios/${c.id}/egresos/${randomUUID()}-${nombre}`;
    const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: process.env.BUCKET!, Key: path, ContentType: TIPOS_EVIDENCIA[ext] }), { expiresIn: 600 });
    return { url, path, contentType: TIPOS_EVIDENCIA[ext] };
  },

  // Alta o edición de un egreso: fecha, categoría, concepto, monto y de 1 a 5 archivos de evidencia ya subidos.
  async 'egresos.guardar'(p, yo) {
    const c = await condominioFinanzas(p, yo, 'editar');
    const id = str(p.id, 64);
    const actual = id ? await get('Egreso', { id }) : undefined;
    if (id && (!actual || actual.condominioId !== c.id)) fail('Egreso no encontrado.');
    const fecha = fechaValida(p.fecha);
    if (!fecha) fail('Indica la fecha del gasto.');
    const categoria = str(p.categoria, 60);
    if (!CATEGORIAS_EGRESO.includes(categoria)) fail('Elige la categoría del gasto.');
    const concepto = str(p.concepto, 200);
    if (!concepto) fail('Escribe el concepto del gasto.');
    const monto = Math.round(Number(p.monto) * 100) / 100;
    if (!(monto > 0) || monto > 100_000_000) fail('Indica un monto válido.');
    const lista: Item[] = Array.isArray(p.evidencias) ? p.evidencias : [];
    if (!lista.length) fail('Sube al menos un archivo de evidencia.');
    if (lista.length > MAX_EVIDENCIAS_EGRESO) fail(`Máximo ${MAX_EVIDENCIAS_EGRESO} archivos de evidencia.`);
    const evidencias = [];
    for (const e of lista) {
      const path = str(e?.path, 400);
      if (!path.startsWith(`condominios/${c.id}/egresos/`)) fail('Archivo de evidencia no válido.');
      const h = await s3.send(new HeadObjectCommand({ Bucket: process.env.BUCKET!, Key: path })).catch(() => undefined);
      if (!h) fail('No encontramos un archivo de evidencia. Vuelve a subirlo.');
      evidencias.push({ path, nombre: str(e.nombre, 120) || path.split('/').pop(), tipo: h!.ContentType ?? '', tamano: h!.ContentLength ?? 0 });
    }
    const datos = {
      fecha,
      categoria,
      concepto,
      proveedor: str(p.proveedor, 120) || null,
      formaPago: str(p.formaPago, 60) || null,
      monto,
      evidencias: JSON.stringify(evidencias),
      // Gasto pagado con el fondo de amenidades (se descuenta del ahorro de amenidades)
      fondo: p.fondo === FONDO_AMENIDADES ? FONDO_AMENIDADES : null,
    };
    if (actual) return update('Egreso', { id: actual.id }, datos);
    const yoPerfil = await get('Perfil', { userId: yo.sub });
    return put('Egreso', { condominioId: c.id, ...datos, registradoPor: yo.email, registradoPorNombre: yoPerfil?.nombre || null });
  },

  async 'egresos.borrar'(p, yo) {
    exigir(yo, 'finanzas', 'editar');
    const e = await get('Egreso', { id: str(p.id, 64) });
    if (!e) fail('Egreso no encontrado.');
    exigirCondo(yo, e!.condominioId);
    await remove('Egreso', { id: e!.id });
    return { ok: true };
  },

  // URL firmada de un archivo de evidencia del egreso (15 minutos).
  async 'egresos.evidencia'(p, yo) {
    exigir(yo, 'finanzas', 'ver');
    const e = await get('Egreso', { id: str(p.id, 64) });
    if (!e) fail('Egreso no encontrado.');
    exigirCondo(yo, e!.condominioId);
    const path = str(p.path, 400);
    let lista: any = e!.evidencias;
    for (let k = 0; k < 2 && typeof lista === 'string'; k++) lista = JSON.parse(lista);
    if (!Array.isArray(lista) || !lista.some((x: Item) => x.path === path)) fail('Archivo no disponible.');
    return { url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.BUCKET!, Key: path }), { expiresIn: 900 }) };
  },

  // Reservas de amenidades para Finanzas › Ingresos › Amenidades (con el nombre de la amenidad); basta con ver
  // Finanzas. Las canceladas no se incluyen.
  async 'amenidades.reservas'(p, yo) {
    const c = await condominioFinanzas(p, yo, 'ver');
    const [amenidades, reservas] = await Promise.all([
      byIndex('Amenidad', 'byCondominio', 'condominioId', c.id),
      byIndex('Reserva', 'byCondominio', 'condominioId', c.id),
    ]);
    const nombre = (id: string) => {
      const a = amenidades.find((x) => x.id === id);
      const padre = a?.parteDeId ? amenidades.find((x) => x.id === a.parteDeId) : undefined;
      return a ? (padre ? `${padre.nombre} · ${a.nombre}` : a.nombre) : 'Amenidad';
    };
    return reservas
      .filter((r) => r.estado !== 'CANCELADA')
      .map(({ __typename, userId, ...r }) => ({ ...r, amenidad: nombre(r.amenidadId) }));
  },

  // Control de accesos: registrar llaveros, tarjetas, controles… de un residente (hasta 6). Lo registrado ya no se
  // modifica; el mismo código no puede estar asignado dos veces en el condominio.
  async 'accesos.agregar'(p, yo) {
    exigir(yo, 'usuarios', 'editar');
    const perfil = await get('Perfil', { userId: str(p.userId, 64) });
    if (!perfil || perfil.rol !== 'RESIDENTE') fail('Residente no encontrado.');
    exigirCondo(yo, perfil!.condominioId);
    const actuales = accesosDe(perfil!.accesos);
    const nuevos: Item[] = (Array.isArray(p.accesos) ? p.accesos : []).map((x: Item) => ({
      tipo: str(x?.tipo, 60),
      codigo: str(x?.codigo, 40),
      estado: x?.estado === 'SUSPENDIDO' ? 'SUSPENDIDO' : 'ACTIVO',
    }));
    if (!nuevos.length) fail('Agrega al menos un acceso.');
    if (actuales.length + nuevos.length > MAX_ACCESOS) fail(`Cada residente puede tener hasta ${MAX_ACCESOS} accesos (ya tiene ${actuales.length}).`);
    for (const x of nuevos) {
      if (!TIPOS_ACCESO.includes(x.tipo)) fail('Elige el tipo de acceso.');
      if (!x.codigo) fail(`Escribe el código del ${x.tipo.toLowerCase()}.`);
    }
    // Mismo código repetido en el condominio (o dos veces en esta captura)
    const vecinos = await byIndex('Perfil', 'byCondominio', 'condominioId', perfil!.condominioId);
    const usados = new Map<string, string>();
    for (const v of vecinos) for (const a of accesosDe(v.accesos)) usados.set(claveCodigo(a.tipo, a.codigo), v.nombre || v.email);
    for (const x of nuevos) {
      const k = claveCodigo(x.tipo, x.codigo);
      if (usados.has(k)) fail(`El ${x.tipo.toLowerCase()} con código ${x.codigo} ya está asignado a ${usados.get(k)}.`);
      usados.set(k, perfil!.nombre || perfil!.email);
    }
    const yoPerfil = await get('Perfil', { userId: yo.sub });
    const alta = now();
    const accesos = [
      ...actuales,
      ...nuevos.map((x) => ({
        id: randomUUID(),
        tipo: x.tipo,
        codigo: x.codigo,
        estado: x.estado,
        alta,
        por: yo.email,
        porNombre: yoPerfil?.nombre || null,
        estadoEn: alta,
        estadoPor: yo.email,
      })),
    ];
    await update('Perfil', { userId: perfil!.userId }, { accesos: JSON.stringify(accesos) });
    return { accesos };
  },

  // Activar o suspender accesos (Excel de control de accesos): [{ userId, accesoId, estado }].
  async 'accesos.estados'(p, yo) {
    exigir(yo, 'usuarios', 'editar');
    const cambios: Item[] = Array.isArray(p.cambios) ? p.cambios.slice(0, 600) : [];
    const porResidente = new Map<string, Item[]>();
    for (const c of cambios) {
      if (c?.estado !== 'ACTIVO' && c?.estado !== 'SUSPENDIDO') fail('Estado no válido: usa Activado o Suspendido.');
      const id = str(c.userId, 64);
      porResidente.set(id, [...(porResidente.get(id) ?? []), c]);
    }
    let aplicados = 0;
    const ts = now();
    for (const [userId, lista] of porResidente) {
      const perfil = await get('Perfil', { userId });
      if (!perfil || perfil.rol !== 'RESIDENTE') fail('Residente no encontrado.');
      exigirCondo(yo, perfil!.condominioId);
      const accesos = accesosDe(perfil!.accesos).map((a) => {
        const c = lista.find((x) => x.accesoId === a.id);
        if (!c || (a.estado ?? 'ACTIVO') === c.estado) return a;
        aplicados++;
        // Un cambio a mano deja de ser «por morosidad»: el corte ya no lo reactiva solo.
        return { ...a, estado: c.estado, estadoEn: ts, estadoPor: yo.email, motivo: undefined, corte: undefined };
      });
      await update('Perfil', { userId }, { accesos: JSON.stringify(accesos) });
    }
    return { aplicados };
  },

  // Baja de un acceso: solo el superadministrador.
  async 'accesos.eliminar'(p, yo) {
    if (!yo.superadmin) fail('Solo el superadministrador puede dar de baja un acceso.');
    const perfil = await get('Perfil', { userId: str(p.userId, 64) });
    if (!perfil) fail('Residente no encontrado.');
    const accesos = accesosDe(perfil!.accesos).filter((a) => a.id !== str(p.accesoId, 64));
    await update('Perfil', { userId: perfil!.userId }, { accesos: JSON.stringify(accesos) });
    return { accesos };
  },

  // Registro de activaciones: cortes de accesos por morosidad (ver shared/cortes.ts).
  async 'cortes.lista'(p, yo) {
    exigir(yo, 'usuarios', 'ver');
    const c = await condominioCortes(p, yo);
    const [cortes, perfiles] = await Promise.all([cortesDe(c.id), byIndex('Perfil', 'byCondominio', 'condominioId', c.id)]);
    // Tipos de acceso registrados en el condominio (para elegir cuáles se desactivan)
    const tipos = [...new Set(perfiles.flatMap((x) => accesosDe(x.accesos).map((a) => a.tipo)))].sort(
      (a, b) => TIPOS_ACCESO.indexOf(a) - TIPOS_ACCESO.indexOf(b),
    );
    return { cortes: cortes.map(({ filas, ...x }) => x), tipos };
  },

  // Corte y los dos anteriores, para volver a descargar su Excel tal como salió.
  async 'cortes.ver'(p, yo) {
    exigir(yo, 'usuarios', 'ver');
    const c = await condominioCortes(p, yo);
    const cortes = await cortesDe(c.id);
    const i = cortes.findIndex((x) => x.id === str(p.id, 64));
    if (i < 0) fail('Corte no encontrado.');
    return { corte: cortes[i], previos: cortes.slice(i + 1, i + 3) };
  },

  async 'cortes.crear'(p, yo) {
    exigir(yo, 'usuarios', 'editar');
    const c = await condominioCortes(p, yo);
    const tiposValidos = new Set(TIPOS_ACCESO);
    const criterio: CriterioCorte = {
      tipos: [...new Set((Array.isArray(p.tipos) ? p.tipos : []).map((t: unknown) => str(t, 60)).filter((t: string) => tiposValidos.has(t)))] as string[],
      extraordinarios: p.extraordinarios === true,
      minCuotas: Math.min(12, Math.max(1, Math.round(Number(p.minCuotas) || MIN_CUOTAS_DEFECTO))),
    };
    const [anteriores, perfilesTodos, cargos, unidades] = await Promise.all([
      cortesDe(c.id),
      byIndex('Perfil', 'byCondominio', 'condominioId', c.id),
      byIndex('Cargo', 'byCondominio', 'condominioId', c.id),
      byIndex('Unidad', 'byCondominio', 'condominioId', c.id),
    ]);
    const previo = anteriores[0];
    const numero = (previo?.numero ?? 0) + 1;
    const fecha = now();
    const residentes = perfilesTodos.filter((x) => x.rol === 'RESIDENTE' && (x.estado === 'APROBADO' || x.estado === 'SUSPENDIDO'));

    // 1. El corte anterior se da por hecho: lo marcado para el técnico queda aplicado en SIIA.
    //    Si alguien cambió ese acceso a mano después del corte, se respeta su cambio.
    let aplicados = 0;
    const pendientes = new Map<string, EstadoCorte>();
    for (const f of previo?.filas ?? []) for (const a of f.accesos) if (a.estado === 'POR_DESACTIVAR' || a.estado === 'POR_ACTIVAR') pendientes.set(a.id, a.estado);
    for (const r of residentes) {
      const accesos = accesosDe(r.accesos);
      let cambio = false;
      const nuevos = accesos.map((a) => {
        const pend = pendientes.get(a.id);
        if (!pend || (a.estadoEn && previo && a.estadoEn > previo.fecha)) return a;
        const estado = pend === 'POR_DESACTIVAR' ? 'SUSPENDIDO' : 'ACTIVO';
        if (estadoDeAcceso(a) === estado) return a;
        cambio = true;
        aplicados++;
        return estado === 'SUSPENDIDO'
          ? { ...a, estado, estadoEn: fecha, estadoPor: `Corte #${previo!.numero}`, motivo: 'MOROSIDAD' as const, corte: previo!.numero }
          : { ...a, estado, estadoEn: fecha, estadoPor: `Corte #${previo!.numero}`, motivo: undefined, corte: undefined };
      });
      if (cambio) {
        await update('Perfil', { userId: r.userId }, { accesos: JSON.stringify(nuevos) });
        r.accesos = nuevos;
      }
    }

    // 2. Adeudo vencido de cada casa con lo que cuenta en este corte (las reservas nunca cuentan).
    const hoy = hoyMX();
    const deuda = new Map<string, { cuotas: number; extras: number; monto: number }>();
    for (const cg of cargos) {
      if (cg.estado !== 'PENDIENTE' || !cg.vence || cg.vence >= hoy) continue;
      const tipo = tipoDeCargo(cg as { id: string; tipo?: string | null });
      const esCuota = tipo === 'CUOTA';
      const esExtra = (TIPOS_CARGO_MANUAL as readonly string[]).includes(tipo);
      if (!esCuota && tipo !== 'RECARGO' && !(esExtra && criterio.extraordinarios)) continue;
      const d = deuda.get(cg.unidadId) ?? { cuotas: 0, extras: 0, monto: 0 };
      if (esCuota) d.cuotas++;
      else if (esExtra) d.extras++;
      d.monto = Math.round((d.monto + (Number(cg.monto) || 0)) * 100) / 100;
      deuda.set(cg.unidadId, d);
    }

    // 3. Acción de cada acceso para el técnico.
    const marcar = new Set(criterio.tipos);
    const filas: FilaCorte[] = [];
    const orden = [...unidades].sort((a, b) => String(a.etiqueta).localeCompare(String(b.etiqueta), 'es', { numeric: true }));
    for (const u of orden) {
      const d = deuda.get(u.id) ?? { cuotas: 0, extras: 0, monto: 0 };
      const moroso = d.cuotas + d.extras >= criterio.minCuotas;
      const rs = residentes.filter((r) => r.unidadId === u.id);
      for (const r of rs.length ? rs : [null]) {
        const accesos: AccesoCorte[] = (r ? accesosDe(r.accesos) : []).map((a) => {
          const suspendidoYa = estadoDeAcceso(a) === 'SUSPENDIDO';
          const porMorosidad = a.motivo === 'MOROSIDAD';
          const estado: EstadoCorte = moroso
            ? suspendidoYa
              ? 'DESACTIVADO'
              : marcar.has(a.tipo)
                ? 'POR_DESACTIVAR'
                : 'ACTIVO'
            : suspendidoYa
              ? porMorosidad
                ? 'POR_ACTIVAR'
                : 'DESACTIVADO'
              : 'ACTIVO';
          return { id: a.id, tipo: a.tipo, codigo: a.codigo, estado, ...(suspendidoYa && !porMorosidad ? { manual: true } : {}) };
        });
        // Solo se guardan morosos y quien tiene algún acceso sin activar (el resto está activo).
        if (!moroso && !accesos.some((a) => a.estado !== 'ACTIVO')) continue;
        filas.push({
          unidadId: u.id,
          unidad: u.etiqueta,
          userId: r?.userId ?? null,
          residente: r ? r.nombre || r.email : u.propietario || 'Sin residente',
          moroso,
          ...d,
          accesos,
        });
      }
    }
    const todos = filas.flatMap((f) => f.accesos);
    const unidadesMorosas = new Map(filas.filter((f) => f.moroso).map((f) => [f.unidadId, f.monto]));
    const resumen: ResumenCorte = {
      morosos: unidadesMorosas.size,
      monto: Math.round([...unidadesMorosas.values()].reduce((s, m) => s + m, 0) * 100) / 100,
      porDesactivar: todos.filter((a) => a.estado === 'POR_DESACTIVAR').length,
      porActivar: todos.filter((a) => a.estado === 'POR_ACTIVAR').length,
      desactivados: todos.filter((a) => a.estado === 'DESACTIVADO').length,
      aplicados,
    };
    const corte = await put('CorteAccesos', {
      condominioId: c.id,
      numero,
      fecha,
      porNombre: yo.nombre,
      criterio: JSON.stringify(criterio),
      resumen: JSON.stringify(resumen),
      filas: JSON.stringify(filas),
    });
    return { corte: corteDe(corte), previos: anteriores.slice(0, 2) };
  },

  // URL firmada para subir una foto al chat con una unidad (10 minutos, imagen de 10 MB máximo).
  async 'chat.subirImagen'(p, yo) {
    exigir(yo, 'chat', 'editar');
    const c = await get('Condominio', { id: str(p.condominioId, 64) });
    if (!c) fail('Selecciona el condominio.');
    exigirCondo(yo, c!.id);
    const nombre = str(p.nombre, 120).normalize('NFD').replace(/[^\w.-]+/g, '_') || 'foto.jpg';
    const ext = nombre.split('.').pop()?.toLowerCase() ?? '';
    if (!TIPOS_FOTO[ext]) fail('Adjunta una imagen (JPG, PNG, WEBP o HEIC).');
    if (!(Number(p.tamano) > 0) || Number(p.tamano) > 10 * 1024 * 1024) fail('La foto debe pesar máximo 10 MB.');
    const path = `condominios/${c!.id}/chat/${randomUUID()}-${nombre}`;
    const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: process.env.BUCKET!, Key: path, ContentType: TIPOS_FOTO[ext] }), { expiresIn: 600 });
    return { url, path, contentType: TIPOS_FOTO[ext] };
  },

  // Residentes de cada unidad (nombre, teléfono y correo) para el reporte de cobranza; basta con ver Finanzas.
  async 'finanzas.contactos'(p, yo) {
    const c = await condominioFinanzas(p, yo, 'ver');
    const perfiles = await byIndex('Perfil', 'byCondominio', 'condominioId', c.id);
    const out: Record<string, { nombre: string | null; telefono: string | null; email: string }[]> = {};
    for (const x of perfiles) {
      if (x.rol !== 'RESIDENTE' || x.estado !== 'APROBADO' || !x.unidadId) continue;
      (out[x.unidadId] ??= []).push({ nombre: x.nombre || null, telefono: x.telefono || null, email: x.email });
    }
    return out;
  },

  // Saldo inicial de un mes capturado a mano (saldoInicial = null lo quita y vuelve a arrastrarse del mes anterior).
  async 'saldos.inicial'(p, yo) {
    const c = await condominioFinanzas(p, yo, 'editar');
    const periodo = str(p.periodo, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) fail('Periodo no válido (AAAA-MM).');
    const id = `${c.id}#${periodo}`;
    if (p.saldoInicial === null || p.saldoInicial === '') {
      await remove('SaldoMensual', { id });
      return { ok: true };
    }
    const saldoInicial = Math.round(Number(p.saldoInicial) * 100) / 100;
    if (!Number.isFinite(saldoInicial) || Math.abs(saldoInicial) > 1_000_000_000) fail('Indica un saldo válido.');
    return put('SaldoMensual', { id, condominioId: c.id, periodo, saldoInicial, nota: str(p.nota, 300) || null, editadoPor: yo.email });
  },
};

// ---------- comunicados con imágenes ----------
const MAX_IMAGENES_COMUNICADO = 6;
const MAX_ADJUNTOS_COMUNICADO = 5;

async function archivosComunicado(c: Item) {
  const firmar = (path: string, descarga?: string) =>
    getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: process.env.BUCKET!, Key: path, ...(descarga ? { ResponseContentDisposition: `attachment; filename="${descarga}"` } : {}) }),
      { expiresIn: 3600 },
    );
  return {
    imagenes: await Promise.all(((c.imagenes ?? []) as string[]).map((path) => firmar(path))),
    adjuntos: await Promise.all(
      ((c.adjuntos ?? []) as string[]).map(async (path) => {
        const nombre = nombreAdjunto(path);
        return { nombre, url: await firmar(path, nombre) };
      }),
    ),
  };
}

async function condominioComunicados(p: Item, yo: Yo, nivel: Nivel) {
  exigir(yo, 'comunicados', nivel);
  const c = await get('Condominio', { id: str(p.condominioId, 64) });
  if (!c) fail('Selecciona el condominio.');
  exigirCondo(yo, c!.id);
  return c!;
}

const accionesComunicados: Record<string, (p: Item, yo: Yo) => Promise<unknown>> = {
  // URL firmada para subir una imagen o un PDF del comunicado (10 MB, 10 minutos).
  async 'comunicados.subirArchivo'(p, yo) {
    const c = await condominioComunicados(p, yo, 'editar');
    const nombre = str(p.nombre, 120).normalize('NFD').replace(/[^\w.-]+/g, '_') || 'imagen.jpg';
    const ext = nombre.split('.').pop()?.toLowerCase() ?? '';
    if (!TIPOS_EVIDENCIA[ext]) fail('Adjunta una imagen (JPG, PNG, WEBP o HEIC) o un PDF.');
    if (!(Number(p.tamano) > 0) || Number(p.tamano) > 10 * 1024 * 1024) fail('Cada archivo debe pesar máximo 10 MB.');
    const path = `condominios/${c.id}/comunicados/${randomUUID()}-${nombre}`;
    const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: process.env.BUCKET!, Key: path, ContentType: TIPOS_EVIDENCIA[ext] }), { expiresIn: 600 });
    return { url, path, contentType: TIPOS_EVIDENCIA[ext] };
  },

  // Alta o edición de un comunicado con sus imágenes ya subidas.
  async 'comunicados.guardar'(p, yo) {
    const c = await condominioComunicados(p, yo, 'editar');
    const id = str(p.id, 64);
    const actual = id ? await get('Comunicado', { id }) : undefined;
    if (id && (!actual || actual.condominioId !== c.id)) fail('Comunicado no encontrado.');
    const titulo = str(p.titulo, 140);
    const cuerpo = str(p.cuerpo, 8000);
    if (!titulo) fail('Escribe el título.');
    if (!cuerpo) fail('Escribe el mensaje.');
    // Archivos ya subidos con comunicados.subirArchivo: imágenes y PDF, cada uno en su lista
    const validar = async (valor: unknown, max: number, esPdf: boolean, que: string) => {
      const lista: unknown[] = Array.isArray(valor) ? valor : [];
      if (lista.length > max) fail(`Máximo ${max} ${que} por comunicado.`);
      const out: string[] = [];
      for (const x of lista) {
        const path = str(x, 400);
        if (!path.startsWith(`condominios/${c.id}/comunicados/`) || /\.pdf$/i.test(path) !== esPdf) fail('Archivo no válido.');
        if (![...(actual?.imagenes ?? []), ...(actual?.adjuntos ?? [])].includes(path)) {
          const h = await s3.send(new HeadObjectCommand({ Bucket: process.env.BUCKET!, Key: path })).catch(() => undefined);
          if (!h) fail('No encontramos un archivo. Vuelve a subirlo.');
        }
        out.push(path);
      }
      return out;
    };
    const imagenes = await validar(p.imagenes, MAX_IMAGENES_COMUNICADO, false, 'imágenes');
    const adjuntos = await validar(p.adjuntos, MAX_ADJUNTOS_COMUNICADO, true, 'PDF');
    const datos = { titulo, cuerpo, importante: p.importante === true, imagenes, adjuntos };
    if (actual) return update('Comunicado', { id: actual.id }, datos);
    const yoPerfil = await get('Perfil', { userId: yo.sub });
    return put('Comunicado', { condominioId: c.id, ...datos, autor: yoPerfil?.nombre || yo.email });
  },

  // URLs temporales (1 hora) de las imágenes, en el mismo orden, y de los PDF (para descargar, con su nombre).
  async 'comunicados.archivos'(p, yo) {
    exigir(yo, 'comunicados', 'ver');
    const c = await get('Comunicado', { id: str(p.id, 64) });
    if (!c) fail('Comunicado no encontrado.');
    exigirCondo(yo, c!.condominioId);
    return archivosComunicado(c!);
  },
};

// ---------- encuestas: reporte de votos ----------
const accionesEncuestas: Record<string, (p: Item, yo: Yo) => Promise<unknown>> = {
  // Quién votó en una encuesta (nombre y correo del residente) para el reporte de Excel. Los votos y las unidades
  // ya los tiene el panel; aquí solo se agregan los nombres, que no requieren permiso de usuarios.
  async 'encuestas.votantes'(p, yo) {
    exigir(yo, 'encuestas', 'ver');
    const e = await get('Encuesta', { id: str(p.encuestaId, 64) });
    if (!e) fail('Encuesta no encontrada.');
    exigirCondo(yo, e!.condominioId);
    const votos = await byIndex('Voto', 'byEncuesta', 'encuestaId', e!.id);
    const ids = [...new Set(votos.map((v) => v.userId).filter(Boolean))] as string[];
    const perfiles = await Promise.all(ids.map((userId) => get('Perfil', { userId })));
    return Object.fromEntries(perfiles.filter(Boolean).map((x) => [x!.userId, { nombre: x!.nombre || null, email: x!.email || null }]));
  },
};

// ---------- incidentes: atención con evidencia ----------
// Etapas que registra el administrador. Cada etapa guardada queda fija; el administrador elige libremente la que
// corresponde (puede repetirla: seguimiento, seguimiento, proceso… y al final cerrar).
const ESTADOS_INCIDENTE = ['EN_SEGUIMIENTO', 'EN_PROCESO', 'CERRADO'];
const CON_EVIDENCIA = ['EN_SEGUIMIENTO', 'EN_PROCESO', 'CERRADO'];
const TIPOS_FOTO: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' };
type Paso = { estado: string; respuesta?: string | null; fotoPath?: string | null; por?: string; porNombre?: string | null; en: string; reabierto?: boolean };

function historialDe(i: Item): Paso[] {
  let h: any = i.historial;
  for (let k = 0; k < 2 && typeof h === 'string'; k++) {
    try {
      h = JSON.parse(h);
    } catch {
      h = [];
    }
  }
  return Array.isArray(h) ? h : [];
}

async function incidenteDe(p: Item, yo: Yo, nivel: Nivel) {
  exigir(yo, 'incidentes', nivel);
  const i = await get('Incidente', { id: str(p.incidenteId, 64) });
  if (!i) fail('Incidente no encontrado.');
  exigirCondo(yo, i!.condominioId);
  return i!;
}

const accionesIncidentes: Record<string, (p: Item, yo: Yo) => Promise<unknown>> = {
  // URL firmada para subir la foto de evidencia (10 minutos).
  async 'incidentes.subirEvidencia'(p, yo) {
    const i = await incidenteDe(p, yo, 'editar');
    if (i.estado === 'CERRADO' && !yo.superadmin) fail('El incidente está cerrado; solo el superadministrador puede modificarlo.');
    const nombre = str(p.nombre, 120).normalize('NFD').replace(/[^\w.-]+/g, '_') || 'foto.jpg';
    const ext = nombre.split('.').pop()?.toLowerCase() ?? '';
    if (!TIPOS_EVIDENCIA[ext]) fail('La evidencia debe ser una foto (JPG, PNG, WEBP o HEIC) o un PDF.');
    if (!(Number(p.tamano) > 0) || Number(p.tamano) > 10 * 1024 * 1024) fail('La evidencia debe pesar máximo 10 MB.');
    const path = `condominios/${i.condominioId}/incidentes/${i.id}/${Date.now()}-${nombre}`;
    const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: process.env.BUCKET!, Key: path, ContentType: TIPOS_EVIDENCIA[ext] }), { expiresIn: 600 });
    return { url, path, contentType: TIPOS_EVIDENCIA[ext] };
  },

  // Seguimiento por etapas (En seguimiento / En proceso / Cerrado): el administrador elige la etapa que corresponde,
  // con descripción y foto de evidencia obligatorias; lo guardado ya no se modifica. Un incidente cerrado ya no
  // cambia, salvo que lo modifique el superadministrador (puede regresarlo a cualquier etapa).
  async 'incidentes.atender'(p, yo) {
    const i = await incidenteDe(p, yo, 'editar');
    if (i.estado === 'CERRADO' && !yo.superadmin) fail('El incidente está cerrado; solo el superadministrador puede modificarlo.');
    const estado = str(p.estado, 20);
    if (!ESTADOS_INCIDENTE.includes(estado)) fail('Estado no válido.');
    const respuesta = str(p.respuesta, 2000) || null;
    const fotoPath = str(p.fotoPath, 400) || null;
    if (!respuesta) fail('Escribe la descripción de la etapa.');
    if (CON_EVIDENCIA.includes(estado) && !fotoPath) fail('Sube la foto de evidencia.');
    if (fotoPath) {
      if (!fotoPath.startsWith(`condominios/${i.condominioId}/incidentes/${i.id}/`)) fail('Foto no válida.');
      const h = await s3.send(new HeadObjectCommand({ Bucket: process.env.BUCKET!, Key: fotoPath })).catch(() => undefined);
      if (!h) fail('No encontramos la foto. Vuelve a subirla.');
    }
    const yoPerfil = await get('Perfil', { userId: yo.sub });
    const paso: Paso = {
      estado,
      respuesta,
      fotoPath,
      por: yo.email,
      porNombre: yoPerfil?.nombre || null,
      en: now(),
      ...(i.estado === 'CERRADO' ? { reabierto: true } : {}),
    };
    const r = await update('Incidente', { id: i.id }, {
      estado,
      respuesta,
      ...(fotoPath ? { evidenciaPath: fotoPath } : {}),
      historial: JSON.stringify([...historialDe(i), paso]),
    });
    const texto = { ABIERTO: 'abierto', EN_SEGUIMIENTO: 'en seguimiento', EN_PROCESO: 'en proceso', CERRADO: 'cerrado' }[estado];
    await put('Aviso', {
      condominioId: i.condominioId,
      unidadId: i.unidadId,
      tipo: 'INCIDENTE',
      titulo: `Tu reporte "${i.titulo}" está ${texto}`,
      texto: respuesta,
      leido: false,
    });
    return r;
  },

  // URL firmada de una foto de evidencia del incidente (15 minutos).
  async 'incidentes.evidencia'(p, yo) {
    const i = await incidenteDe(p, yo, 'ver');
    const path = str(p.path, 400);
    if (!historialDe(i).some((h) => h.fotoPath === path)) fail('Foto no disponible.');
    return { url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.BUCKET!, Key: path }), { expiresIn: 900 }) };
  },
};

// ---------- usuarios ----------
async function asignarGrupo(username: string, rol: Rol) {
  const actuales = await cognito.send(new AdminListGroupsForUserCommand({ UserPoolId, Username: username }));
  for (const g of actuales.Groups ?? []) {
    if (g.GroupName !== rol && ROLES.includes(g.GroupName as Rol)) {
      await cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId, Username: username, GroupName: g.GroupName }));
    }
  }
  await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId, Username: username, GroupName: rol }));
}
async function quitarGrupos(username: string) {
  const actuales = await cognito.send(new AdminListGroupsForUserCommand({ UserPoolId, Username: username }));
  for (const g of actuales.Groups ?? []) {
    await cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId, Username: username, GroupName: g.GroupName }));
  }
}
const cerrarSesiones = (username: string) =>
  cognito.send(new AdminUserGlobalSignOutCommand({ UserPoolId, Username: username })).catch(() => undefined);

type Asignacion = {
  rol: Rol;
  condominioId: string | null;
  unidadId: string | null;
  rolAdminId: string | null;
  condominiosAdmin: string[] | null;
  // Solo PROVEEDOR
  condominiosServicio?: string[];
  servicios?: string[];
  empresa?: string | null;
};

/** Servicios que da un proveedor: los del catálogo y los que escriba la administración (máximo 25). */
function serviciosDe(v: unknown) {
  const lista = (Array.isArray(v) ? v : []).map((x) => str(x, 60)).filter(Boolean);
  return [...new Set(lista)].slice(0, 25);
}
/** Condominios de un proveedor que puede asignar quien llama (deben estar en su alcance). */
function condominiosDe(v: unknown, yo: Yo) {
  const lista = [...new Set((Array.isArray(v) ? v : []).map((x) => str(x, 64)).filter(Boolean))];
  for (const c of lista) exigirCondo(yo, c);
  return lista;
}

async function validarAsignacion(p: Item, yo: Yo): Promise<Asignacion> {
  const rol = (ROLES as readonly string[]).includes(p.rol) ? (p.rol as Rol) : 'RESIDENTE';
  const vacio = { condominioId: null, unidadId: null, rolAdminId: null, condominiosAdmin: null };
  if (rol === 'SUPERADMIN') {
    exigirSuper(yo);
    return { rol, ...vacio };
  }
  if (rol === 'ADMIN') {
    exigirSuper(yo);
    const r = await get('RolAdmin', { id: str(p.rolAdminId, 64) });
    if (!r) fail('Selecciona el rol de administración.');
    const lista: string[] = Array.isArray(p.condominiosAdmin) ? p.condominiosAdmin.map((x: unknown) => str(x, 64)).filter(Boolean) : [];
    let condominiosAdmin: string[];
    if (lista.includes('*')) condominiosAdmin = ['*'];
    else {
      const existentes = await Promise.all(lista.map((id) => get('Condominio', { id })));
      condominiosAdmin = existentes.filter(Boolean).map((c) => c!.id);
      if (!condominiosAdmin.length) fail('Asigna al menos un condominio (o todos).');
    }
    return { rol, ...vacio, rolAdminId: r!.id, condominiosAdmin };
  }
  if (rol === 'PROVEEDOR') {
    exigir(yo, 'proveedores', 'editar');
    const condominiosServicio = condominiosDe(p.condominiosServicio, yo);
    for (const id of condominiosServicio) if (!(await get('Condominio', { id }))) fail('Condominio no encontrado.');
    if (!condominiosServicio.length) fail('Asigna al menos un condominio que atiende.');
    const servicios = serviciosDe(p.servicios);
    if (!servicios.length) fail('Elige al menos un servicio que da.');
    return { rol, ...vacio, condominiosServicio, servicios, empresa: str(p.empresa, 120) || null };
  }
  exigir(yo, 'usuarios', 'editar');
  const c = await get('Condominio', { id: str(p.condominioId, 64) });
  if (!c) fail('Selecciona el condominio.');
  exigirCondo(yo, c!.id);
  if (rol === 'VIGILANTE') return { rol, ...vacio, condominioId: c!.id };
  const u = await get('Unidad', { id: str(p.unidadId, 64) });
  if (!u || u.condominioId !== c!.id) fail('Selecciona la unidad del residente.');
  return { rol, ...vacio, condominioId: c!.id, unidadId: u!.id };
}

/** Contraseña temporal que cumple la política (mayúscula, minúscula, número y símbolo). */
function temporal() {
  const set = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '$#!%*?'];
  const chars = Array.from({ length: 12 }, (_, i) => {
    const s = set[i < 4 ? i : randomInt(3)];
    return s[randomInt(s.length)];
  });
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

async function perfilDe(userId: string) {
  if (!userId) fail('Usuario no encontrado.');
  const perfil = await get('Perfil', { userId });
  if (!perfil) fail('Usuario no encontrado.');
  return perfil!;
}

// Alta directa por la administración: Cognito envía la invitación con contraseña temporal.
/** Cognito no pudo mandar el correo (límite diario del remitente o falla de entrega). */
const sinCupoCorreo = (err: any) => err?.name === 'LimitExceededException' || err?.name === 'CodeDeliveryFailureException';
const AVISO_CUPO = 'Se alcanzó el límite de correos de hoy. Intenta mañana o asígnale una contraseña con el botón «Contraseña».';

/**
 * Alta de una cuenta. `enviarCorreo: false` solo la crea (sin correo); si se pide el correo y se acabó el cupo del día,
 * también se crea sin correo. En ambos casos queda `accesoSinEnviar` y después se le envía o se le asigna contraseña.
 */
async function altaUsuario(p: Item, yo: Yo) {
  const email = str(p.email, 200).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('Correo no válido.');
  const nombre = str(p.nombre, 120);
  const asignacion = await validarAsignacion(p, yo);
  const crear = (enviar: boolean) =>
    cognito.send(
      new AdminCreateUserCommand({
        UserPoolId,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
          ...(nombre ? [{ Name: 'name', Value: nombre }] : []),
        ],
        ...(enviar ? { DesiredDeliveryMediums: ['EMAIL' as const] } : { MessageAction: 'SUPPRESS' as const }),
      }),
    );
  const correoPedido = p.enviarCorreo !== false;
  let correoEnviado = correoPedido;
  let sub: string | undefined;
  try {
    let r;
    try {
      r = await crear(correoEnviado);
    } catch (err: any) {
      if (!correoEnviado || !sinCupoCorreo(err)) throw err;
      console.warn('alta sin correo (cupo)', err.name);
      correoEnviado = false;
      r = await crear(false);
    }
    sub = r.User?.Attributes?.find((a) => a.Name === 'sub')?.Value;
  } catch (err: any) {
    if (err?.name === 'UsernameExistsException') fail('Ya existe un usuario con ese correo.');
    throw err;
  }
  if (!sub) fail('No se pudo crear el usuario.');
  await asignarGrupo(sub!, asignacion.rol);
  const perfil = await put('Perfil', {
    userId: sub,
    email,
    nombre,
    telefono: str(p.telefono, 20),
    telefono2: str(p.telefono2, 20),
    estado: 'APROBADO',
    accesoSinEnviar: correoEnviado ? null : true,
    ...asignacion,
  });
  return { ...perfil, correoEnviado, correoPedido };
}

/** Envía por correo una contraseña temporal nueva (la actual deja de funcionar si ya la había creado). */
async function enviarAccesos(userId: string) {
  const u = await cognito.send(new AdminGetUserCommand({ UserPoolId, Username: userId }));
  if (u.UserStatus !== 'FORCE_CHANGE_PASSWORD') {
    await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId, Username: userId, Password: temporal(), Permanent: false }));
  }
  // El reenvío (AdminCreateUser) exige el correo como usuario; con el sub Cognito responde «Username should be an email».
  const email = u.UserAttributes?.find((a) => a.Name === 'email')?.Value;
  if (!email) fail('La cuenta no tiene correo registrado.');
  try {
    await cognito.send(new AdminCreateUserCommand({ UserPoolId, Username: email, MessageAction: 'RESEND', DesiredDeliveryMediums: ['EMAIL'] }));
  } catch (err: any) {
    if (sinCupoCorreo(err)) fail(AVISO_CUPO);
    throw err;
  }
  await update('Perfil', { userId }, { accesoSinEnviar: null });
}

/**
 * Cambia nombre, teléfonos o correo de un residente o vigilante. Los campos vacíos no se tocan.
 * Si cambia el correo, el nuevo correo pasa a ser su usuario y recibe accesos nuevos.
 */
async function editarPersona(perfil: Item, p: Item, yo: Yo) {
  exigirGestionable(yo, perfil);
  exigir(yo, seccionDe(perfil), 'editar');
  const cambios: Item = {};
  const nombre = str(p.nombre, 120);
  const telefono = str(p.telefono, 20);
  const telefono2 = str(p.telefono2, 20);
  const email = str(p.email, 200).toLowerCase();
  if (nombre && nombre !== perfil.nombre) cambios.nombre = nombre;
  if (telefono && telefono !== perfil.telefono) cambios.telefono = telefono;
  if (telefono2 && telefono2 !== perfil.telefono2) cambios.telefono2 = telefono2;
  if (email && email !== perfil.email) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('Correo no válido.');
    if (perfil.estado !== 'APROBADO' && perfil.estado !== 'SUSPENDIDO') fail('Autoriza la cuenta antes de cambiar su correo.');
    cambios.email = email;
  }
  if (!Object.keys(cambios).length) return { cambios: [] as string[] };
  const atributos = [
    ...(cambios.email ? [{ Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' }] : []),
    ...(cambios.nombre ? [{ Name: 'name', Value: nombre }] : []),
  ];
  if (atributos.length) {
    try {
      await cognito.send(new AdminUpdateUserAttributesCommand({ UserPoolId, Username: perfil.userId, UserAttributes: atributos }));
    } catch (err: any) {
      if (err?.name === 'AliasExistsException' || err?.name === 'UsernameExistsException') fail('Ya existe un usuario con ese correo.');
      throw err;
    }
  }
  await update('Perfil', { userId: perfil.userId }, cambios);
  // Correo nuevo: se le envían accesos nuevos, salvo que la administración elija no enviar correo (conserva su
  // contraseña). Si se acabó el cupo de correos del día, el cambio queda guardado y el acceso, por enviar.
  let correoEnviado = false;
  if (cambios.email && perfil.estado === 'APROBADO') {
    if (p.enviarCorreo === false) {
      await update('Perfil', { userId: perfil.userId }, { accesoSinEnviar: true });
    } else {
      try {
        await enviarAccesos(perfil.userId);
        await cerrarSesiones(perfil.userId);
        correoEnviado = true;
      } catch (err) {
        if (!(err instanceof ApiError) || err.message !== AVISO_CUPO) throw err;
        await update('Perfil', { userId: perfil.userId }, { accesoSinEnviar: true });
      }
    }
  }
  return { cambios: Object.keys(cambios), correoEnviado };
}

// ---------- suspensión y papelera de condominios (ver shared/condominios.ts) ----------
const lambda = new LambdaClient({});
/** Encarga a la Lambda siia-papelera desactivar, reactivar o borrar cuentas y datos (sin esperar a que termine). */
async function enviarAPapelera(orden: OrdenPapelera) {
  await lambda.send(new InvokeCommand({ FunctionName: process.env.PAPELERA_FN!, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify(orden)) }));
}
/** `papelera`: el condominio debe estar en la papelera (true) o fuera de ella (false). */
async function condominioSuper(p: Item, yo: Yo, papelera = false) {
  exigirSuper(yo);
  const c = await get('Condominio', { id: str(p.condominioId, 64) });
  if (!c) fail('Condominio no encontrado.');
  if (enPapelera(c) !== papelera) fail(papelera ? 'El condominio no está en la papelera.' : 'El condominio está en la papelera.');
  return c!;
}
/** Eliminar pide escribir el nombre del condominio (sin importar mayúsculas ni espacios de más). */
function confirmarNombre(c: Item, p: Item) {
  const norm = (x: unknown) => String(x ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!norm(p.confirmacion) || norm(p.confirmacion) !== norm(c.nombre)) fail('Escribe el nombre exacto del condominio para confirmar.');
}

const acciones: Record<string, (p: Item, yo: Yo) => Promise<unknown>> = {
  // Permisos efectivos de quien llama (el panel muestra solo lo permitido).
  async yo(_p, yo) {
    return {
      email: yo.email,
      nombre: (await get('Perfil', { userId: yo.sub }))?.nombre || null,
      superadmin: yo.superadmin,
      rol: yo.rolNombre,
      permisos: yo.permisos,
      condominios: yo.condos === '*' ? '*' : [...yo.condos],
    };
  },

  db,
  archivo,
  ...accionesDocumentos,
  ...accionesIncidentes,
  ...accionesEncuestas,
  ...accionesComunicados,
  ...accionesFinanzas,

  // ----- app y notificaciones push (solo categorías que su rol permite) -----
  ...Object.fromEntries(
    ['estado', 'suscribir', 'baja', 'preferencias', 'probar'].map((a) => [
      `notificaciones.${a}`,
      (p: Item, yo: Yo) => {
        const categorias = CATEGORIAS_ADMIN.filter(
          (c) => yo.superadmin || (alcanza(yo.permisos.secciones[c.seccion], c.nivel) && (!c.extra || yo.permisos.extras.includes(c.extra))),
        ).map(({ key, label, desc }) => ({ key, label, desc }));
        return accionNotificaciones(`notificaciones.${a}`, p, yo.sub, categorias, '/admin/');
      },
    ]),
  ),

  // ----- roles de administración (solo superadministrador) -----
  async 'roles.lista'(_p, yo) {
    exigirSuper(yo);
    const [roles, perfiles] = await Promise.all([scan('RolAdmin'), scan('Perfil')]);
    return roles
      .map((r) => ({
        id: r.id,
        nombre: r.nombre,
        descripcion: r.descripcion ?? '',
        permisos: normalizarPermisos(r.permisos),
        asignados: perfiles.filter((p) => p.rol === 'ADMIN' && p.rolAdminId === r.id).length,
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  },

  async 'roles.guardar'(p, yo) {
    exigirSuper(yo);
    const nombre = str(p.nombre, 80);
    if (!nombre) fail('Escribe el nombre del rol.');
    const campos = { nombre, descripcion: str(p.descripcion, 300) || null, permisos: JSON.stringify(normalizarPermisos(p.permisos)) };
    const id = str(p.id, 64);
    if (id) return update('RolAdmin', { id }, campos);
    return put('RolAdmin', campos);
  },

  async 'roles.eliminar'(p, yo) {
    exigirSuper(yo);
    const id = str(p.id, 64);
    const usados = (await scan('Perfil')).filter((x) => x.rol === 'ADMIN' && x.rolAdminId === id);
    if (usados.length) fail(`El rol está asignado a ${usados.length} administrador(es). Cámbiales el rol antes de eliminarlo.`);
    await remove('RolAdmin', { id });
    return { ok: true };
  },

  // Crea los roles sugeridos que aún no existan.
  async 'roles.sugeridos'(_p, yo) {
    exigirSuper(yo);
    let creados = 0;
    for (const r of ROLES_INICIALES) {
      try {
        await put(
          'RolAdmin',
          { id: r.id, nombre: r.nombre, descripcion: r.descripcion, permisos: JSON.stringify(r.permisos) },
          { ifNotExists: 'id' },
        );
        creados++;
      } catch (err: any) {
        if (err?.name !== 'ConditionalCheckFailedException') throw err;
      }
    }
    return { creados };
  },

  // ----- usuarios -----
  async crearUsuario(p, yo) {
    return altaUsuario(p, yo);
  },

  async 'residentes.editar'(p, yo) {
    return editarPersona(await perfilDe(str(p.userId, 64)), p, yo);
  },

  // Aprueba una solicitud (o cambia rol / condominio / unidad / permisos de un usuario existente).
  async aprobar(p, yo) {
    const perfil = await perfilDe(str(p.userId, 64));
    exigirGestionable(yo, perfil);
    const asignacion = await validarAsignacion(p, yo);
    if (perfil.userId === yo.sub && asignacion.rol !== perfil.rol) fail('No puedes cambiar tu propio rol.');
    await asignarGrupo(perfil.userId, asignacion.rol);
    const r = await update('Perfil', { userId: perfil.userId }, { ...asignacion, estado: 'APROBADO', nota: str(p.nota, 500) || null });
    // Con otro rol, las sesiones abiertas conservarían el grupo anterior: se cierran.
    if (perfil.estado === 'APROBADO' && perfil.rol !== asignacion.rol) await cerrarSesiones(perfil.userId);
    return r;
  },

  // Reenvía por correo los accesos con una contraseña temporal nueva.
  // Si el usuario ya había creado su contraseña, deja de funcionar y deberá crear otra al entrar.
  async reenviarAcceso(p, yo) {
    const perfil = await perfilDe(str(p.userId, 64));
    exigirGestionable(yo, perfil);
    exigir(yo, seccionDe(perfil), 'editar');
    if (perfil.estado !== 'APROBADO') fail('Solo se reenvía el acceso a usuarios autorizados.');
    await enviarAccesos(perfil.userId);
    anotar('Perfil', perfil, 'acceso', 'Se reenvió el acceso por correo');
    return { ok: true, email: perfil.email };
  },

  // Contraseña definitiva que escribe la administración para compartirla (residentes que no revisan o no
  // tienen correo). La anterior deja de funcionar y se cierran sus sesiones abiertas.
  async generarContrasena(p, yo) {
    const perfil = await perfilDe(str(p.userId, 64));
    exigirGestionable(yo, perfil);
    exigir(yo, seccionDe(perfil), 'editar');
    if (perfil.estado !== 'APROBADO') fail('Solo se asigna contraseña a usuarios autorizados.');
    const password = typeof p.password === 'string' ? p.password : '';
    if (password.length < 8 || password.length > 64 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password) || /\s/.test(password)) {
      fail('La contraseña debe tener al menos 8 caracteres, sin espacios, con mayúscula, minúscula, número y símbolo.');
    }
    try {
      await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId, Username: perfil.userId, Password: password, Permanent: true }));
    } catch (err: any) {
      if (err?.name === 'InvalidPasswordException') fail('La contraseña no cumple las reglas de seguridad.');
      throw err;
    }
    await cerrarSesiones(perfil.userId);
    if (perfil.accesoSinEnviar) await update('Perfil', { userId: perfil.userId }, { accesoSinEnviar: null });
    anotar('Perfil', perfil, 'acceso', 'Se asignó una contraseña nueva');
    return { ok: true, email: perfil.email };
  },

  // Estado de cada cuenta visible en Cognito: invitación sin usar, activa o deshabilitada.
  async estadoCuentas(_p, yo) {
    exigir(yo, 'usuarios', 'ver');
    const visibles = new Set((await perfilesVisibles(yo)).map((x) => x.userId as string));
    const r: Record<string, { status?: string; enabled?: boolean; creado?: string }> = {};
    let PaginationToken: string | undefined;
    do {
      const page = await cognito.send(new ListUsersCommand({ UserPoolId, PaginationToken }));
      for (const u of page.Users ?? []) {
        const sub = u.Attributes?.find((x) => x.Name === 'sub')?.Value ?? u.Username!;
        if (visibles.has(sub)) r[sub] = { status: u.UserStatus, enabled: u.Enabled, creado: u.UserCreateDate?.toISOString() };
      }
      PaginationToken = page.PaginationToken;
    } while (PaginationToken);
    return r;
  },

  async rechazar(p, yo) {
    const perfil = await perfilDe(str(p.userId, 64));
    exigirGestionable(yo, perfil);
    exigir(yo, seccionDe(perfil), 'editar');
    if (perfil.userId === yo.sub) fail('No puedes rechazar tu propia cuenta.');
    // Sin grupo y sin sesiones: un rechazo no deja acceso al panel ni al portal.
    await quitarGrupos(perfil.userId);
    await cerrarSesiones(perfil.userId);
    return update('Perfil', { userId: perfil.userId }, { estado: 'RECHAZADO', nota: str(p.nota, 500) || null });
  },

  async suspender(p, yo) {
    const perfil = await perfilDe(str(p.userId, 64));
    exigirGestionable(yo, perfil);
    exigir(yo, seccionDe(perfil), 'editar');
    if (perfil.userId === yo.sub) fail('No puedes suspender tu propia cuenta.');
    await cognito.send(new AdminDisableUserCommand({ UserPoolId, Username: perfil.userId }));
    await cerrarSesiones(perfil.userId);
    return update('Perfil', { userId: perfil.userId }, { estado: 'SUSPENDIDO' });
  },

  async reactivar(p, yo) {
    const perfil = await perfilDe(str(p.userId, 64));
    exigirGestionable(yo, perfil);
    exigir(yo, seccionDe(perfil), 'editar');
    await cognito.send(new AdminEnableUserCommand({ UserPoolId, Username: perfil.userId }));
    return update('Perfil', { userId: perfil.userId }, { estado: 'APROBADO' });
  },

  async eliminarUsuario(p, yo) {
    const perfil = await perfilDe(str(p.userId, 64));
    exigirGestionable(yo, perfil);
    exigirExtra(yo, 'usuarios.eliminar');
    if (perfil.userId === yo.sub) fail('No puedes eliminar tu propia cuenta.');
    try {
      await cognito.send(new AdminDeleteUserCommand({ UserPoolId, Username: perfil.userId }));
    } catch (err: any) {
      if (err?.name !== 'UserNotFoundException') throw err;
    }
    await remove('Perfil', { userId: perfil.userId });
    return { ok: true };
  },

  // ----- finanzas -----
  // Valida o rechaza un comprobante. Al validar asigna folio consecutivo por condominio y liquida los cargos.
  async validarPago(p, yo) {
    exigirExtra(yo, 'finanzas.validarPagos');
    const pago = await get('Pago', { id: str(p.pagoId, 64) });
    if (!pago) fail('Pago no encontrado.');
    exigirCondo(yo, pago!.condominioId);
    if (pago!.estado !== 'EN_REVISION') fail('El pago ya fue procesado.');
    const nota = str(p.nota, 500) || null;
    // El cambio de estado es condicional: si otro administrador lo procesó al mismo tiempo, falla aquí.
    const marcar = (campos: Item) =>
      update('Pago', { id: pago!.id }, campos, { estado: 'EN_REVISION' }).catch((err) => {
        if (err?.name === 'ConditionalCheckFailedException') fail('El pago ya fue procesado.');
        throw err;
      });
    if (!p.aprobar) {
      const r = await marcar({ estado: 'RECHAZADO', nota, validadoPor: yo.email, validadoEn: now() });
      await put('Aviso', {
        condominioId: pago!.condominioId,
        unidadId: pago!.unidadId,
        tipo: 'PAGO',
        titulo: 'Tu pago no fue aprobado',
        texto: nota ?? 'Comunícate con la administración para más detalles.',
        leido: false,
      });
      return r;
    }
    // Reservas de amenidades que se pagan con este comprobante: se aprueban al validar (bloquean el horario).
    const reservas = (
      await Promise.all(
        (pago!.cargoIds ?? [])
          .filter((id: string) => id.startsWith('reserva#'))
          .map((id: string) => get('Reserva', { id: id.slice('reserva#'.length) })),
      )
    ).filter((r): r is Item => !!r && r.estado === 'PENDIENTE_PAGO');
    for (const r of reservas) {
      const choque = await choqueAprobado(r);
      if (choque) {
        fail(
          `El ${r.fecha} de ${r.horaInicio} a ${r.horaFin} ya fue apartado por otra unidad (${choque.nombre}). Rechaza este pago o comunícate con el residente.`,
        );
      }
    }
    await marcar({ estado: 'VALIDADO', nota, validadoPor: yo.email, validadoEn: now() });
    const seq = await ddb.send(
      new UpdateCommand({
        TableName: table('Condominio'),
        Key: { id: pago!.condominioId },
        UpdateExpression: 'ADD folioSeq :uno',
        ExpressionAttributeValues: { ':uno': 1 },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    const folio = `R-${String(seq.Attributes?.folioSeq ?? 1).padStart(5, '0')}`;
    await Promise.all((pago!.cargoIds ?? []).map((id: string) => update('Cargo', { id }, { estado: 'PAGADO' }).catch(() => undefined)));
    const r = await update('Pago', { id: pago!.id }, { folio });
    for (const x of reservas) await confirmarReserva(x, 'Tu reserva quedó confirmada');
    await put('Aviso', {
      condominioId: pago!.condominioId,
      unidadId: pago!.unidadId,
      tipo: 'PAGO',
      titulo: `Tu pago fue aprobado · recibo ${folio}`,
      texto: `Aprobamos tu pago por ${new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(pago!.monto)}. Ya puedes descargar tu recibo en Finanzas.`,
      leido: false,
    });
    return r;
  },

  // Genera la cuota del periodo para cada unidad con cuota > 0 (idempotente por unidad y periodo).
  async generarCargos(p, yo) {
    exigirExtra(yo, 'finanzas.generarCuotas');
    const c = await get('Condominio', { id: str(p.condominioId, 64) });
    if (!c) fail('Selecciona el condominio.');
    exigirCondo(yo, c!.id);
    if (c!.cuotaAutomatica) fail('Este condominio genera sus cuotas automáticamente cada mes. Desactiva la cuota automática en Condominios › Cuotas y pagos para generarlas a mano.');
    const periodo = str(p.periodo, 7);
    if (!/^\d{4}-\d{2}$/.test(periodo)) fail('Periodo no válido (AAAA-MM).');
    const { creados, omitidos } = await crearCuotas(c!, periodo, {
      vence: /^\d{4}-\d{2}-\d{2}$/.test(p.vence) ? p.vence : undefined,
      concepto: str(p.concepto, 120),
    });
    return { creados, omitidos };
  },

  // Cuota extraordinaria: un cargo por unidad (todas o las indicadas), agrupados por el id «extra#<grupo>#<unidad>».
  async cargoExtraordinario(p, yo) {
    exigir(yo, 'finanzas', 'editar');
    const c = await get('Condominio', { id: str(p.condominioId, 64) });
    if (!c) fail('Selecciona el condominio.');
    exigirCondo(yo, c!.id);
    const concepto = str(p.concepto, 120);
    const monto = Math.round(Number(p.monto) * 100) / 100;
    if (!concepto) fail('Escribe el concepto.');
    if (!(monto > 0) || monto > 10_000_000) fail('Indica un monto válido.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.vence)) fail('Indica la fecha límite de pago.');
    const todas = await byIndex('Unidad', 'byCondominio', 'condominioId', c!.id);
    const ids: string[] | null = Array.isArray(p.unidadIds) ? p.unidadIds.map((x: unknown) => str(x, 64)) : null;
    const destino = ids ? todas.filter((u) => ids.includes(u.id)) : todas;
    if (!destino.length) fail('El condominio no tiene unidades.');
    const tipo = (TIPOS_CARGO_MANUAL as readonly string[]).includes(p.tipo) ? p.tipo : 'RECAUDACION';
    const grupo = randomUUID().slice(0, 8);
    for (let i = 0; i < destino.length; i += 25) {
      await Promise.all(
        destino.slice(i, i + 25).map((u) =>
          put('Cargo', {
            id: `extra#${grupo}#${u.id}`,
            condominioId: c!.id,
            unidadId: u.id,
            concepto,
            periodo: p.vence.slice(0, 7),
            monto,
            vence: p.vence,
            estado: 'PENDIENTE',
            tipo,
          }),
        ),
      );
    }
    return { creados: destino.length };
  },

  // Alta masiva desde el machote de Excel: una fila por casa o departamento (número, residente, teléfono, correo,
  // fecha de entrega). Crea la unidad si no existe, guarda los cambios de la existente y, si trae correo, da de alta
  // al residente (con accesos por correo) o actualiza sus datos. Las celdas vacías no borran datos.
  async 'residentes.importar'(p, yo) {
    exigir(yo, 'condominios', 'editar');
    const c = await get('Condominio', { id: str(p.condominioId, 64) });
    if (!c) fail('Selecciona el condominio.');
    exigirCondo(yo, c!.id);
    const filas: Item[] = Array.isArray(p.filas) ? p.filas.slice(0, 25) : [];
    const porClave = new Map((await byIndex('Unidad', 'byCondominio', 'condominioId', c!.id)).map((u) => [claveUnidad(u.etiqueta), u]));
    const perfiles = await byIndex('Perfil', 'byCondominio', 'condominioId', c!.id);
    // enviarCorreo: false → altas y cambios de correo sin enviar accesos (se envían o se asigna contraseña después).
    const enviarCorreo = p.enviarCorreo !== false;
    const out: { etiqueta: string; unidad?: 'creada' | 'existente'; acceso?: boolean; correo?: boolean; cambios: string[]; error?: string }[] = [];
    for (const f of filas) {
      const etiqueta = etiquetaUnidad(f?.numero, c!.tipoUnidad);
      const r: (typeof out)[number] = { etiqueta, cambios: [] };
      out.push(r);
      try {
        if (!etiqueta) fail('Falta el número de casa o departamento.');
        const email = str(f.correo, 200).toLowerCase();
        if (email) exigir(yo, 'usuarios', 'editar');
        const fechaEntrega = /^\d{4}-\d{2}-\d{2}$/.test(f.fechaEntrega) ? f.fechaEntrega : null;
        let u = porClave.get(claveUnidad(etiqueta));
        if (!u) {
          u = await put('Unidad', { condominioId: c!.id, etiqueta, fechaEntrega });
          porClave.set(claveUnidad(etiqueta), u);
          r.unidad = 'creada';
        } else {
          r.unidad = 'existente';
          if (fechaEntrega && u.fechaEntrega !== fechaEntrega) {
            await update('Unidad', { id: u.id }, { fechaEntrega });
            r.cambios.push('fechaEntrega');
          }
        }
        if (email) {
          // Mismo correo → actualiza sus datos; unidad sin residente → alta; un solo residente con otro correo → cambia su correo.
          const suyos = perfiles.filter((x) => x.rol === 'RESIDENTE' && x.unidadId === u!.id && x.estado !== 'RECHAZADO');
          const mismo = suyos.find((x) => x.email === email) ?? (suyos.length === 1 ? suyos[0] : undefined);
          if (mismo) {
            const e = await editarPersona(mismo, { nombre: f.nombre, telefono: f.telefono, telefono2: f.telefono2, email, enviarCorreo }, yo);
            r.cambios.push(...e.cambios);
            if (e.cambios.includes('email')) r.correo = e.correoEnviado;
          } else if (suyos.length) {
            fail('La unidad tiene varios residentes; cambia sus datos desde la lista.');
          } else {
            const nuevo = await altaUsuario({ email, nombre: f.nombre, telefono: f.telefono, telefono2: f.telefono2, rol: 'RESIDENTE', condominioId: c!.id, unidadId: u!.id, enviarCorreo }, yo);
            perfiles.push(nuevo);
            r.acceso = true;
            r.correo = nuevo.correoEnviado;
          }
        }
      } catch (err) {
        if (!(err instanceof ApiError)) console.error('importar', err);
        r.error = err instanceof ApiError ? err.message : 'No se pudo guardar.';
      }
    }
    return out;
  },

  // Aviso a una unidad (al atender un incidente, reserva, mascota…) o a todas las unidades del condominio.
  async avisar(p, yo) {
    const c = await get('Condominio', { id: str(p.condominioId, 64) });
    if (!c) fail('Selecciona el condominio.');
    exigirCondo(yo, c!.id);
    if (!yo.superadmin) {
      const gestiona = (s: string) => yo.permisos.secciones[s] === 'editar';
      const ok = p.unidadId ? Object.keys(yo.permisos.secciones).some(gestiona) : gestiona('comunicados') || gestiona('encuestas');
      if (!ok) fail('Tu rol no permite enviar avisos a los residentes.');
    }
    const titulo = str(p.titulo, 140);
    if (!titulo) fail('Escribe el título del aviso.');
    const unidades = p.unidadId
      ? [await get('Unidad', { id: str(p.unidadId, 64) })].filter((u) => u?.condominioId === c!.id)
      : await byIndex('Unidad', 'byCondominio', 'condominioId', c!.id);
    await Promise.all(
      unidades.map((u) =>
        put('Aviso', { condominioId: c!.id, unidadId: u!.id, tipo: str(p.tipo, 30) || 'ADMIN', titulo, texto: str(p.texto, 1000), leido: false }),
      ),
    );
    return { enviados: unidades.length };
  },

  async hoy() {
    return { hoy: hoyMX() };
  },

  // ----- proveedores (bitácora de trabajo; ver shared/proveedores.ts) -----
  // Proveedores que atienden el condominio, con el estado de su cuenta.
  async 'proveedores.lista'(p, yo) {
    exigir(yo, 'proveedores', 'ver');
    const cid = str(p.condominioId, 64);
    exigirCondo(yo, cid);
    const lista = (await scan('Perfil')).filter((x) => x.rol === 'PROVEEDOR' && (x.condominiosServicio ?? []).includes(cid));
    return Promise.all(
      lista.map(async ({ __typename, firma, firmaCambio, ...x }) => {
        const u = await cognito.send(new AdminGetUserCommand({ UserPoolId, Username: x.userId })).catch(() => undefined);
        return { ...x, cuenta: u?.UserStatus ?? null };
      }),
    );
  },

  // Datos del proveedor, sus servicios y los condominios que atiende (solo cambia los condominios de quien llama).
  async 'proveedores.editar'(p, yo) {
    exigir(yo, 'proveedores', 'editar');
    const perfil = await perfilDe(str(p.userId, 64));
    if (perfil.rol !== 'PROVEEDOR') fail('Esa cuenta no es de un proveedor.');
    exigirGestionable(yo, perfil);
    const servicios = serviciosDe(p.servicios);
    if (!servicios.length) fail('Elige al menos un servicio que da.');
    const pedidos = condominiosDe(p.condominiosServicio, yo);
    const ajenos = (perfil.condominiosServicio ?? []).filter((c: string) => !enAlcance(yo, c));
    const condominiosServicio = [...new Set([...ajenos, ...pedidos])];
    if (!condominiosServicio.length) fail('Debe quedar al menos un condominio asignado.');
    const r = await editarPersona(perfil, { nombre: p.nombre, telefono: p.telefono, email: p.email, enviarCorreo: p.enviarCorreo }, yo);
    await update('Perfil', { userId: perfil.userId }, { empresa: str(p.empresa, 120) || null, servicios, condominiosServicio });
    return r;
  },

  // Reportes de un mes (AAAA-MM) del condominio: por proveedor y para la administración o los residentes.
  async 'proveedores.reportes'(p, yo) {
    exigir(yo, 'proveedores', 'ver');
    const cid = str(p.condominioId, 64);
    exigirCondo(yo, cid);
    const mes = /^\d{4}-\d{2}$/.test(p.mes) ? p.mes : hoyMX().slice(0, 7);
    const proveedorId = str(p.proveedorId, 64);
    const destino = p.destino === 'RESIDENTES' ? 'RESIDENTES' : 'ADMIN';
    const items = (await byIndex('ReporteProveedor', 'byCondominio', 'condominioId', cid)).filter(
      (r) => String(r.fecha).startsWith(mes) && r.destino === destino && (!proveedorId || r.proveedorId === proveedorId),
    );
    const firmar = (k: string) => getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.BUCKET!, Key: k }), { expiresIn: 3600 });
    return Promise.all(
      items
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .map(async ({ __typename, ...r }) => ({
          ...r,
          fotos: await Promise.all(listaJson<FotoReporte>(r.fotos).map(async (f) => ({ descripcion: f.descripcion, url: await firmar(f.path) }))),
        })),
    );
  },

  // ----- cotizaciones y mensajes del sitio público (Lambda siia-cotizaciones) -----
  // Todas, de la más reciente a la más antigua; no dependen de un condominio.
  async 'cotizaciones.lista'(_p, yo) {
    exigir(yo, 'cotizaciones', 'ver');
    return (await scan('Cotizacion'))
      .map(({ __typename, ipHash, respondidaPor, ...c }) => {
        // Quién la respondió: los administradores ven el nombre; el correo, solo el superadministrador.
        const por = jsonDe(respondidaPor);
        if (por && !yo.superadmin) delete por.email;
        return { ...c, respondidaPor: por } as Item;
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  },

  // «Respondido al solicitante»: deja de estar pendiente para todos y queda quién y cuándo la respondió.
  async 'cotizaciones.responder'(p, yo) {
    exigir(yo, 'cotizaciones', 'editar');
    const id = str(p.id, 64);
    const c = await get('Cotizacion', { id });
    if (!c) fail('Solicitud no encontrada.');
    if (c!.estado === 'RESPONDIDA') fail(`Ya la marcó como respondida ${jsonDe(c!.respondidaPor)?.nombre ?? 'otro administrador'}.`);
    const respondidaPor = { id: yo.sub, nombre: yo.nombre, email: yo.email };
    await update(
      'Cotizacion',
      { id },
      { estado: 'RESPONDIDA', respondidaEn: now(), respondidaPor: JSON.stringify(respondidaPor), notaRespuesta: str(p.nota, 1000) || null },
      { estado: 'PENDIENTE' },
    ).catch((e) => {
      if (e?.name === 'ConditionalCheckFailedException') fail('Otro administrador acaba de marcarla como respondida.');
      throw e;
    });
    return { ok: true };
  },

  // Por si se marcó por error (solo superadministrador): vuelve a pendiente.
  async 'cotizaciones.reabrir'(p, yo) {
    exigirSuper(yo);
    const id = str(p.id, 64);
    if (!(await get('Cotizacion', { id }))) fail('Solicitud no encontrada.');
    await update('Cotizacion', { id }, { estado: 'PENDIENTE', respondidaEn: null, respondidaPor: null, notaRespuesta: null });
    return { ok: true };
  },

  // ----- suspender, eliminar (papelera de 30 días) y restaurar condominios (solo superadministrador) -----
  async 'condominios.suspender'(p, yo) {
    const c = await condominioSuper(p, yo);
    if (suspendido(c)) fail('El condominio ya está suspendido.');
    const motivo = str(p.motivo, 300);
    if (!motivo) fail('Escribe el motivo de la suspensión.');
    await update('Condominio', { id: c.id }, { suspendido: true, suspension: JSON.stringify({ motivo, en: now(), por: yo.email, porNombre: yo.nombre }) });
    return { ok: true };
  },

  async 'condominios.reactivar'(p, yo) {
    const c = await condominioSuper(p, yo);
    if (!suspendido(c)) fail('El condominio no está suspendido.');
    await update('Condominio', { id: c.id }, { suspendido: null, suspension: null });
    return { ok: true };
  },

  // A la papelera: desaparece para todos y sus cuentas se desactivan; se borra definitivamente a los 30 días.
  async 'condominios.eliminar'(p, yo) {
    const c = await condominioSuper(p, yo);
    confirmarNombre(c, p);
    const eliminadoEn = now();
    await update('Condominio', { id: c.id }, { eliminadoEn, eliminacion: JSON.stringify({ por: yo.email, porNombre: yo.nombre, cuentas: [] }) });
    await enviarAPapelera({ accion: 'desactivar', condominioId: c.id });
    return { ok: true, borraEl: fechaBorrado(eliminadoEn) };
  },

  async 'condominios.papelera'(_p, yo) {
    exigirSuper(yo);
    const condos = (await scan('Condominio')).filter((c) => enPapelera(c));
    return Promise.all(
      condos
        .sort((a, b) => String(b.eliminadoEn).localeCompare(String(a.eliminadoEn)))
        .map(async (c) => {
          const e = jsonDe(c.eliminacion);
          const [unidades, cuentas] = await Promise.all([
            byIndex('Unidad', 'byCondominio', 'condominioId', c.id),
            byIndex('Perfil', 'byCondominio', 'condominioId', c.id),
          ]);
          return {
            id: c.id,
            nombre: c.nombre,
            tipo: c.tipo ?? null,
            eliminadoEn: c.eliminadoEn,
            borraEl: fechaBorrado(c.eliminadoEn),
            porNombre: e?.porNombre ?? null,
            por: e?.por ?? null,
            purgando: !!e?.purgando,
            unidades: unidades.length,
            cuentas: cuentas.filter((x) => !ES_ADMIN(x.rol)).length,
          };
        }),
    );
  },

  async 'condominios.restaurar'(p, yo) {
    const c = await condominioSuper(p, yo, true);
    const e = jsonDe(c.eliminacion);
    if (e?.purgando) fail('Este condominio ya se está borrando definitivamente.');
    await update('Condominio', { id: c.id }, { eliminadoEn: null, eliminacion: null });
    const cuentas: string[] = Array.isArray(e?.cuentas) ? e!.cuentas : [];
    if (cuentas.length) await enviarAPapelera({ accion: 'reactivar', condominioId: c.id, cuentas });
    return { ok: true, cuentas: cuentas.length };
  },

  // Sin esperar los 30 días: borra todo en los próximos minutos. No hay vuelta atrás.
  async 'condominios.borrarDefinitivo'(p, yo) {
    const c = await condominioSuper(p, yo, true);
    confirmarNombre(c, p);
    const e = jsonDe(c.eliminacion) ?? {};
    await update('Condominio', { id: c.id }, { eliminacion: JSON.stringify({ ...e, purgando: true, purgaPor: yo.email, purgaPorNombre: yo.nombre }) });
    await enviarAPapelera({ accion: 'purgar', condominioId: c.id });
    return { ok: true };
  },

  // ----- registro de actividad y administradores por condominio (solo superadministrador) -----
  async 'actividad.lista'(p, yo) {
    exigirSuper(yo);
    const condominioId = p.condominioId === 'GLOBAL' ? 'GLOBAL' : str(p.condominioId, 64);
    if (!condominioId) fail('Elige un condominio.');
    const desde = fechaValida(p.desde) || hoyMX(new Date(Date.now() - 30 * 86400000));
    const hasta = fechaValida(p.hasta) || hoyMX();
    // Fechas en hora de México (UTC-6): el día completo de «hasta».
    const ini = new Date(`${desde}T00:00:00-06:00`).toISOString();
    const fin = new Date(`${hasta}T23:59:59.999-06:00`).toISOString();
    const items: Item[] = [];
    let ExclusiveStartKey: Item | undefined;
    do {
      const r = await ddb.send(
        new QueryCommand({
          TableName: table('Actividad'),
          IndexName: 'byCondominio',
          KeyConditionExpression: 'condominioId = :c AND fecha BETWEEN :a AND :b',
          ExpressionAttributeValues: { ':c': condominioId, ':a': ini, ':b': fin },
          ScanIndexForward: false,
          ExclusiveStartKey,
        }),
      );
      items.push(...(r.Items ?? []));
      ExclusiveStartKey = r.LastEvaluatedKey;
    } while (ExclusiveStartKey && items.length < 2000);
    return items.map(({ cambios, __typename, ...x }) => {
      let c: unknown = cambios;
      for (let k = 0; k < 2 && typeof c === 'string'; k++) c = JSON.parse(c as string);
      return { ...x, cambios: Array.isArray(c) ? c : [] };
    });
  },

  async 'condominios.administradores'(p, yo) {
    exigirSuper(yo);
    const condominioId = str(p.condominioId, 64);
    const [perfiles, roles] = await Promise.all([scan('Perfil'), scan('RolAdmin')]);
    return perfiles
      .filter((x) => x.rol === 'ADMIN' && x.estado !== 'RECHAZADO')
      .map((x) => {
        const lista: string[] = (x.condominiosAdmin ?? []).filter(Boolean);
        return {
          userId: x.userId,
          nombre: x.nombre ?? null,
          email: x.email,
          estado: x.estado,
          rol: roles.find((r) => r.id === x.rolAdminId)?.nombre ?? 'Sin rol',
          todos: lista.includes('*'),
          asignado: lista.includes('*') || lista.includes(condominioId),
          condominios: lista.includes('*') ? null : lista.length,
        };
      })
      .sort((a, b) => String(a.nombre || a.email).localeCompare(String(b.nombre || b.email)));
  },

  async 'condominios.asignarAdmin'(p, yo) {
    exigirSuper(yo);
    const condominioId = str(p.condominioId, 64);
    const condo = await get('Condominio', { id: condominioId });
    if (!condo) fail('Condominio no encontrado.');
    const perfil = await perfilDe(str(p.userId, 64));
    if (perfil.rol !== 'ADMIN') fail('Solo se asignan condominios a cuentas de administrador.');
    const lista: string[] = (perfil.condominiosAdmin ?? []).filter(Boolean);
    if (lista.includes('*')) fail('Este administrador tiene «Todos los condominios». Cámbialo desde Administradores.');
    const nueva = p.asignar ? [...new Set([...lista, condominioId])] : lista.filter((x) => x !== condominioId);
    // Su permiso se lee en cada petición: el cambio aplica de inmediato, sin cerrar su sesión.
    await update('Perfil', { userId: perfil.userId }, { condominiosAdmin: nueva });
    // También en la actividad del condominio (la cuenta del administrador va al registro GLOBAL).
    anotar('Condominio', condo!, 'administradores', `${p.asignar ? 'Asignó' : 'Quitó'} a ${perfil.nombre || perfil.email}`);
    return { ok: true, condominios: nueva };
  },
};

export const handler = async (event: AppSyncResolverEvent<{ action: string; payload?: unknown }>) => {
  const action = String(event.arguments.action ?? '');
  let yo: Yo | undefined;
  firmarComo(null);
  try {
    yo = await cargarYo(event.identity as any);
    if (!Object.hasOwn(acciones, action)) fail('Acción no válida.');
    // Todo lo que se guarde en esta petición lleva la firma de quien la hace.
    firmarComo({ id: yo.sub, nombre: yo.nombre, email: yo.email, rol: yo.superadmin ? 'SUPERADMIN' : 'ADMIN' });
    const r = await acciones[action](parsePayload(event.arguments.payload), yo);
    // Los administradores ven quién hizo cada cosa por su nombre; el correo, solo el superadministrador.
    return yo.superadmin ? r : sinCorreos(r);
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    console.error(action, err);
    return { error: 'Ocurrió un error. Intenta de nuevo.' };
  } finally {
    // Aun si la acción falló a la mitad, lo que sí se guardó queda en la actividad.
    if (yo) await guardarActividad(action, { id: yo.sub, nombre: yo.nombre, email: yo.email, rol: yo.superadmin ? 'SUPERADMIN' : 'ADMIN' }, tomarCambios()).catch((e) => console.error('actividad', e));
    firmarComo(null);
  }
};
