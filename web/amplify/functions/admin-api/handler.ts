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
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
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
import { cancelarCargoReserva, choqueAprobado, confirmarReserva } from '../shared/reservas';
import { MAX_ACCESOS, TIPOS_ACCESO, accesosDe, claveCodigo } from '../shared/accesos';
import { CATEGORIAS_EGRESO, FONDO_AMENIDADES, MAX_EVIDENCIAS_EGRESO, TIPOS_CARGO_MANUAL } from '../shared/finanzas';
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
const ROLES = ['SUPERADMIN', 'ADMIN', 'RESIDENTE', 'VIGILANTE'] as const;
type Rol = (typeof ROLES)[number];
const ES_ADMIN = (rol?: string | null) => rol === 'ADMIN' || rol === 'SUPERADMIN';

// ---------- quién llama y qué puede hacer ----------
type Yo = {
  sub: string;
  email: string;
  superadmin: boolean;
  permisos: Permisos;
  condos: '*' | Set<string>;
  rolNombre: string;
};

async function cargarYo(identity: any): Promise<Yo> {
  const grupos: string[] = identity?.groups ?? identity?.claims?.['cognito:groups'] ?? [];
  const sub: string = identity?.sub;
  const email = identity?.claims?.email || (await emailDe(sub).catch(() => sub));
  if (grupos.includes('SUPERADMIN')) {
    return { sub, email, superadmin: true, permisos: TODOS_LOS_PERMISOS, condos: '*', rolNombre: 'Superadministrador' };
  }
  if (!grupos.includes('ADMIN')) fail('Acceso solo para administradores.');
  const perfil = await get('Perfil', { userId: sub });
  if (!perfil || perfil.estado !== 'APROBADO' || perfil.rol !== 'ADMIN') fail('Tu cuenta de administración no está activa.');
  const rol = perfil!.rolAdminId ? await get('RolAdmin', { id: perfil!.rolAdminId }) : undefined;
  const lista: string[] = (perfil!.condominiosAdmin ?? []).filter(Boolean);
  return {
    sub,
    email,
    superadmin: false,
    permisos: rol ? normalizarPermisos(rol.permisos) : SIN_PERMISOS,
    condos: lista.includes('*') ? '*' : new Set(lista),
    rolNombre: rol?.nombre ?? 'Sin rol asignado',
  };
}

const enAlcance = (yo: Yo, condominioId?: string | null) => !!condominioId && (yo.condos === '*' || yo.condos.has(condominioId));

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
  if (!enAlcance(yo, condominioId)) fail('No tienes asignado ese condominio.');
}
function exigirSuper(yo: Yo) {
  if (!yo.superadmin) fail('Solo el superadministrador puede hacer esto.');
}
/** Un ADMIN solo administra residentes y vigilantes de sus condominios; el SUPERADMIN, a todos. */
function exigirGestionable(yo: Yo, perfil: Item) {
  if (yo.superadmin) return;
  if (ES_ADMIN(perfil.rol)) fail('Solo el superadministrador administra cuentas de administración.');
  exigirCondo(yo, perfil.condominioId);
}

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
const CAMPOS_PAGO = ['datosPago', 'banco', 'beneficiario', 'clabe', 'cuentaBancaria', 'referenciaPago', 'notasPago', 'cuotaMensual', 'diaVencimiento', 'recargoActivo', 'recargoMonto', 'recargoDesde'];

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
    const creado = resultado(await M.create(input));
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
      return resultado(await M.delete({ id }));
    }
    if (!regla!.editar) fail('Operación no permitida.');
    soloCampos(input, regla!.editar!, ['id']);
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
      return resultado(await M.update({ id: actual!.id, ...(nota !== undefined ? { nota } : {}) }));
    }
    if (m === 'Reserva' && (input.estado === 'RECHAZADA' || input.estado === 'CANCELADA')) await cancelarCargoReserva(actual!.id);
    return resultado(await M.update(input));
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
        return { ...a, estado: c.estado, estadoEn: ts, estadoPor: yo.email };
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

type Asignacion = { rol: Rol; condominioId: string | null; unidadId: string | null; rolAdminId: string | null; condominiosAdmin: string[] | null };

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
async function altaUsuario(p: Item, yo: Yo) {
  const email = str(p.email, 200).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('Correo no válido.');
  const nombre = str(p.nombre, 120);
  const asignacion = await validarAsignacion(p, yo);
  let sub: string | undefined;
  try {
    const r = await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
          ...(nombre ? [{ Name: 'name', Value: nombre }] : []),
        ],
        DesiredDeliveryMediums: ['EMAIL'],
      }),
    );
    sub = r.User?.Attributes?.find((a) => a.Name === 'sub')?.Value;
  } catch (err: any) {
    if (err?.name === 'UsernameExistsException') fail('Ya existe un usuario con ese correo.');
    throw err;
  }
  if (!sub) fail('No se pudo crear el usuario.');
  await asignarGrupo(sub!, asignacion.rol);
  return put('Perfil', {
    userId: sub,
    email,
    nombre,
    telefono: str(p.telefono, 20),
    estado: 'APROBADO',
    ...asignacion,
  });
}

/** Envía por correo una contraseña temporal nueva (la actual deja de funcionar si ya la había creado). */
async function enviarAccesos(userId: string) {
  const u = await cognito.send(new AdminGetUserCommand({ UserPoolId, Username: userId }));
  if (u.UserStatus !== 'FORCE_CHANGE_PASSWORD') {
    await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId, Username: userId, Password: temporal(), Permanent: false }));
  }
  await cognito.send(new AdminCreateUserCommand({ UserPoolId, Username: userId, MessageAction: 'RESEND', DesiredDeliveryMediums: ['EMAIL'] }));
}

