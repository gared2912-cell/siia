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
  ListUsersCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminUserGlobalSignOutCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomInt } from 'node:crypto';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';
import { cognito, emailDe } from '../shared/cognito';
import { accionNotificaciones } from '../shared/push';
import { CATEGORIAS_ADMIN } from '../shared/notificaciones';
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
const REGLAS: Record<string, Regla> = {
  Condominio: {
    seccion: 'condominios',
    lecturaLibre: true,
    indices: {},
    crear: ['nombre', 'tipo', 'direccion', 'telefonoCaseta', 'modulos', 'activo', 'datosPago'],
    editar: ['nombre', 'tipo', 'direccion', 'telefonoCaseta', 'modulos', 'activo', 'datosPago'],
    extras: { modulos: 'condominios.servicios', activo: 'condominios.servicios', datosPago: 'condominios.datosPago' },
  },
  Unidad: {
    seccion: 'condominios',
    lecturaLibre: true,
    indices: { unidadesPorCondominio: 'condominioId' },
    crear: ['condominioId', 'etiqueta', 'cuota', 'propietario', 'notas'],
    editar: ['etiqueta', 'cuota', 'propietario', 'notas'],
    borrar: true,
  },
  Cargo: {
    seccion: 'finanzas',
    indices: { cargosPorCondominio: 'condominioId' },
    crear: ['condominioId', 'unidadId', 'concepto', 'periodo', 'monto', 'vence', 'estado'],
    editar: ['estado'],
    valores: { estado: ['CANCELADO'] },
  },
  Pago: { seccion: 'finanzas', indices: { pagosPorCondominio: 'condominioId' } },
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
    crear: ['condominioId', 'unidadId', 'canal', 'hilo', 'autorNombre', 'autorRol', 'autorId', 'texto'],
  },
  Incidente: { seccion: 'incidentes', indices: { incidentesPorCondominio: 'condominioId' }, editar: ['estado', 'respuesta'] },
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
    ],
    editar: ['nombre', 'descripcion', 'horaApertura', 'horaCierre', 'maxHoras', 'capacidad', 'costo', 'requiereAprobacion', 'activa', 'reglas'],
  },
  Reserva: { seccion: 'amenidades', indices: { reservasPorCondominio: 'condominioId' }, editar: ['estado', 'nota'] },
  Visita: { seccion: 'visitas', indices: { visitasPorCondominio: 'condominioId' } },
  Mascota: { seccion: 'mascotas', indices: { mascotasPorCondominio: 'condominioId' }, editar: ['estado', 'notas'] },
};

const condoDe = (m: string, item: Item) => (m === 'Condominio' ? item.id : item.condominioId);

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
    return leerTodo((o) => M[op]({ [campo]: valor }, o));
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
      if (!yo.permisos.extras.includes('condominios.datosPago')) delete input.datosPago;
    }
    if (input.unidadId) {
      const u = await get('Unidad', { id: str(input.unidadId, 64) });
      if (!u || u.condominioId !== input.condominioId) fail('La unidad no pertenece al condominio.');
    }
    if (m === 'Cargo') input.estado = 'PENDIENTE';
    if (m === 'Mensaje') {
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

const acciones: Record<string, (p: Item, yo: Yo) => Promise<unknown>> = {
  // Permisos efectivos de quien llama (el panel muestra solo lo permitido).
  async yo(_p, yo) {
    return {
      email: yo.email,
      superadmin: yo.superadmin,
      rol: yo.rolNombre,
      permisos: yo.permisos,
      condominios: yo.condos === '*' ? '*' : [...yo.condos],
    };
  },

  db,
  archivo,

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
  // Alta directa por la administración: Cognito envía la invitación con contraseña temporal.
  async crearUsuario(p, yo) {
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
    const u = await cognito.send(new AdminGetUserCommand({ UserPoolId, Username: perfil.userId }));
    if (u.UserStatus !== 'FORCE_CHANGE_PASSWORD') {
      await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId, Username: perfil.userId, Password: temporal(), Permanent: false }));
    }
    await cognito.send(
      new AdminCreateUserCommand({ UserPoolId, Username: perfil.userId, MessageAction: 'RESEND', DesiredDeliveryMediums: ['EMAIL'] }),
    );
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
    const vence = /^\d{4}-\d{2}-\d{2}$/.test(p.vence) ? p.vence : `${periodo}-10`;
    const concepto = str(p.concepto, 120) || `Cuota de mantenimiento ${periodo}`;
    const unidades = await byIndex('Unidad', 'byCondominio', 'condominioId', c!.id);
    let creados = 0;
    let omitidos = 0;
    for (const u of unidades) {
      if (!(u.cuota > 0)) {
        omitidos++;
        continue;
      }
      try {
        await put(
          'Cargo',
          { id: `${u.id}#${periodo}#cuota`, condominioId: c!.id, unidadId: u.id, concepto, periodo, monto: u.cuota, vence, estado: 'PENDIENTE' },
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
