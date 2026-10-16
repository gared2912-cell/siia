// Pruebas de punta a punta contra staging: varias propiedades, todos los roles y todos los módulos
// (panel /admin, portal de residentes y caseta) usando la API real (AppSync + Lambdas + S3).
//
//   npm run pruebas:e2e               → crea los datos de prueba, ejecuta las pruebas y borra todo
//   npm run pruebas:e2e -- --conservar → deja las propiedades de prueba para revisarlas en /admin
//   npm run pruebas:e2e -- --limpiar   → solo borra los datos de prueba que hayan quedado
//
// Todo lo de prueba se identifica por: condominios «… · e2e», correos @e2e.siia.casa y roles «E2E …».
// Solo se envía un correo real (alta por la API de un residente); el resto de cuentas se crean sin correo.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createECDH, randomBytes } from 'node:crypto';
import { DescribeContinuousBackupsCommand, DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketPolicyCommand,
  GetBucketTaggingCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { AppSyncClient, ListGraphqlApisCommand } from '@aws-sdk/client-appsync';

process.env.AWS_PROFILE ??= 'Gared';
process.env.AWS_REGION ??= 'us-east-1';
const CONSERVAR = process.argv.includes('--conservar');

const outputs = JSON.parse(readFileSync(new URL('../amplify_outputs.json', import.meta.url), 'utf8'));
const POOL = outputs.auth.user_pool_id;
const BUCKET = outputs.storage.bucket_name;
const DOMINIO = 'e2e.siia.casa';
const SUFIJO = ' · e2e';
const PASS = `E2e!${randomBytes(9).toString('base64url')}9a`;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const cognito = new CognitoIdentityProviderClient({});
const s3 = new S3Client({});

// ---------- tablas (sufijo del entorno) ----------
const apis = await new AppSyncClient({}).send(new ListGraphqlApisCommand({}));
const api = apis.graphqlApis.find((a) => a.uris?.GRAPHQL === outputs.data.url);
const SUFIJO_TABLA = `-${api.apiId}-NONE`;
const T = (m) => `${m}${SUFIJO_TABLA}`;
const MODELOS = ['Unidad', 'Cargo', 'Pago', 'Comunicado', 'Encuesta', 'Voto', 'Mensaje', 'Incidente', 'Mantenimiento', 'Amenidad', 'Reserva', 'Visita', 'Aviso', 'Mascota', 'Egreso', 'SaldoMensual', 'TurnoVigilancia'];

// ---------- utilidades ----------
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const manana = new Date(Date.parse(`${hoy}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
const periodo = hoy.slice(0, 7);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** Repite `fn` hasta que `cond` se cumpla (los índices secundarios de DynamoDB tardan unos milisegundos). */
async function hasta(fn, cond, intentos = 6) {
  let r;
  for (let i = 0; i < intentos; i++) {
    r = await fn();
    if (cond(r)) return r;
    await espera(600);
  }
  return r;
}

async function scanTodo(model, filtro) {
  const out = [];
  let ExclusiveStartKey;
  do {
    const r = await ddb.send(new ScanCommand({ TableName: T(model), ExclusiveStartKey, ...filtro }));
    out.push(...(r.Items ?? []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return out;
}

async function borrarItems(model, keys) {
  for (let i = 0; i < keys.length; i += 25) {
    await ddb.send(new BatchWriteCommand({ RequestItems: { [T(model)]: keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })) } }));
  }
}

// ---------- API ----------
async function gql(tok, query, variables) {
  const r = await fetch(outputs.data.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: tok }, body: JSON.stringify({ query, variables }) });
  return r.json();
}
async function llamar(tok, campo, action, payload = {}) {
  const x = await gql(tok, `mutation($a:String!,$p:AWSJSON){ ${campo}(action:$a,payload:$p) }`, { a: action, p: JSON.stringify(payload) });
  if (x.errors) return { error: x.errors[0].errorType ?? x.errors[0].message };
  let d = x.data[campo];
  for (let i = 0; i < 2 && typeof d === 'string'; i++) d = JSON.parse(d);
  return d;
}
/** Llama y falla si la API responde con error. */
async function ok(p) {
  const r = await p;
  if (r && typeof r === 'object' && 'error' in r && r.error) throw new Error(r.error);
  return r;
}
/** Llama y falla si la API NO responde con error (acción que debe bloquearse). Regresa el mensaje. */
async function bloqueado(p) {
  const r = await p;
  if (!(r && typeof r === 'object' && r.error)) throw new Error(`Se esperaba un rechazo y se obtuvo: ${JSON.stringify(r).slice(0, 150)}`);
  return r.error;
}
const esperar = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// Sesión de un usuario: token para AppSync y credenciales temporales para S3.
const sesiones = {};
const { Amplify } = await import('aws-amplify');
const { signIn, signOut, fetchAuthSession } = await import('aws-amplify/auth');
Amplify.configure(outputs);
async function entrar(clave, email) {
  await signOut().catch(() => {});
  const r = await signIn({ username: email, password: PASS });
  if (!r.isSignedIn) throw new Error(`No se pudo iniciar sesión como ${email} (${r.nextStep?.signInStep})`);
  const s = await fetchAuthSession();
  const tok = s.tokens.accessToken.toString();
  const s3u = new S3Client({ credentials: s.credentials });
  const sub = s.tokens.accessToken.payload.sub;
  sesiones[clave] = {
    tok,
    sub,
    identityId: s.identityId,
    s3: s3u,
    /** Sube a su carpeta como lo hace el portal (con el metadato `sub` del dueño). */
    subir: (carpeta, nombre, Body, ContentType, conDueno = true) => {
      const Key = `residentes/${s.identityId}/${carpeta}/${Date.now()}-e2e-${nombre}`;
      return s3u.send(new PutObjectCommand({ Bucket: BUCKET, Key, Body, ContentType, ...(conDueno ? { Metadata: { sub } } : {}) })).then(() => Key);
    },
    admin: (action, payload) => llamar(tok, 'admin', action, payload),
    portal: (action, payload) => llamar(tok, 'portal', action, payload),
    db: (model, op, extra = {}) => llamar(tok, 'admin', 'db', { model, op, ...extra }),
  };
  return sesiones[clave];
}

async function cuentaCognito(email, nombre, grupo) {
  const r = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: POOL,
      Username: email,
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'name', Value: nombre },
      ],
    }),
  );
  const sub = r.User.Attributes.find((a) => a.Name === 'sub').Value;
  await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId: POOL, Username: sub, Password: PASS, Permanent: true }));
  if (grupo) await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: POOL, Username: sub, GroupName: grupo }));
  return sub;
}
/** Perfil inicial: el superadministrador de prueba aprobado; los demás como solicitud pendiente. */
async function perfil(sub, email, nombre, campos) {
  const ts = new Date().toISOString();
  await ddb.send(new PutCommand({ TableName: T('Perfil'), Item: { userId: sub, email, nombre, __typename: 'Perfil', createdAt: ts, updatedAt: ts, ...campos } }));
}

// ---------- limpieza ----------
async function limpiar() {
  const condos = (await scanTodo('Condominio')).filter((c) => String(c.nombre).endsWith(SUFIJO)).map((c) => c.id);
  let registros = 0;
  if (condos.length) {
    for (const m of MODELOS) {
      const items = (await scanTodo(m)).filter((x) => condos.includes(x.condominioId));
      await borrarItems(m, items.map((x) => ({ id: x.id })));
      registros += items.length;
    }
    await borrarItems('Condominio', condos.map((id) => ({ id })));
  }
  const perfiles = (await scanTodo('Perfil')).filter((p) => String(p.email).endsWith(`@${DOMINIO}`));
  const usuariosE2E = new Set(perfiles.map((p) => p.userId));
  const dispositivos = (await scanTodo('Dispositivo')).filter((d) => usuariosE2E.has(d.userId));
  await borrarItems('Dispositivo', dispositivos.map((d) => ({ id: d.id })));
  await borrarItems('Perfil', perfiles.map((p) => ({ userId: p.userId })));
  const roles = (await scanTodo('RolAdmin')).filter((r) => String(r.nombre).startsWith('E2E '));
  await borrarItems('RolAdmin', roles.map((r) => ({ id: r.id })));

  // Cuentas de Cognito y sus archivos / identidades
  let usuarios = 0;
  let token;
  do {
    const r = await cognito.send(new ListUsersCommand({ UserPoolId: POOL, PaginationToken: token }));
    for (const u of r.Users ?? []) {
      const email = u.Attributes?.find((a) => a.Name === 'email')?.Value ?? '';
      if (email.endsWith(`@${DOMINIO}`)) {
        await cognito.send(new AdminDeleteUserCommand({ UserPoolId: POOL, Username: u.Username }));
        usuarios++;
      }
    }
    token = r.PaginationToken;
  } while (token);
  // Archivos de prueba (llevan «-e2e-» en el nombre): todas sus versiones y marcas de borrado.
  let archivos = 0;
  let marcaK;
  let marcaV;
  do {
    const l = await s3.send(new ListObjectVersionsCommand({ Bucket: BUCKET, KeyMarker: marcaK, VersionIdMarker: marcaV }));
    const keys = [...(l.Versions ?? []), ...(l.DeleteMarkers ?? [])].filter((c) => c.Key.includes('-e2e-')).map((c) => ({ Key: c.Key, VersionId: c.VersionId }));
    for (let i = 0; i < keys.length; i += 1000) await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys.slice(i, i + 1000) } }));
    archivos += keys.length;
    marcaK = l.IsTruncated ? l.NextKeyMarker : undefined;
    marcaV = l.IsTruncated ? l.NextVersionIdMarker : undefined;
  } while (marcaK);
  const ids = Object.values(sesiones).map((s) => s.identityId).filter(Boolean);
  if (ids.length) {
    try {
      execFileSync('aws', ['cognito-identity', 'delete-identities', '--identity-ids-to-delete', ...ids], { stdio: 'ignore' });
    } catch {
      /* identidades sin permisos: no afectan */
    }
  }
  return { condos: condos.length, registros, perfiles: perfiles.length, usuarios, archivos };
}

// ---------- ejecución de pruebas ----------
const resultados = [];
let grupoActual = '';
async function prueba(nombre, fn) {
  const n = resultados.length + 1;
  const t0 = Date.now();
  try {
    const r = await fn();
    const detalle = typeof r === 'string' ? r : '';
    resultados.push({ n, grupo: grupoActual, nombre, ok: true });
    console.log(`  ✔ ${String(n).padStart(2)} ${nombre}${detalle ? ` — ${String(detalle).slice(0, 110)}` : ''} (${Date.now() - t0} ms)`);
  } catch (e) {
    resultados.push({ n, grupo: grupoActual, nombre, ok: false, error: e.message });
    console.log(`  ✘ ${String(n).padStart(2)} ${nombre} — ${e.message}`);
  }
}
const grupo = (g) => {
  grupoActual = g;
  console.log(`\n▶ ${g}`);
};

const E = (u) => `${u}@${DOMINIO}`;
const X = {}; // ids creados durante las pruebas

if (process.argv.includes('--limpiar')) {
  console.log('▶ Limpieza:', JSON.stringify(await limpiar()));
  process.exit(0);
}

console.log('▶ Preparación');
const previa = await limpiar();
if (previa.condos || previa.usuarios) console.log(`  Restos de una corrida anterior borrados: ${JSON.stringify(previa)}`);

// Cuentas: un superadministrador de prueba (directo) y solicitudes pendientes que se aprueban por la API.
const CUENTAS = {
  sa: ['superadmin', 'Superadmin E2E', 'SUPERADMIN'],
  ag: ['admin.general', 'Administrador General E2E'],
  ct: ['contador', 'Contadora E2E'],
  op: ['operacion', 'Gerente Operación E2E'],
  cs: ['consulta', 'Comité Consulta E2E'],
  r1: ['residente1', 'Ana Robles E2E'],
  r2: ['residente2', 'Beto Robles E2E'],
  r3: ['residente3', 'Carla Mirador E2E'],
  g1: ['vigilante', 'Vigilante Robles E2E'],
};
const SUB = {};
for (const [k, [u, nombre, grupoCognito]] of Object.entries(CUENTAS)) {
  SUB[k] = await cuentaCognito(E(u), nombre, grupoCognito);
  // Los residentes y el vigilante envían su solicitud más adelante (cuando existen las propiedades).
  if (grupoCognito) await perfil(SUB[k], E(u), nombre, { rol: 'SUPERADMIN', estado: 'APROBADO' });
  else if (['ag', 'ct', 'op', 'cs'].includes(k)) await perfil(SUB[k], E(u), nombre, { estado: 'PENDIENTE' });
}
console.log(`  ${Object.keys(CUENTAS).length} cuentas de prueba creadas`);

try {
  const sa = await entrar('sa', E('superadmin'));

  // =====================================================================
  grupo('Superadministrador: propiedades, unidades y roles');
  await prueba('Permisos efectivos del superadministrador', async () => {
    const yo = await ok(sa.admin('yo'));
    esperar(yo.superadmin && yo.condominios === '*', JSON.stringify(yo));
    return yo.rol;
  });
  await prueba('Alta de propiedad horizontal con los 9 servicios', async () => {
    const c = await ok(
      sa.db('Condominio', 'create', {
        input: {
          nombre: `Residencial Los Robles${SUFIJO}`,
          tipo: 'Condominio horizontal',
          direccion: 'Av. de los Robles 100, Querétaro',
          telefonoCaseta: '4421000000',
          datosPago: 'BBVA · CLABE 012180000000000000 · Ref. número de casa',
          activo: true,
          modulos: ['finanzas', 'visitas', 'comunicados', 'encuestas', 'chat', 'incidentes', 'mantenimientos', 'amenidades', 'mascotas'],
        },
      }),
    );
    X.robles = c.id;
    return c.nombre;
  });
  await prueba('Alta de torre vertical con 5 servicios', async () => {
    const c = await ok(
      sa.db('Condominio', 'create', {
        input: { nombre: `Torre Mirador${SUFIJO}`, tipo: 'Condominio vertical (edificio)', activo: true, modulos: ['finanzas', 'visitas', 'comunicados', 'chat', 'incidentes'] },
      }),
    );
    X.torre = c.id;
    return c.nombre;
  });
  await prueba('Alta de 8 unidades en Los Robles con cuota', async () => {
    X.unidadesRobles = [];
    for (let i = 1; i <= 8; i++) {
      const u = await ok(sa.db('Unidad', 'create', { input: { condominioId: X.robles, etiqueta: `Casa ${i}`, cuota: 1500, propietario: `Propietario ${i}` } }));
      X.unidadesRobles.push(u.id);
    }
    return '8 unidades';
  });
  await prueba('Alta de 4 departamentos en Torre Mirador', async () => {
    X.unidadesTorre = [];
    for (const d of ['101', '102', '201', '202']) {
      const u = await ok(sa.db('Unidad', 'create', { input: { condominioId: X.torre, etiqueta: `Depto ${d}`, cuota: 2200 } }));
      X.unidadesTorre.push(u.id);
    }
    return '4 unidades';
  });
  await prueba('Editar unidad (cuota y propietario)', async () => {
    const u = await ok(sa.db('Unidad', 'update', { input: { id: X.unidadesRobles[7], cuota: 0, propietario: 'Casa en venta' } }));
    esperar(u.cuota === 0, 'la cuota no cambió');
    return 'Casa 8 sin cuota';
  });
  await prueba('Roles sugeridos disponibles', async () => {
    await ok(sa.admin('roles.sugeridos'));
    const roles = await ok(sa.admin('roles.lista'));
    const ids = roles.map((r) => r.id);
    esperar(['rol-general', 'rol-contador', 'rol-operacion', 'rol-consulta'].every((id) => ids.includes(id)), ids.join(','));
    return `${roles.length} roles`;
  });
  await prueba('Crear rol personalizado (normaliza permisos inválidos)', async () => {
    const r = await ok(
      sa.admin('roles.guardar', {
        nombre: 'E2E Vigilancia',
        permisos: { secciones: { visitas: 'editar', chat: 'editar', inventada: 'editar' }, extras: ['finanzas.validarPagos'] },
      }),
    );
    X.rolE2E = r.id;
    const roles = await ok(sa.admin('roles.lista'));
    const p = roles.find((x) => x.id === r.id).permisos;
    esperar(p.secciones.visitas === 'ver' && p.secciones.chat === 'editar' && !p.extras.length && !('inventada' in p.secciones), JSON.stringify(p));
    return 'visitas→solo ver, extra sin sección descartado';
  });
  await prueba('Eliminar rol personalizado sin asignar', async () => {
    await ok(sa.admin('roles.eliminar', { id: X.rolE2E }));
  });

  // =====================================================================
  grupo('Superadministrador: cuentas de administración');
  const asignarAdmin = (k, rolAdminId, condominiosAdmin) =>
    ok(sa.admin('aprobar', { userId: SUB[k], rol: 'ADMIN', rolAdminId, condominiosAdmin }));
  await prueba('Administrador general en Los Robles y Torre Mirador', () => asignarAdmin('ag', 'rol-general', [X.robles, X.torre]));
  await prueba('Contadora solo en Los Robles', () => asignarAdmin('ct', 'rol-contador', [X.robles]));
  await prueba('Gerente de operación solo en Torre Mirador', () => asignarAdmin('op', 'rol-operacion', [X.torre]));
  await prueba('Comité de consulta en Los Robles', () => asignarAdmin('cs', 'rol-consulta', [X.robles]));
  await prueba('Rechaza asignar administrador sin condominios', async () => bloqueado(sa.admin('aprobar', { userId: SUB.cs, rol: 'ADMIN', rolAdminId: 'rol-consulta', condominiosAdmin: [] })));

  const ag = await entrar('ag', E('admin.general'));
  const ct = await entrar('ct', E('contador'));
  const op = await entrar('op', E('operacion'));
  const cs = await entrar('cs', E('consulta'));

  // =====================================================================
  grupo('Administrador general: usuarios');
  await prueba('Solo ve sus dos condominios', async () => {
    const c = await ok(ag.db('Condominio', 'list'));
    const ids = c.map((x) => x.id).sort();
    esperar(JSON.stringify(ids) === JSON.stringify([X.robles, X.torre].sort()), ids.join(','));
    return c.map((x) => x.nombre).join(' / ');
  });
  await prueba('Ve las solicitudes de acceso de sus condominios, sin cuentas de administración', async () => {
    const solicitud = (k, condominioId, unidadSolicitada) =>
      perfil(SUB[k], E(CUENTAS[k][0]), CUENTAS[k][1], { estado: 'PENDIENTE', rol: 'RESIDENTE', condominioId, unidadSolicitada });
    await solicitud('r1', X.robles, 'Casa 1');
    await solicitud('r2', X.robles, 'Casa 2');
    await solicitud('g1', X.robles, 'Caseta');
    await solicitud('r3', X.torre, 'Depto 101');
    const p = await ok(ag.db('Perfil', 'list'));
    const pendientes = p.filter((x) => x.estado === 'PENDIENTE');
    esperar(pendientes.length === 4 && !p.some((x) => x.rol === 'ADMIN' || x.rol === 'SUPERADMIN'), `${pendientes.length} pendientes de ${p.length}`);
    return '4 solicitudes';
  });
  await prueba('Autoriza a dos residentes de Los Robles', async () => {
    await ok(ag.admin('aprobar', { userId: SUB.r1, rol: 'RESIDENTE', condominioId: X.robles, unidadId: X.unidadesRobles[0] }));
    await ok(ag.admin('aprobar', { userId: SUB.r2, rol: 'RESIDENTE', condominioId: X.robles, unidadId: X.unidadesRobles[1] }));
  });
  await prueba('Autoriza al vigilante de Los Robles', () => ok(ag.admin('aprobar', { userId: SUB.g1, rol: 'VIGILANTE', condominioId: X.robles })));
  await prueba('Autoriza a una residente de Torre Mirador', () =>
    ok(ag.admin('aprobar', { userId: SUB.r3, rol: 'RESIDENTE', condominioId: X.torre, unidadId: X.unidadesTorre[0] })),
  );
  await prueba('Rechaza asignar una unidad de otro condominio', () =>
    bloqueado(ag.admin('aprobar', { userId: SUB.r3, rol: 'RESIDENTE', condominioId: X.robles, unidadId: X.unidadesTorre[0] })),
  );
  await prueba('Alta por la API con invitación por correo', async () => {
    const p = await ok(ag.admin('crearUsuario', { email: E('residente4'), nombre: 'Dora Robles E2E', rol: 'RESIDENTE', condominioId: X.robles, unidadId: X.unidadesRobles[2] }));
    SUB.r4 = p.userId;
    const cuentas = await ok(ag.admin('estadoCuentas'));
    esperar(cuentas[SUB.r4]?.status === 'FORCE_CHANGE_PASSWORD', JSON.stringify(cuentas[SUB.r4]));
    return 'invitación enviada, cuenta sin primer ingreso';
  });
  await prueba('Suspender y reactivar residente', async () => {
    await ok(ag.admin('suspender', { userId: SUB.r4 }));
    const p = await ok(ag.db('Perfil', 'list'));
    esperar(p.find((x) => x.userId === SUB.r4)?.estado === 'SUSPENDIDO', 'no quedó suspendido');
    await ok(ag.admin('reactivar', { userId: SUB.r4 }));
  });
  await prueba('Un administrador no puede suspender su propia cuenta… ni gestionar administradores', async () => {
    await bloqueado(ag.admin('suspender', { userId: SUB.ag }));
    return bloqueado(ag.admin('suspender', { userId: SUB.ct }));
  });
  await prueba('Eliminar la cuenta de prueba invitada', () => ok(ag.admin('eliminarUsuario', { userId: SUB.r4 })));

  const r1 = await entrar('r1', E('residente1'));
  const r2 = await entrar('r2', E('residente2'));
  const r3 = await entrar('r3', E('residente3'));
  const g1 = await entrar('g1', E('vigilante'));

  // =====================================================================
  grupo('Finanzas: cuotas, comprobantes, aprobación y recibos');
  await prueba('Contadora genera las cuotas del mes', async () => {
    const r = await ok(ct.admin('generarCargos', { condominioId: X.robles, periodo, vence: `${periodo}-28` }));
    esperar(r.creados === 7 && r.omitidos === 1, JSON.stringify(r));
    return '7 cuotas (Casa 8 sin cuota se omite)';
  });
  await prueba('Generar cuotas otra vez no duplica', async () => {
    const r = await ok(ct.admin('generarCargos', { condominioId: X.robles, periodo }));
    esperar(r.creados === 0, JSON.stringify(r));
  });
  await prueba('Cargo extraordinario a Casa 1', async () => {
    const c = await ok(ct.db('Cargo', 'create', { input: { condominioId: X.robles, unidadId: X.unidadesRobles[0], concepto: 'Multa por ruido', monto: 500, vence: manana, periodo } }));
    X.multa = c.id;
    esperar(c.estado === 'PENDIENTE', c.estado);
  });
  await prueba('Cargo de prueba cancelado; no se puede marcar como pagado a mano', async () => {
    const c = await ok(ct.db('Cargo', 'create', { input: { condominioId: X.robles, unidadId: X.unidadesRobles[1], concepto: 'Cargo erróneo', monto: 99, vence: manana } }));
    await bloqueado(ct.db('Cargo', 'update', { input: { id: c.id, estado: 'PAGADO' } }));
    const r = await ok(ct.db('Cargo', 'update', { input: { id: c.id, estado: 'CANCELADO' } }));
    esperar(r.estado === 'CANCELADO', r.estado);
  });
  await prueba('Residente ve su saldo en Inicio y Finanzas', async () => {
    const e = await hasta(() => ok(r1.portal('finanzas.estadoCuenta')), (x) => x.saldo === 2000);
    esperar(e.saldo === 2000 && e.cargos.length === 2 && e.datosPago?.includes('CLABE'), JSON.stringify({ saldo: e.saldo, cargos: e.cargos.length }));
    X.cargosR1 = e.cargos.map((c) => c.id);
    const i = await ok(r1.portal('inicio.resumen'));
    esperar(i.saldo === 2000, `inicio: ${i.saldo}`);
    return '$2,000 (cuota + multa)';
  });
  await prueba('Residente sube su comprobante a su carpeta privada', async () => {
    X.comprobante = await r1.subir('comprobantes', 'transferencia.pdf', '%PDF-1.4 comprobante de prueba', 'application/pdf');
  });
  await prueba('Residente registra el pago de sus cargos', async () => {
    const p = await ok(r1.portal('finanzas.registrarPago', { monto: 2000, fecha: hoy, referencia: 'SPEI 123456', comprobantePath: X.comprobante, cargoIds: X.cargosR1 }));
    X.pago1 = p.id;
    esperar(p.estado === 'EN_REVISION', p.estado);
  });
  await prueba('Aviso en sesión: comprobante recibido', async () => {
    const a = await hasta(() => ok(r1.portal('inicio.avisos')), (x) => x.avisos.some((v) => v.titulo === 'Comprobante de pago recibido'));
    esperar(a.avisos.some((v) => v.titulo === 'Comprobante de pago recibido'), 'sin aviso');
  });
  await prueba('Contadora abre el comprobante (URL firmada)', async () => {
    const { url } = await ok(ct.admin('archivo', { model: 'Pago', id: X.pago1 }));
    const r = await fetch(url);
    esperar(r.ok && (await r.text()).includes('comprobante de prueba'), `HTTP ${r.status}`);
    return `HTTP ${r.status}`;
  });
  await prueba('Contadora aprueba el pago: folio y cargos liquidados', async () => {
    await ok(ct.admin('validarPago', { pagoId: X.pago1, aprobar: true }));
    const e = await hasta(() => ok(r1.portal('finanzas.estadoCuenta')), (x) => x.saldo === 0);
    const pago = e.pagos.find((p) => p.id === X.pago1);
    esperar(e.saldo === 0 && pago.estado === 'VALIDADO' && pago.folio === 'R-00001', JSON.stringify({ saldo: e.saldo, pago }));
    return `folio ${pago.folio}, saldo $0`;
  });
  await prueba('El mismo pago no se puede aprobar dos veces', () => bloqueado(ct.admin('validarPago', { pagoId: X.pago1, aprobar: true })));
  await prueba('Residente descarga su recibo', async () => {
    const r = await ok(r1.portal('finanzas.recibo', { pagoId: X.pago1 }));
    esperar(r.pago.folio === 'R-00001' && r.cargos.length === 2 && r.unidad.etiqueta === 'Casa 1', JSON.stringify(r).slice(0, 120));
    return `${r.condominio.nombre} · ${r.unidad.etiqueta}`;
  });
  await prueba('Otro residente no puede ver ese recibo', () => bloqueado(r2.portal('finanzas.recibo', { pagoId: X.pago1 })));
  await prueba('Pago rechazado con motivo notifica al residente', async () => {
    const key = await r2.subir('comprobantes', 'ticket.jpg', 'jpg', 'image/jpeg');
    const p = await ok(r2.portal('finanzas.registrarPago', { monto: 100, comprobantePath: key }));
    await ok(ct.admin('validarPago', { pagoId: p.id, aprobar: false, nota: 'El comprobante no es legible' }));
    const a = await hasta(() => ok(r2.portal('inicio.avisos')), (x) => x.avisos.some((v) => v.texto === 'El comprobante no es legible'));
    esperar(a.avisos.some((v) => v.titulo === 'Tu pago no fue aprobado'), 'sin aviso de rechazo');
  });

  // =====================================================================
  grupo('Finanzas: egresos con evidencia y balance mensual');
  const subirEvidencia = async (sesion, nombre, tipo, contenido) => {
    const r = await ok(sesion.admin('egresos.subirEvidencia', { condominioId: X.robles, nombre, tamano: contenido.length }));
    const put = await fetch(r.url, { method: 'PUT', headers: { 'Content-Type': r.contentType }, body: contenido });
    esperar(put.ok, `PUT ${put.status}`);
    return { path: r.path, nombre };
  };
  await prueba('Contadora registra un egreso con 2 archivos de evidencia (PDF e imagen)', async () => {
    const ev1 = await subirEvidencia(ct, 'factura-e2e-poda.pdf', 'application/pdf', '%PDF-1.4 factura de prueba');
    const ev2 = await subirEvidencia(ct, 'foto-e2e-poda.jpg', 'image/jpeg', 'foto de prueba');
    const e = await ok(
      ct.admin('egresos.guardar', {
        condominioId: X.robles,
        fecha: hoy,
        categoria: 'Poda y jardinería',
        concepto: 'Poda de áreas verdes',
        proveedor: 'Jardines e2e',
        formaPago: 'Transferencia',
        monto: 850.5,
        evidencias: [ev1, ev2],
      }),
    );
    X.egreso = e.id;
    X.evidencia = ev1.path;
    esperar(e.registradoPor === E('contador') && JSON.parse(e.evidencias).length === 2, JSON.stringify(e).slice(0, 160));
    return `$${e.monto} · 2 archivos`;
  });
  await prueba('Egreso sin evidencia o con más de 5 archivos se rechaza', async () => {
    const base = { condominioId: X.robles, fecha: hoy, categoria: 'Gas', concepto: 'Gas', monto: 100 };
    await bloqueado(ct.admin('egresos.guardar', { ...base, evidencias: [] }));
    const ev = { path: X.evidencia, nombre: 'x.pdf' };
    return bloqueado(ct.admin('egresos.guardar', { ...base, evidencias: [ev, ev, ev, ev, ev, ev] }));
  });
  await prueba('Evidencia de otro condominio no se acepta', () =>
    bloqueado(
      ct.admin('egresos.guardar', {
        condominioId: X.robles,
        fecha: hoy,
        categoria: 'Gas',
        concepto: 'Gas',
        monto: 100,
        evidencias: [{ path: `condominios/${X.torre}/egresos/otro.pdf`, nombre: 'otro.pdf' }],
      }),
    ),
  );
  await prueba('Contadora abre la evidencia del egreso (URL firmada)', async () => {
    const { url } = await ok(ct.admin('egresos.evidencia', { id: X.egreso, path: X.evidencia }));
    const r = await fetch(url);
    esperar(r.ok && (await r.text()).includes('factura de prueba'), `HTTP ${r.status}`);
    return `HTTP ${r.status}`;
  });
  await prueba('Contadora edita el egreso (monto y una sola evidencia)', async () => {
    const e = await ok(
      ct.admin('egresos.guardar', {
        id: X.egreso,
        condominioId: X.robles,
        fecha: hoy,
        categoria: 'Poda y jardinería',
        concepto: 'Poda de áreas verdes',
        monto: 900,
        evidencias: [{ path: X.evidencia, nombre: 'factura-e2e-poda.pdf' }],
      }),
    );
    esperar(e.monto === 900 && JSON.parse(e.evidencias).length === 1 && e.registradoPor === E('contador'), JSON.stringify(e).slice(0, 160));
    return '$900 · 1 archivo';
  });
  await prueba('Saldo inicial capturado del mes', async () => {
    await ok(ct.admin('saldos.inicial', { condominioId: X.robles, periodo, saldoInicial: 12500, nota: 'Estado de cuenta e2e' }));
    const l = await hasta(() => ok(ct.db('SaldoMensual', 'saldosPorCondominio', { args: { condominioId: X.robles } })), (x) => x.length === 1);
    esperar(l[0]?.saldoInicial === 12500 && l[0]?.periodo === periodo, JSON.stringify(l));
    return '$12,500';
  });
  await prueba('Comité de consulta ve egresos pero no registra ni cambia el saldo', async () => {
    const l = await hasta(() => ok(cs.db('Egreso', 'egresosPorCondominio', { args: { condominioId: X.robles } })), (x) => x.length === 1);
    await bloqueado(cs.admin('egresos.subirEvidencia', { condominioId: X.robles, nombre: 'x.pdf', tamano: 10 }));
    await bloqueado(cs.admin('egresos.borrar', { id: X.egreso }));
    await bloqueado(cs.admin('saldos.inicial', { condominioId: X.robles, periodo, saldoInicial: 1 }));
    return `lee ${l.length} egreso(s)`;
  });
  await prueba('Gasto del fondo de amenidades: lo ve el residente con su evidencia', async () => {
    const ev = await subirEvidencia(ct, 'nota-e2e-asador.pdf', 'application/pdf', '%PDF-1.4 nota del asador');
    const e = await ok(
      ct.admin('egresos.guardar', { condominioId: X.robles, fecha: hoy, categoria: 'Mantenimiento de amenidades', concepto: 'Parrilla nueva del asador', monto: 1200, evidencias: [ev], fondo: 'AMENIDADES' }),
    );
    esperar(e.fondo === 'AMENIDADES', JSON.stringify(e).slice(0, 120));
    const f = await hasta(() => ok(r1.portal('amenidades.fondo')), (x) => x.gastos.some((g) => g.id === e.id));
    const g = f.gastos.find((x) => x.id === e.id);
    esperar(g && f.totalGastos >= 1200 && !('registradoPor' in g), JSON.stringify(f).slice(0, 160));
    const { url } = await ok(r1.portal('amenidades.fondoEvidencia', { id: e.id, path: ev.path }));
    const r = await fetch(url);
    esperar(r.ok && (await r.text()).includes('nota del asador'), `HTTP ${r.status}`);
    await bloqueado(r1.portal('amenidades.fondoEvidencia', { id: X.egreso, path: X.evidencia }));
    return `ahorro ${f.saldo}, gasto visible con evidencia`;
  });
  await prueba('Contadora ve las reservas de amenidades desde Finanzas', async () => {
    const l = await ok(ct.admin('amenidades.reservas', { condominioId: X.robles }));
    esperar(Array.isArray(l), JSON.stringify(l).slice(0, 80));
    return `${l.length} reserva(s)`;
  });
  await prueba('Gerente de operación no ve egresos', () => bloqueado(op.db('Egreso', 'egresosPorCondominio', { args: { condominioId: X.robles } })));
  await prueba('Quitar saldo capturado y eliminar egreso', async () => {
    await ok(ct.admin('saldos.inicial', { condominioId: X.robles, periodo, saldoInicial: null }));
    await ok(ct.admin('egresos.borrar', { id: X.egreso }));
    const l = await hasta(() => ok(ct.db('Egreso', 'egresosPorCondominio', { args: { condominioId: X.robles } })), (x) => !x.some((e) => e.id === X.egreso));
    esperar(!l.some((e) => e.id === X.egreso), 'el egreso sigue registrado');
  });
  await prueba('Cargo extraordinario guarda su tipo de ingreso', async () => {
    const r = await ok(ct.admin('cargoExtraordinario', { condominioId: X.robles, concepto: 'Reparación de bomba', monto: 150, vence: manana, tipo: 'MANT_EXTERNO', unidadIds: [X.unidadesRobles[0]] }));
    const l = await hasta(() => ok(ct.db('Cargo', 'cargosPorCondominio', { args: { condominioId: X.robles } })), (x) => x.some((c) => c.concepto === 'Reparación de bomba'));
    const c = l.find((x) => x.concepto === 'Reparación de bomba');
    esperar(r.creados === 1 && c?.tipo === 'MANT_EXTERNO', JSON.stringify(c));
    await ok(ct.db('Cargo', 'update', { input: { id: c.id, estado: 'CANCELADO' } }));
    return 'Mantenimiento externo';
  });

  // =====================================================================
  grupo('Comunicación: comunicados, avisos, encuestas y chat');
  await prueba('Administrador publica comunicado y avisa a todas las unidades', async () => {
    const c = await ok(ag.db('Comunicado', 'create', { input: { condominioId: X.robles, titulo: 'Corte de agua el sábado', cuerpo: 'De 9 a 13 h por mantenimiento de cisterna.', importante: true, autor: 'Administración' } }));
    X.comunicado = c.id;
    const r = await ok(ag.admin('avisar', { condominioId: X.robles, tipo: 'COMUNICADO', titulo: 'Nuevo comunicado: Corte de agua el sábado' }));
    esperar(r.enviados === 8, JSON.stringify(r));
    return `${r.enviados} unidades notificadas`;
  });
  await prueba('Residente ve el comunicado y el aviso', async () => {
    const l = await hasta(() => ok(r2.portal('comunicados.lista')), (x) => x.some((c) => c.id === X.comunicado));
    esperar(l.some((c) => c.id === X.comunicado), 'no aparece');
    const a = await ok(r2.portal('inicio.avisos'));
    esperar(a.avisos.some((v) => v.titulo.includes('Corte de agua')), 'sin aviso');
  });
  await prueba('Residente marca sus avisos como leídos', async () => {
    await ok(r2.portal('inicio.leerAvisos'));
    const a = await ok(r2.portal('inicio.avisos'));
    esperar(a.sinLeer === 0, `sin leer: ${a.sinLeer}`);
  });
  await prueba('Gerente de operación avisa a Torre Mirador', async () => {
    const r = await ok(op.admin('avisar', { condominioId: X.torre, titulo: 'Fumigación de áreas comunes', texto: 'Martes 10 h' }));
    const a = await hasta(() => ok(r3.portal('inicio.avisos')), (x) => x.avisos.some((v) => v.titulo === 'Fumigación de áreas comunes'));
    esperar(a.avisos.some((v) => v.titulo === 'Fumigación de áreas comunes'), 'sin aviso');
    return `${r.enviados} departamentos`;
  });
  await prueba('Encuesta: crear, votar y ver resultados', async () => {
    const e = await ok(ag.db('Encuesta', 'create', { input: { condominioId: X.robles, pregunta: '¿Aprobamos pintar la fachada?', opciones: ['Sí', 'No', 'Abstención'], estado: 'ABIERTA' } }));
    X.encuesta = e.id;
    const antes = await hasta(() => ok(r1.portal('encuestas.lista')), (x) => x.some((v) => v.id === e.id));
    esperar(antes.find((v) => v.id === e.id).resultados === null, 'resultados visibles antes de votar');
    await ok(r1.portal('encuestas.votar', { encuestaId: e.id, opcion: 'Sí' }));
    await ok(r2.portal('encuestas.votar', { encuestaId: e.id, opcion: 'No' }));
    const d = (await hasta(() => ok(r1.portal('encuestas.lista')), (x) => x.find((v) => v.id === e.id)?.totalVotos === 2)).find((v) => v.id === e.id);
    esperar(d.miVoto === 'Sí' && d.resultados['Sí'] === 1 && d.resultados.No === 1, JSON.stringify(d.resultados));
    return 'Sí 1 · No 1';
  });
  await prueba('Una unidad solo vota una vez; opción inválida rechazada', async () => {
    await bloqueado(r1.portal('encuestas.votar', { encuestaId: X.encuesta, opcion: 'No' }));
    return bloqueado(r2.portal('encuestas.votar', { encuestaId: X.encuesta, opcion: 'Tal vez' }));
  });
  await prueba('Encuesta cerrada ya no acepta votos', async () => {
    await ok(ag.db('Encuesta', 'update', { input: { id: X.encuesta, estado: 'CERRADA' } }));
    const msg = await bloqueado(r1.portal('encuestas.votar', { encuestaId: X.encuesta, opcion: 'Sí' }));
    esperar(msg.includes('cerró'), msg);
    const d = (await ok(r1.portal('encuestas.lista'))).find((v) => v.id === X.encuesta);
    esperar(d.cerrada, 'no aparece cerrada');
    return msg;
  });
  await prueba('Chat residente ↔ administración', async () => {
    await ok(r1.portal('chat.enviar', { canal: 'ADMIN', texto: '¿A qué hora pasa el camión de basura?' }));
    const hilo = `${X.robles}#${X.unidadesRobles[0]}#ADMIN`;
    const m = await hasta(() => ok(ag.db('Mensaje', 'mensajesPorHilo', { args: { hilo } })), (x) => x.length === 1);
    esperar(m.length === 1, `${m.length} mensajes`);
    await ok(ag.db('Mensaje', 'create', { input: { condominioId: X.robles, unidadId: X.unidadesRobles[0], texto: 'Lunes, miércoles y viernes a las 8 h.' } }));
    const v = await hasta(() => ok(r1.portal('chat.mensajes', { canal: 'ADMIN' })), (x) => x.length === 2);
    esperar(v.length === 2 && v[1].autorRol === 'ADMIN', JSON.stringify(v.map((x) => x.autorRol)));
  });
  await prueba('Rol con chat «solo ver» no puede responder', () =>
    bloqueado(ct.db('Mensaje', 'create', { input: { condominioId: X.robles, unidadId: X.unidadesRobles[0], texto: 'x' } })),
  );
  await prueba('Fotos en el chat: residente ↔ administración', async () => {
    const key = await r1.subir('chat', 'foto.jpg', 'foto de la fuga', 'image/jpeg');
    await ok(r1.portal('chat.enviar', { canal: 'ADMIN', imagenPath: key }));
    const hilo = `${X.robles}#${X.unidadesRobles[0]}#ADMIN`;
    const m = await hasta(() => ok(ag.db('Mensaje', 'mensajesPorHilo', { args: { hilo } })), (x) => x.some((y) => y.imagenUrl));
    const conFoto = m.find((y) => y.imagenUrl);
    esperar(conFoto && conFoto.texto === '📷 Foto' && !conFoto.imagenPath, JSON.stringify(conFoto).slice(0, 120));
    esperar((await (await fetch(conFoto.imagenUrl)).text()) === 'foto de la fuga', 'la administración no abre la foto');
    const r = await ok(ag.admin('chat.subirImagen', { condominioId: X.robles, nombre: 'foto-e2e-plano.jpg', tamano: 12 }));
    esperar((await fetch(r.url, { method: 'PUT', headers: { 'Content-Type': r.contentType }, body: 'plano de obra' })).ok, 'no subió la foto');
    await ok(ag.db('Mensaje', 'create', { input: { condominioId: X.robles, unidadId: X.unidadesRobles[0], texto: 'Aquí el plano', imagenPath: r.path } }));
    const v = await hasta(() => ok(r1.portal('chat.mensajes', { canal: 'ADMIN' })), (x) => x.filter((y) => y.imagenUrl).length === 2);
    const deAdmin = v.find((y) => y.autorRol === 'ADMIN' && y.imagenUrl);
    esperar(deAdmin && !deAdmin.imagenPath && (await (await fetch(deAdmin.imagenUrl)).text()) === 'plano de obra', JSON.stringify(deAdmin).slice(0, 120));
    return 'foto enviada y recibida en ambos sentidos';
  });
  await prueba('Control de accesos: registrar, no repetir códigos y máximo 6', async () => {
    const r = await ok(ag.admin('accesos.agregar', { userId: r1.sub, accesos: [{ tipo: 'Llavero de proximidad', codigo: 'E2E-001' }, { tipo: 'Control remoto de portón', codigo: 'P-77' }] }));
    esperar(r.accesos.length === 2 && r.accesos[0].por === E('admin.general'), JSON.stringify(r.accesos[0]));
    await bloqueado(ag.admin('accesos.agregar', { userId: r2.sub, accesos: [{ tipo: 'Llavero de proximidad', codigo: 'e2e 001' }] }));
    await bloqueado(ag.admin('accesos.agregar', { userId: r1.sub, accesos: Array.from({ length: 5 }, (_, i) => ({ tipo: 'Tarjeta de proximidad', codigo: `T${i}` })) }));
    await bloqueado(ag.admin('accesos.agregar', { userId: r1.sub, accesos: [{ tipo: 'Inventado', codigo: '1' }] }));
    const l = await ok(ag.db('Perfil', 'list'));
    esperar(JSON.parse(l.find((x) => x.userId === r1.sub).accesos).length === 2, 'no se guardaron');
    return '2 accesos; repetido y exceso rechazados';
  });
  await prueba('Control de accesos: se registra con su estado (activado o suspendido)', async () => {
    const r = await ok(ag.admin('accesos.agregar', { userId: r2.sub, accesos: [{ tipo: 'Tarjeta de proximidad', codigo: 'E2E-S1', estado: 'SUSPENDIDO' }, { tipo: 'Llave física', codigo: 'E2E-K1' }] }));
    esperar(r.accesos[0].estado === 'SUSPENDIDO' && r.accesos[1].estado === 'ACTIVO', JSON.stringify(r.accesos));
    return 'tarjeta suspendida, llave activada';
  });
  await prueba('Control de accesos: suspender y activar (importación del Excel)', async () => {
    const l = await ok(ag.db('Perfil', 'list'));
    const a = JSON.parse(l.find((x) => x.userId === r1.sub).accesos);
    const r = await ok(ag.admin('accesos.estados', { cambios: [{ userId: r1.sub, accesoId: a[0].id, estado: 'SUSPENDIDO' }] }));
    esperar(r.aplicados === 1, JSON.stringify(r));
    const l2 = await ok(ag.db('Perfil', 'list'));
    const a2 = JSON.parse(l2.find((x) => x.userId === r1.sub).accesos);
    esperar(a2[0].estado === 'SUSPENDIDO' && a2[0].estadoPor === E('admin.general') && (a2[1].estado ?? 'ACTIVO') === 'ACTIVO', JSON.stringify(a2));
    await bloqueado(ag.admin('accesos.estados', { cambios: [{ userId: r1.sub, accesoId: a[0].id, estado: 'APAGADO' }] }));
    await bloqueado(ct.admin('accesos.estados', { cambios: [{ userId: r1.sub, accesoId: a[0].id, estado: 'ACTIVO' }] }));
    const r3 = await ok(ag.admin('accesos.estados', { cambios: [{ userId: r1.sub, accesoId: a[0].id, estado: 'ACTIVO' }] }));
    esperar(r3.aplicados === 1, JSON.stringify(r3));
    return 'suspendido y reactivado';
  });
  await prueba('Control de accesos: solo el superadministrador da de baja', async () => {
    const l = await ok(ag.db('Perfil', 'list'));
    const id = JSON.parse(l.find((x) => x.userId === r1.sub).accesos)[0].id;
    await bloqueado(ag.admin('accesos.eliminar', { userId: r1.sub, accesoId: id }));
    await bloqueado(ct.admin('accesos.agregar', { userId: r1.sub, accesos: [{ tipo: 'Llave física', codigo: 'K1' }] }));
    const r = await ok(sa.admin('accesos.eliminar', { userId: r1.sub, accesoId: id }));
    esperar(r.accesos.length === 1, JSON.stringify(r.accesos));
  });
  await prueba('Chat: no se puede enviar la foto de otro ni de otro condominio', async () => {
    const key = await r1.subir('chat', 'privada.jpg', 'privada', 'image/jpeg');
    await bloqueado(r2.portal('chat.enviar', { canal: 'ADMIN', imagenPath: key }));
    await bloqueado(ag.db('Mensaje', 'create', { input: { condominioId: X.robles, unidadId: X.unidadesRobles[0], texto: 'x', imagenPath: `condominios/${X.torre}/chat/x.jpg` } }));
    return bloqueado(ct.admin('chat.subirImagen', { condominioId: X.robles, nombre: 'x.jpg', tamano: 10 }));
  });

  // =====================================================================
  grupo('Operación: incidentes, mantenimientos, amenidades y mascotas');
  await prueba('Residente reporta incidente con foto', async () => {
    const foto = await r1.subir('incidentes', 'fuga.jpg', 'jpg', 'image/jpeg');
    const i = await ok(r1.portal('incidentes.crear', { titulo: 'Fuga en área de juegos', categoria: 'Plomería', descripcion: 'Sale agua del registro', ubicacion: 'Parque central', fotoPath: foto }));
    X.incidente = i.id;
    esperar(i.estado === 'ABIERTO', i.estado);
  });
  await prueba('Administrador atiende el incidente y ve la foto', async () => {
    const { url } = await ok(ag.admin('archivo', { model: 'Incidente', id: X.incidente }));
    esperar((await fetch(url)).ok, 'foto no descargable');
    await ok(ag.db('Incidente', 'update', { input: { id: X.incidente, estado: 'EN_PROCESO', respuesta: 'El plomero va mañana a las 10 h.' } }));
    const l = await hasta(() => ok(r1.portal('incidentes.lista')), (x) => x[0]?.estado === 'EN_PROCESO');
    esperar(l[0].respuesta?.includes('plomero'), 'sin respuesta');
  });
  await prueba('Mantenimiento programado visible para residentes', async () => {
    await ok(ag.db('Mantenimiento', 'create', { input: { condominioId: X.robles, titulo: 'Poda de árboles', tipo: 'PREVENTIVO', area: 'Áreas verdes', fecha: manana, estado: 'PROGRAMADO', proveedor: 'Jardines QRO' } }));
    const l = await hasta(() => ok(r2.portal('mantenimientos.lista')), (x) => x.length === 1);
    esperar(l[0]?.titulo === 'Poda de árboles', JSON.stringify(l));
  });
  await prueba('Alta de amenidades (con y sin aprobación)', async () => {
    const a1 = await ok(ag.db('Amenidad', 'create', { input: { condominioId: X.robles, nombre: 'Salón de eventos', horaApertura: '10:00', horaCierre: '22:00', maxHoras: 5, capacidad: 50, costo: 800, requiereAprobacion: true, activa: true } }));
    const a2 = await ok(ag.db('Amenidad', 'create', { input: { condominioId: X.robles, nombre: 'Asador', horaApertura: '09:00', horaCierre: '21:00', maxHoras: 3, requiereAprobacion: false, activa: true } }));
    X.salon = a1.id;
    X.asador = a2.id;
  });
  await prueba('Reserva que requiere aprobación queda solicitada', async () => {
    const r = await ok(r1.portal('amenidades.reservar', { amenidadId: X.salon, fecha: manana, horaInicio: '14:00', horaFin: '18:00', invitados: 30, nota: 'Cumpleaños' }));
    X.reserva = r.id;
    esperar(r.estado === 'SOLICITADA', r.estado);
  });
  await prueba('Reglas de reserva: horario ocupado, fuera de horario, máx. horas y capacidad', async () => {
    await bloqueado(r2.portal('amenidades.reservar', { amenidadId: X.salon, fecha: manana, horaInicio: '17:00', horaFin: '19:00' }));
    await bloqueado(r2.portal('amenidades.reservar', { amenidadId: X.salon, fecha: manana, horaInicio: '08:00', horaFin: '09:00' }));
    await bloqueado(r2.portal('amenidades.reservar', { amenidadId: X.salon, fecha: manana, horaInicio: '10:00', horaFin: '16:00' }));
    return bloqueado(r2.portal('amenidades.reservar', { amenidadId: X.salon, fecha: manana, horaInicio: '19:00', horaFin: '21:00', invitados: 80 }));
  });
  await prueba('Administrador aprueba la reserva', async () => {
    await ok(ag.db('Reserva', 'update', { input: { id: X.reserva, estado: 'APROBADA' } }));
    const d = await hasta(() => ok(r2.portal('amenidades.disponibilidad', { amenidadId: X.salon, fecha: manana })), (x) => x[0]?.estado === 'APROBADA');
    esperar(d.length === 1 && d[0].estado === 'APROBADA', JSON.stringify(d));
    return 'el vecino ve el horario ocupado';
  });
  await prueba('Reserva con confirmación automática y cancelación', async () => {
    const r = await ok(r2.portal('amenidades.reservar', { amenidadId: X.asador, fecha: manana, horaInicio: '13:00', horaFin: '15:00' }));
    esperar(r.estado === 'APROBADA', r.estado);
    await bloqueado(r1.portal('amenidades.cancelar', { reservaId: r.id }));
    const c = await ok(r2.portal('amenidades.cancelar', { reservaId: r.id }));
    esperar(c.estado === 'CANCELADA', c.estado);
  });
  await prueba('Registro de mascota con foto y aprobación', async () => {
    const foto = await r1.subir('mascotas', 'luna.jpg', 'jpg', 'image/jpeg');
    const m = await ok(r1.portal('mascotas.registrar', { nombre: 'Luna', especie: 'Perro', raza: 'Labrador', color: 'Dorado', fotoPath: foto, vacunaAntirrabica: hoy }));
    X.mascota = m.id;
    await bloqueado(r1.portal('mascotas.extraviada', { mascotaId: m.id, extraviada: true }));
    await ok(ag.db('Mascota', 'update', { input: { id: m.id, estado: 'APROBADA' } }));
    return 'no puede reportarse extraviada antes de aprobarse';
  });
  await prueba('Mascota extraviada: la ven vecinos y caseta con foto', async () => {
    await ok(r1.portal('mascotas.extraviada', { mascotaId: X.mascota, extraviada: true }));
    const v = await hasta(() => ok(r2.portal('mascotas.lista')), (x) => x.extraviadas.length === 1);
    esperar(v.extraviadas[0]?.nombre === 'Luna' && v.extraviadas[0].fotoUrl && v.extraviadas[0].unidad === 'Casa 1', JSON.stringify(v.extraviadas[0]).slice(0, 120));
    const c = await ok(g1.portal('caseta.panel'));
    esperar(c.extraviadas.some((m) => m.nombre === 'Luna'), 'caseta no la ve');
  });

  // =====================================================================
  grupo('Visitas y caseta');
  await prueba('Residente registra visita con pase QR', async () => {
    const v = await ok(r1.portal('visitas.crear', { nombre: 'Juan Pérez', tipo: 'VISITA', placas: 'abc-123', fecha: hoy }));
    X.visita = v;
    esperar(/^[A-Z2-9]{8}$/.test(v.codigo) && v.vigente && v.placas === 'ABC-123', JSON.stringify(v));
    return `código ${v.codigo}`;
  });
  await prueba('Caseta valida el QR', async () => {
    const v = await ok(g1.portal('caseta.validar', { codigo: `SIIA:${X.visita.codigo.toLowerCase()}` }));
    esperar(v.vigente && v.unidad === 'Casa 1', JSON.stringify(v));
    return `${v.nombre} → ${v.unidad}`;
  });
  await prueba('Entrada registrada y aviso al residente', async () => {
    await ok(g1.portal('caseta.entrada', { visitaId: X.visita.id }));
    const a = await hasta(() => ok(r1.portal('inicio.avisos')), (x) => x.avisos.some((v) => v.titulo.includes('Juan Pérez ingresó')));
    esperar(a.avisos.some((v) => v.titulo.includes('Juan Pérez ingresó')), 'sin aviso');
    await bloqueado(g1.portal('caseta.entrada', { visitaId: X.visita.id }));
    return 'el mismo pase no entra dos veces';
  });
  await prueba('Salida registrada en la bitácora y aviso al residente', async () => {
    await ok(g1.portal('caseta.salida', { visitaId: X.visita.id }));
    const av = await hasta(() => ok(r1.portal('inicio.avisos')), (x) => x.avisos.some((v) => v.titulo === 'Tu visita Juan Pérez salió'));
    esperar(av.avisos.some((v) => v.titulo === 'Tu visita Juan Pérez salió'), 'sin aviso de salida');
    const p = await hasta(() => ok(g1.portal('caseta.panel')), (x) => x.bitacora.some((v) => v.id === X.visita.id && v.estado === 'SALIO'));
    esperar(p.bitacora.some((v) => v.id === X.visita.id && v.estado === 'SALIO'), 'no aparece en bitácora');
  });
  await prueba('Pase de servicio con vigencia de varios días permite reingreso', async () => {
    const v = await ok(r2.portal('visitas.crear', { nombre: 'Jardinero', tipo: 'SERVICIO', fecha: hoy, fechaFin: manana }));
    await ok(g1.portal('caseta.entrada', { visitaId: v.id }));
    await ok(g1.portal('caseta.salida', { visitaId: v.id }));
    await ok(g1.portal('caseta.entrada', { visitaId: v.id }));
    return 'entra, sale y vuelve a entrar';
  });
  await prueba('Residente cancela una visita programada', async () => {
    const v = await ok(r2.portal('visitas.crear', { nombre: 'Visita cancelada', fecha: manana }));
    const c = await ok(r2.portal('visitas.cancelar', { visitaId: v.id }));
    esperar(c.estado === 'CANCELADA', c.estado);
  });
  await prueba('Estacionamiento de visitas: la visita en auto ocupa un lugar y lo libera al salir', async () => {
    await ok(sa.db('Condominio', 'update', { input: { id: X.robles, estacionamientoVisitas: 1 } }));
    await bloqueado(r1.portal('visitas.crear', { nombre: 'Sin placas', fecha: hoy, enAuto: true }));
    const v = await ok(r1.portal('visitas.crear', { nombre: 'Visita en auto', fecha: hoy, enAuto: true, placas: 'xyz-987' }));
    esperar(v.enAuto === true, JSON.stringify(v));
    const val = await ok(g1.portal('caseta.validar', { codigo: v.codigo }));
    esperar(val.estacionamiento?.total === 1 && val.estacionamiento.libres === 1, JSON.stringify(val.estacionamiento));
    const e = await ok(g1.portal('caseta.entrada', { visitaId: v.id }));
    esperar(e.ocupaLugar === true && e.estacionamiento.libres === 0, JSON.stringify(e.estacionamiento));
    const p = await hasta(() => ok(g1.portal('caseta.panel')), (x) => x.estacionamiento.ocupados === 1);
    esperar(p.estacionamiento.libres === 0 && p.estacionamiento.ocupados === 1, JSON.stringify(p.estacionamiento));
    // Sin lugares: un segundo auto (sin pase, autorizado por el residente) solo entra «sin lugar»
    const sol = await ok(g1.portal('caseta.registrar', { unidadId: X.unidadesRobles[1], tipo: 'VISITA', nombre: 'Segundo auto', enAuto: true, placas: 'seg-001' }));
    await ok(r2.portal('visitas.responder', { visitaId: sol.id, autorizar: true }));
    await bloqueado(g1.portal('caseta.entrada', { visitaId: sol.id }));
    const sin = await ok(g1.portal('caseta.entrada', { visitaId: sol.id, sinLugar: true }));
    esperar(sin.ocupaLugar === false, JSON.stringify(sin));
    const s = await ok(g1.portal('caseta.salida', { visitaId: v.id }));
    esperar(s.estacionamiento.libres === 1, JSON.stringify(s.estacionamiento));
    await ok(g1.portal('caseta.salida', { visitaId: sin.id }));
    await ok(sa.db('Condominio', 'update', { input: { id: X.robles, estacionamientoVisitas: null } }));
    return '1 lugar: ocupado al entrar, segundo auto sin lugar, liberado al salir';
  });
  await prueba('Llegada sin QR: la caseta pide permiso y el residente autoriza', async () => {
    await bloqueado(g1.portal('caseta.registrar', { unidadId: X.unidadesRobles[0], tipo: 'VISITA', nombre: 'Sin placas', enAuto: true }));
    const v = await ok(g1.portal('caseta.registrar', { unidadId: X.unidadesRobles[0], tipo: 'VISITA', nombre: 'Pedro Sin Pase', notas: 'Viene a dejar documentos' }));
    esperar(v.estado === 'POR_AUTORIZAR', v.estado);
    await bloqueado(g1.portal('caseta.entrada', { visitaId: v.id }));
    const a = await hasta(() => ok(r1.portal('inicio.avisos')), (x) => x.avisos.some((y) => y.titulo.includes('Pedro Sin Pase')));
    esperar(a.avisos.some((y) => y.tipo === 'ACCESO' && y.titulo === 'Una visita pide acceso: Pedro Sin Pase'), 'sin aviso de solicitud');
    await bloqueado(r2.portal('visitas.responder', { visitaId: v.id, autorizar: true }));
    const r = await ok(r1.portal('visitas.responder', { visitaId: v.id, autorizar: true }));
    esperar(r.estado === 'AUTORIZADA' && r.respuestaVia === 'RESIDENTE', JSON.stringify(r).slice(0, 160));
    const p = await ok(g1.portal('caseta.panel'));
    esperar(p.solicitudes.some((x) => x.id === v.id && x.estado === 'AUTORIZADA'), 'la caseta no ve la autorización');
    await ok(g1.portal('caseta.entrada', { visitaId: v.id }));
    await ok(g1.portal('caseta.salida', { visitaId: v.id }));
    return 'pidió permiso, autorizó el residente, entró y salió';
  });
  await prueba('Llegada sin QR: rechazo del residente, autorización por llamada y cancelación', async () => {
    const v1 = await ok(g1.portal('caseta.registrar', { unidadId: X.unidadesRobles[0], tipo: 'SERVICIO', nombre: 'Vendedor' }));
    const r1r = await ok(r1.portal('visitas.responder', { visitaId: v1.id, autorizar: false, nota: 'No lo conozco' }));
    esperar(r1r.estado === 'RECHAZADA', r1r.estado);
    await bloqueado(g1.portal('caseta.entrada', { visitaId: v1.id }));
    await bloqueado(r1.portal('visitas.responder', { visitaId: v1.id, autorizar: true }));
    const v2 = await ok(g1.portal('caseta.registrar', { unidadId: X.unidadesRobles[0], tipo: 'PROVEEDOR', nombre: 'Técnico de gas' }));
    await bloqueado(g1.portal('caseta.solicitud', { visitaId: v2.id, accion: 'LLAMADA' }));
    const l = await ok(g1.portal('caseta.solicitud', { visitaId: v2.id, accion: 'LLAMADA', nota: 'Habló con la Sra. de Casa 1' }));
    esperar(l.estado === 'AUTORIZADA' && l.respuestaVia === 'LLAMADA', JSON.stringify(l).slice(0, 160));
    const v3 = await ok(g1.portal('caseta.registrar', { unidadId: X.unidadesRobles[0], tipo: 'VISITA', nombre: 'Se fue' }));
    const c = await ok(g1.portal('caseta.solicitud', { visitaId: v3.id, accion: 'CANCELAR' }));
    esperar(c.estado === 'CANCELADA', c.estado);
    return 'rechazada, autorizada por llamada y cancelada';
  });
  await prueba('Registro de vigilancia: cambio de turno con fotos y notas sin edición', async () => {
    const f1 = await g1.subir('vigilancia', 'guardia.jpg', 'foto guardia', 'image/jpeg');
    const f2 = await g1.subir('vigilancia', 'caseta.jpg', 'foto caseta', 'image/jpeg');
    const base = { entra: 'Vigilante Noche', sale: 'Vigilante Día', fotoGuardiaPath: f1, fotoCasetaPath: f2, equipo: ['Radio', 'Llaves de caseta'], nota: 'Sin novedades' };
    await bloqueado(g1.portal('vigilancia.cambioTurno', base));
    await bloqueado(g1.portal('vigilancia.cambioTurno', { ...base, casetaLimpia: true, fotoCasetaPath: '' }));
    const t = await ok(g1.portal('vigilancia.cambioTurno', { ...base, casetaLimpia: true }));
    esperar(t.casetaLimpia && !t.fotoGuardiaPath && JSON.parse(t.notas).length === 1, JSON.stringify(t).slice(0, 160));
    const n = await ok(g1.portal('vigilancia.nota', { turnoId: t.id, texto: 'Se fue la luz 10 minutos' }));
    esperar(n.notas.length === 2 && n.notas[0].texto === 'Sin novedades', JSON.stringify(n));
    const l = await ok(g1.portal('vigilancia.turnos'));
    const mio = l.find((x) => x.id === t.id);
    esperar(mio && (await (await fetch(mio.fotoGuardiaUrl)).text()) === 'foto guardia', 'no se ve la foto');
    const adm = await ok(ag.db('TurnoVigilancia', 'turnosPorCondominio', { args: { condominioId: X.robles } }));
    esperar(adm.some((x) => x.id === t.id && x.fotoCasetaUrl), 'la administración no lo ve');
    await bloqueado(ag.db('TurnoVigilancia', 'update', { input: { id: t.id, entra: 'Otro' } }));
    await bloqueado(r1.portal('vigilancia.turnos'));
    return 'registrado, nota agregada, visible para la administración y sin edición';
  });
  await prueba('Caseta registra paquetería sin pase y avisa a la unidad', async () => {
    await ok(g1.portal('caseta.registrar', { unidadId: X.unidadesRobles[1], tipo: 'PAQUETERIA', nombre: 'Amazon', notas: '2 cajas' }));
    const a = await hasta(() => ok(r2.portal('inicio.avisos')), (x) => x.avisos.some((v) => v.titulo.includes('paquetería')));
    esperar(a.avisos.some((v) => v.titulo === 'Tienes paquetería en caseta: Amazon'), 'sin aviso');
  });
  await prueba('Aviso de servicios: la caseta avisa a todo el condominio', async () => {
    await ok(sa.db('Condominio', 'update', { input: { id: X.robles, serviciosCondominio: ['Basura', 'Gas', 'Rondín de supervisión'] } }));
    await bloqueado(g1.portal('caseta.servicio', { servicio: 'Pizza' }));
    await bloqueado(r1.portal('caseta.servicio', { servicio: 'Basura' }));
    const r = await ok(g1.portal('caseta.servicio', { servicio: 'Basura', nota: 'Saquen su basura' }));
    esperar(r.enviados === 8, JSON.stringify(r));
    const titulo = 'Llegó el camión de la basura 🚪';
    for (const s of [r1, r2]) {
      const a = await hasta(() => ok(s.portal('inicio.avisos')), (x) => x.avisos.some((v) => v.titulo === titulo));
      esperar(a.avisos.some((v) => v.titulo === titulo && v.texto === 'Saquen su basura' && v.imagen === '/servicios/basura.jpg'), 'sin aviso de servicio con imagen');
    }
    const img = await fetch(`${new URL(outputs.data.url).origin.includes('appsync') ? 'https://staging.siia.casa' : ''}/servicios/basura.jpg`);
    esperar(img.ok && img.headers.get('content-type')?.includes('image'), `imagen HTTP ${img.status}`);
    const perfil = await ok(g1.portal('perfil'));
    esperar((perfil.condominio?.serviciosCondominio ?? []).includes('Gas'), JSON.stringify(perfil.condominio));
    return `${r.enviados} unidades avisadas`;
  });
  await prueba('Caseta envía alerta a una unidad', async () => {
    await ok(g1.portal('caseta.alertar', { unidadId: X.unidadesRobles[0], titulo: 'Dejaste las luces del auto encendidas' }));
    const a = await hasta(() => ok(r1.portal('inicio.avisos')), (x) => x.avisos.some((v) => v.titulo.includes('luces')));
    esperar(a.avisos.some((v) => v.titulo.includes('luces')), 'sin aviso');
  });
  await prueba('Chat caseta ↔ residente', async () => {
    await ok(g1.portal('caseta.enviar', { unidadId: X.unidadesRobles[0], texto: 'Su visita está en la entrada.' }));
    await ok(r1.portal('chat.enviar', { canal: 'CASETA', texto: 'Gracias, que pase.' }));
    const m = await hasta(() => ok(g1.portal('caseta.mensajes', { unidadId: X.unidadesRobles[0] })), (x) => x.length === 2);
    esperar(m.length === 2, `${m.length} mensajes`);
    const h = await ok(g1.portal('caseta.hilos'));
    esperar(h.some((x) => x.unidad === 'Casa 1'), 'sin hilo');
  });
  await prueba('Caseta envía una foto al residente', async () => {
    const key = await g1.subir('chat', 'paquete.jpg', 'foto del paquete', 'image/jpeg');
    await ok(g1.portal('caseta.enviar', { unidadId: X.unidadesRobles[0], imagenPath: key }));
    const v = await hasta(() => ok(r1.portal('chat.mensajes', { canal: 'CASETA' })), (x) => x.some((y) => y.imagenUrl));
    const f = v.find((y) => y.imagenUrl);
    esperar(f && (await (await fetch(f.imagenUrl)).text()) === 'foto del paquete', JSON.stringify(f).slice(0, 120));
  });
  await prueba('Administrador consulta la bitácora de visitas', async () => {
    const v = await ok(ag.db('Visita', 'visitasPorCondominio', { args: { condominioId: X.robles } }));
    esperar(v.length >= 4, `${v.length} visitas`);
    return `${v.length} registros`;
  });

  // =====================================================================
  grupo('App instalable y notificaciones push');
  // Suscripción push «de prueba»: endpoint inexistente en el servicio de Mozilla con llaves válidas.
  // El servicio responde 404 y el notificador borra el dispositivo: así se comprueba que la notificación salió hacia él.
  const suscripcion = () => {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    return {
      endpoint: `https://updates.push.services.mozilla.com/wpush/v2/siia-e2e-${randomBytes(16).toString('hex')}`,
      keys: { p256dh: ecdh.getPublicKey('base64url'), auth: randomBytes(16).toString('base64url') },
    };
  };
  const api = (ses) => (ses === ag || ses === ct || ses === op ? ses.admin : ses.portal);
  const registrar = async (ses) => {
    await ok(api(ses)('notificaciones.suscribir', { subscription: suscripcion(), plataforma: 'pruebas e2e' }));
    return (await ok(api(ses)('notificaciones.estado'))).dispositivos;
  };
  const dispositivos = async (ses) => (await ok(api(ses)('notificaciones.estado'))).dispositivos;
  /** Espera a que el notificador procese el registro (borra el dispositivo al recibir el 404 del servicio push). */
  const notificado = async (ses, segundos = 30) => {
    for (let i = 0; i < segundos / 2; i++) {
      if ((await dispositivos(ses)) === 0) return true;
      await espera(2000);
    }
    return false;
  };

  await prueba('Archivos de la app instalable publicados', async () => {
    const base = 'https://staging.siia.casa';
    const m = await (await fetch(`${base}/manifest.webmanifest`)).json();
    esperar(m.display === 'standalone' && m.start_url.startsWith('/portal/') && m.icons.some((i) => i.purpose === 'maskable'), JSON.stringify(m).slice(0, 120));
    for (const f of ['/sw.js', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-180.png', '/icons/badge-96.png']) {
      const r = await fetch(base + f);
      esperar(r.ok, `${f}: HTTP ${r.status}`);
    }
    const portalHtml = await (await fetch(`${base}/portal/`)).text();
    esperar(portalHtml.includes('manifest.webmanifest') && portalHtml.includes('/sw.js'), 'el portal no enlaza manifest o service worker');
    return 'manifest, service worker e íconos';
  });
  await prueba('Sesión permanente: token de actualización de 10 años', async () => {
    const c = await cognito.send(new DescribeUserPoolClientCommand({ UserPoolId: POOL, ClientId: outputs.auth.user_pool_client_id }));
    const u = c.UserPoolClient;
    esperar(u.RefreshTokenValidity === 3650 && u.TokenValidityUnits?.RefreshToken === 'days', `${u.RefreshTokenValidity} ${u.TokenValidityUnits?.RefreshToken}`);
    return '3650 días';
  });
  await prueba('Cada rol ve solo sus tipos de notificación', async () => {
    const keys = async (ses) => (await ok(api(ses)('notificaciones.estado'))).categorias.map((c) => c.key).join(',');
    const r = { residente: await keys(r1), vigilante: await keys(g1), contadora: await keys(ct), operacion: await keys(op), general: await keys(ag) };
    esperar(r.residente === 'pagos,caseta,comunicados,tramites,chat', `residente: ${r.residente}`);
    esperar(r.vigilante === 'chat,accesos', `vigilante: ${r.vigilante}`);
    esperar(r.contadora === 'pagos,chat', `contadora: ${r.contadora}`);
    esperar(r.operacion === 'chat,incidentes,reservas,mascotas', `operación: ${r.operacion}`);
    esperar(r.general === 'pagos,chat,incidentes,reservas,mascotas', `general: ${r.general}`);
    return 'residente 5 · vigilante 2 · contadora 2 · operación 4 · general 5';
  });
  await prueba('Preferencias: apagar un tipo (ignora tipos que no le corresponden)', async () => {
    const r = await ok(r2.portal('notificaciones.preferencias', { apagadas: ['caseta', 'incidentes', 'inventado'] }));
    esperar(JSON.stringify(r.apagadas) === '["caseta"]', JSON.stringify(r.apagadas));
  });
  await prueba('Prueba de notificación sin dispositivos avisa al usuario', () => bloqueado(g1.portal('notificaciones.probar')));
  await prueba('Registrar y dar de baja un dispositivo', async () => {
    const s = suscripcion();
    await ok(r2.portal('notificaciones.suscribir', { subscription: s }));
    const e = await ok(r2.portal('notificaciones.estado', { endpoint: s.endpoint }));
    esperar(e.esteDispositivo && e.dispositivos === 1, JSON.stringify(e));
    await ok(r2.portal('notificaciones.baja', { endpoint: s.endpoint }));
    esperar((await dispositivos(r2)) === 0, 'sigue registrado');
    return bloqueado(r2.portal('notificaciones.suscribir', { subscription: { endpoint: 'http://inseguro', keys: {} } }));
  });
  await prueba('Alerta de caseta llega al teléfono del residente', async () => {
    await registrar(r1);
    await ok(g1.portal('caseta.alertar', { unidadId: X.unidadesRobles[0], titulo: 'Prueba de notificación push' }));
    esperar(await notificado(r1), 'el notificador no envió al dispositivo del residente');
    return 'entregada al servicio push';
  });
  await prueba('Un tipo apagado no se envía', async () => {
    await registrar(r2);
    await ok(g1.portal('caseta.alertar', { unidadId: X.unidadesRobles[1], titulo: 'No debe notificar' }));
    await espera(12000);
    esperar((await dispositivos(r2)) === 1, 'se envió una notificación de un tipo apagado');
    await ok(r2.portal('notificaciones.preferencias', { apagadas: [] }));
    return 'caseta apagada: sin envío';
  });
  await prueba('Respuesta de la administración en el chat llega al residente', async () => {
    await ok(ag.db('Mensaje', 'create', { input: { condominioId: X.robles, unidadId: X.unidadesRobles[1], texto: 'Respuesta con notificación' } }));
    esperar(await notificado(r2), 'sin envío al residente');
  });
  await prueba('Mensaje de residente a caseta llega al vigilante', async () => {
    await registrar(g1);
    await ok(r1.portal('chat.enviar', { canal: 'CASETA', texto: '¿Llegó mi paquete?' }));
    esperar(await notificado(g1), 'sin envío al vigilante');
  });
  await prueba('Comprobante nuevo llega a la contadora', async () => {
    await registrar(ct);
    const k = await r1.subir('comprobantes', 'push.pdf', '%PDF', 'application/pdf');
    await ok(r1.portal('finanzas.registrarPago', { monto: 10, comprobantePath: k }));
    esperar(await notificado(ct), 'sin envío a la contadora');
  });
  await prueba('Incidente en Los Robles llega al administrador general y no a Operación de Torre', async () => {
    await registrar(ag);
    await registrar(op);
    await ok(r1.portal('incidentes.crear', { titulo: 'Prueba de notificación de incidente' }));
    esperar(await notificado(ag), 'sin envío al administrador general');
    esperar((await dispositivos(op)) === 1, 'se notificó a un administrador de otro condominio');
    return 'solo a quien atiende el condominio';
  });
  await prueba('Mascota por validar y reserva por aprobar llegan al administrador', async () => {
    await registrar(ag);
    await ok(r2.portal('mascotas.registrar', { nombre: 'Michi', especie: 'Gato' }));
    esperar(await notificado(ag), 'sin envío por la mascota');
    await registrar(ag);
    const pasado = new Date(Date.parse(`${manana}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
    await ok(r2.portal('amenidades.reservar', { amenidadId: X.salon, fecha: pasado, horaInicio: '12:00', horaFin: '14:00' }));
    esperar(await notificado(ag), 'sin envío por la reserva');
  });

  // =====================================================================
  grupo('Servicios por condominio y aislamiento entre propiedades');
  await prueba('Servicio no contratado no está disponible (Torre sin amenidades)', () => bloqueado(r3.portal('amenidades.lista')));
  await prueba('Residente de Torre usa sus servicios', async () => {
    const i = await ok(r3.portal('inicio.resumen'));
    await ok(r3.portal('incidentes.crear', { titulo: 'Elevador detenido', categoria: 'Elevador' }));
    return `avisos sin leer: ${i.avisosSinLeer}`;
  });
  await prueba('Portal desactivado bloquea a los residentes de esa propiedad', async () => {
    await ok(sa.db('Condominio', 'update', { input: { id: X.torre, activo: false } }));
    await bloqueado(r3.portal('inicio.resumen'));
    await ok(sa.db('Condominio', 'update', { input: { id: X.torre, activo: true } }));
    await ok(r3.portal('inicio.resumen'));
    return 'bloqueado y reactivado';
  });
  await prueba('Residente de Torre no ve datos de Los Robles', async () => {
    await bloqueado(r3.portal('finanzas.recibo', { pagoId: X.pago1 }));
    await bloqueado(r3.portal('encuestas.votar', { encuestaId: X.encuesta, opcion: 'Sí' }));
    return bloqueado(r3.portal('visitas.cancelar', { visitaId: X.visita.id }));
  });
  await prueba('Vigilante de Los Robles no valida pases de otra propiedad', async () => {
    const v = await ok(r3.portal('visitas.crear', { nombre: 'Visita Torre', fecha: hoy }));
    return bloqueado(g1.portal('caseta.validar', { codigo: v.codigo }));
  });
  await prueba('Residente no lee archivos de otro residente en S3', async () => {
    try {
      await r2.s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: X.comprobante }));
    } catch (e) {
      return e.name;
    }
    throw new Error('lectura permitida');
  });
  await prueba('Residente no puede adjuntar el comprobante de otro residente', () =>
    bloqueado(r2.portal('finanzas.registrarPago', { monto: 1, comprobantePath: X.comprobante })),
  );

  // =====================================================================
  grupo('Almacenamiento de archivos');
  await prueba('Residente no puede borrar un comprobante ya enviado', async () => {
    try {
      await r1.s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: X.comprobante }));
    } catch (e) {
      return e.name;
    }
    throw new Error('borrado permitido');
  });
  await prueba('Archivo sin dueño registrado es rechazado', async () => {
    const k = await r2.subir('comprobantes', 'sin-dueno.pdf', '%PDF', 'application/pdf', false);
    return bloqueado(r2.portal('finanzas.registrarPago', { monto: 1, comprobantePath: k }));
  });
  await prueba('Tipo de archivo no permitido es rechazado', async () => {
    const k = await r2.subir('comprobantes', 'programa.exe', 'MZ', 'application/x-msdownload');
    return bloqueado(r2.portal('finanzas.registrarPago', { monto: 1, comprobantePath: k }));
  });
  await prueba('Archivo de otra carpeta no sirve como comprobante', async () => {
    const k = await r2.subir('mascotas', 'perro.jpg', 'jpg', 'image/jpeg');
    return bloqueado(r2.portal('finanzas.registrarPago', { monto: 1, comprobantePath: k }));
  });
  await prueba('Archivo de más de 8 MB es rechazado', async () => {
    const k = await r2.subir('incidentes', 'enorme.jpg', Buffer.alloc(8 * 1024 * 1024 + 1), 'image/jpeg');
    return bloqueado(r2.portal('incidentes.crear', { titulo: 'Foto enorme', fotoPath: k }));
  });
  await prueba('Archivo inexistente es rechazado', () =>
    bloqueado(r2.portal('mascotas.registrar', { nombre: 'Fantasma', fotoPath: `residentes/${r2.identityId}/mascotas/no-existe.jpg` })),
  );
  await prueba('Bucket: versionado, ciclo de vida y sin vaciado automático', async () => {
    const v = await s3.send(new GetBucketVersioningCommand({ Bucket: BUCKET }));
    esperar(v.Status === 'Enabled', `versionado: ${v.Status}`);
    const l = await s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: BUCKET }));
    const regla = l.Rules.find((r) => r.ID === 'conservacion-archivos');
    esperar(regla?.NoncurrentVersionExpiration?.NoncurrentDays === 1825 && !regla.Expiration, JSON.stringify(regla));
    const tags = await s3
      .send(new GetBucketTaggingCommand({ Bucket: BUCKET }))
      .then((t) => t.TagSet)
      .catch(() => []);
    esperar(!tags.some((t) => t.Key === 'aws-cdk:auto-delete-objects'), 'etiqueta de vaciado automático presente');
    const pol = (await s3.send(new GetBucketPolicyCommand({ Bucket: BUCKET }))).Policy;
    esperar(!pol.includes('AutoDeleteObjects'), 'la política aún permite el vaciado automático');
    return 'versiones 5 años, sin vencimiento de archivos actuales';
  });
  await prueba('Un archivo borrado se puede recuperar de su versión anterior', async () => {
    const k = await r2.subir('comprobantes', 'recuperable.pdf', '%PDF original', 'application/pdf');
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: k }));
    const v = await s3.send(new ListObjectVersionsCommand({ Bucket: BUCKET, Prefix: k }));
    const anterior = v.Versions?.find((x) => x.Key === k);
    esperar(anterior && v.DeleteMarkers?.length, 'sin versión anterior');
    await s3.send(new CopyObjectCommand({ Bucket: BUCKET, Key: k, CopySource: `${BUCKET}/${encodeURIComponent(k)}?versionId=${anterior.VersionId}` }));
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: k }));
    esperar((await r.Body.transformToString()) === '%PDF original', 'contenido distinto');
    return 'restaurado';
  });
  await prueba('Tablas con respaldo continuo y protección contra borrado', async () => {
    const malas = [];
    for (const m of ['Pago', 'Cargo', 'Perfil', 'Condominio', 'Unidad', 'Visita']) {
      const b = await ddb.send(new DescribeContinuousBackupsCommand({ TableName: T(m) }));
      const t = await ddb.send(new DescribeTableCommand({ TableName: T(m) }));
      const pitr = b.ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus;
      if (pitr !== 'ENABLED' || !t.Table.DeletionProtectionEnabled) malas.push(m);
    }
    esperar(!malas.length, `sin protección: ${malas.join(', ')}`);
    return 'PITR + protección en tablas clave';
  });

  // =====================================================================
  grupo('Roles de administración y condominios asignados');
  await prueba('Gerente de Torre no ve Los Robles', async () => {
    await bloqueado(op.db('Incidente', 'incidentesPorCondominio', { args: { condominioId: X.robles } }));
    const l = await ok(op.db('Incidente', 'incidentesPorCondominio', { args: { condominioId: X.torre } }));
    return `${l.length} incidente(s) en Torre`;
  });
  await prueba('Contadora no ve incidentes ni usuarios', async () => {
    await bloqueado(ct.db('Incidente', 'incidentesPorCondominio', { args: { condominioId: X.robles } }));
    return bloqueado(ct.db('Perfil', 'list'));
  });
  await prueba('Comité de consulta lee pero no modifica', async () => {
    const p = await ok(cs.db('Pago', 'pagosPorCondominio', { args: { condominioId: X.robles } }));
    await bloqueado(cs.db('Comunicado', 'update', { input: { id: X.comunicado, titulo: 'Cambiado' } }));
    await bloqueado(cs.admin('validarPago', { pagoId: X.pago1, aprobar: true }));
    return `lee ${p.length} pagos`;
  });
  await prueba('Gerente de operación no tiene permisos de finanzas', () => bloqueado(op.admin('generarCargos', { condominioId: X.torre, periodo })));
  await prueba('Administrador general da de alta una propiedad nueva y queda asignado', async () => {
    const c = await ok(ag.db('Condominio', 'create', { input: { nombre: `Plaza Norte${SUFIJO}`, tipo: 'Uso mixto / otro', modulos: ['visitas'], activo: true } }));
    X.plaza = c.id;
    const yo = await ok(ag.admin('yo'));
    esperar(yo.condominios.includes(c.id), JSON.stringify(yo.condominios));
    return `${c.nombre}`;
  });
  await prueba('Los administradores no leen tablas ni archivos directo', async () => {
    const x = await gql(ag.tok, 'query{ listPagos(limit:1){ items{ id } } }');
    esperar(!!x.errors, 'listPagos permitido');
    try {
      await ag.s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: X.comprobante }));
    } catch (e) {
      return `AppSync: ${x.errors[0].errorType} · S3: ${e.name}`;
    }
    throw new Error('lectura S3 permitida');
  });
  await prueba('Solo el superadministrador administra roles y administradores', async () => {
    await bloqueado(ag.admin('roles.lista'));
    await bloqueado(ag.admin('roles.guardar', { id: 'rol-general', nombre: 'x', permisos: {} }));
    return bloqueado(ag.admin('aprobar', { userId: SUB.ct, rol: 'ADMIN', rolAdminId: 'rol-general', condominiosAdmin: ['*'] }));
  });
  await prueba('Cambio de rol de un administrador aplica de inmediato', async () => {
    await ok(sa.admin('aprobar', { userId: SUB.cs, rol: 'ADMIN', rolAdminId: 'rol-contador', condominiosAdmin: [X.robles] }));
    const cs2 = await entrar('cs2', E('consulta'));
    const yo = await ok(cs2.admin('yo'));
    esperar(yo.rol === 'Contador', yo.rol);
    return 'Solo consulta → Contador';
  });
  await prueba('Rechazar a un administrador le quita el acceso al panel', async () => {
    await ok(sa.admin('rechazar', { userId: SUB.op, nota: 'Baja' }));
    try {
      await entrar('op2', E('operacion'));
    } catch (e) {
      return e.message;
    }
    return bloqueado(sesiones.op2.admin('yo'));
  });
  await prueba('Sin sesión no hay acceso a la API', async () => {
    const r = await fetch(outputs.data.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'mutation{ portal(action:"perfil") }' }) });
    esperar(r.status === 401, `HTTP ${r.status}`);
    return 'HTTP 401';
  });
} catch (e) {
  console.error('\nERROR inesperado (la corrida se detuvo):', e);
} finally {
  await signOut().catch(() => {});
  if (CONSERVAR) {
    console.log(`\n▶ Datos conservados (--conservar). Contraseña común de las cuentas @${DOMINIO}: ${PASS}`);
  } else {
    const l = await limpiar();
    console.log(`\n▶ Limpieza: ${l.condos} propiedades, ${l.registros} registros, ${l.perfiles} perfiles, ${l.usuarios} cuentas, ${l.archivos} archivos`);
  }
  const fallas = resultados.filter((r) => !r.ok);
  console.log(`\n${'='.repeat(60)}\nRESULTADO: ${resultados.length - fallas.length} de ${resultados.length} pruebas correctas`);
  for (const f of fallas) console.log(`  ✘ ${f.n} [${f.grupo}] ${f.nombre}: ${f.error}`);
  process.exitCode = fallas.length ? 1 : 0;
}