/**
 * Cambia nombre, teléfono o correo de un residente o vigilante. Los campos vacíos no se tocan.
 * Si cambia el correo, el nuevo correo pasa a ser su usuario y recibe accesos nuevos.
 */
async function editarPersona(perfil: Item, p: Item, yo: Yo) {
  exigirGestionable(yo, perfil);
  exigir(yo, 'usuarios', 'editar');
  const cambios: Item = {};
  const nombre = str(p.nombre, 120);
  const telefono = str(p.telefono, 20);
  const email = str(p.email, 200).toLowerCase();
  if (nombre && nombre !== perfil.nombre) cambios.nombre = nombre;
  if (telefono && telefono !== perfil.telefono) cambios.telefono = telefono;
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
  if (cambios.email && perfil.estado === 'APROBADO') {
    await enviarAccesos(perfil.userId);
    await cerrarSesiones(perfil.userId);
  }
  return { cambios: Object.keys(cambios) };
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
    exigir(yo, 'usuarios', 'editar');
    if (perfil.estado !== 'APROBADO') fail('Solo se reenvía el acceso a usuarios autorizados.');
    await enviarAccesos(perfil.userId);
    return { ok: true, email: perfil.email };
  },

  // Contraseña definitiva que escribe la administración para compartirla (residentes que no revisan o no
  // tienen correo). La anterior deja de funcionar y se cierran sus sesiones abiertas.
  async generarContrasena(p, yo) {
    const perfil = await perfilDe(str(p.userId, 64));
    exigirGestionable(yo, perfil);
    exigir(yo, 'usuarios', 'editar');
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
    exigir(yo, 'usuarios', 'editar');
    if (perfil.userId === yo.sub) fail('No puedes rechazar tu propia cuenta.');
    // Sin grupo y sin sesiones: un rechazo no deja acceso al panel ni al portal.
    await quitarGrupos(perfil.userId);
    await cerrarSesiones(perfil.userId);
    return update('Perfil', { userId: perfil.userId }, { estado: 'RECHAZADO', nota: str(p.nota, 500) || null });
  },

  async suspender(p, yo) {
    const perfil = await perfilDe(str(p.userId, 64));
    exigirGestionable(yo, perfil);
    exigir(yo, 'usuarios', 'editar');
    if (perfil.userId === yo.sub) fail('No puedes suspender tu propia cuenta.');
    await cognito.send(new AdminDisableUserCommand({ UserPoolId, Username: perfil.userId }));
    await cerrarSesiones(perfil.userId);
    return update('Perfil', { userId: perfil.userId }, { estado: 'SUSPENDIDO' });
  },

  async reactivar(p, yo) {
    const perfil = await perfilDe(str(p.userId, 64));
    exigirGestionable(yo, perfil);
    exigir(yo, 'usuarios', 'editar');
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
    const periodo = str(p.periodo, 7);
    if (!/^\d{4}-\d{2}$/.test(periodo)) fail('Periodo no válido (AAAA-MM).');
    const dia = String(Math.min(Math.max(Number(c!.diaVencimiento) || 10, 1), 28)).padStart(2, '0');
    const vence = /^\d{4}-\d{2}-\d{2}$/.test(p.vence) ? p.vence : `${periodo}-${dia}`;
    // Cuota única del condominio; las unidades anteriores a esa configuración conservan su cuota propia.
    const cuotaCondo = Number(c!.cuotaMensual) > 0 ? Number(c!.cuotaMensual) : 0;
    const concepto = str(p.concepto, 120) || `Cuota de mantenimiento ${periodo}`;
    const unidades = await byIndex('Unidad', 'byCondominio', 'condominioId', c!.id);
    let creados = 0;
    let omitidos = 0;
    for (const u of unidades) {
      const monto = cuotaCondo || u.cuota;
      if (!(monto > 0)) {
        omitidos++;
        continue;
      }
      try {
        await put(
          'Cargo',
          { id: `${u.id}#${periodo}#cuota`, condominioId: c!.id, unidadId: u.id, concepto, periodo, monto, vence, estado: 'PENDIENTE' },
          { ifNotExists: 'id' },
        );
        creados++;
      } catch (err: any) {
        if (err?.name !== 'ConditionalCheckFailedException') throw err;
        omitidos++;
      }
    }
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
    const out: { etiqueta: string; unidad?: 'creada' | 'existente'; acceso?: boolean; cambios: string[]; error?: string }[] = [];
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
            const e = await editarPersona(mismo, { nombre: f.nombre, telefono: f.telefono, email }, yo);
            r.cambios.push(...e.cambios);
          } else if (suyos.length) {
            fail('La unidad tiene varios residentes; cambia sus datos desde la lista.');
          } else {
            perfiles.push(await altaUsuario({ email, nombre: f.nombre, telefono: f.telefono, rol: 'RESIDENTE', condominioId: c!.id, unidadId: u!.id }, yo));
            r.acceso = true;
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
};

export const handler = async (event: AppSyncResolverEvent<{ action: string; payload?: unknown }>) => {
  const action = String(event.arguments.action ?? '');
  try {
    const yo = await cargarYo(event.identity as any);
    if (!Object.hasOwn(acciones, action)) fail('Acción no válida.');
    return await acciones[action](parsePayload(event.arguments.payload), yo);
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    console.error(action, err);
    return { error: 'Ocurrió un error. Intenta de nuevo.' };
  }
};
