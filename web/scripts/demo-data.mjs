// Datos de demostración para el portal de residentes (staging).
// Crea 2 condominios, 50 unidades, 50 residentes (+2 vigilantes) y datos en todos los módulos.
//
//   DEMO_PASSWORD='…' npm run demo:crear     → borra la demo anterior y crea una nueva
//   npm run demo:limpiar                     → borra todo lo de demostración
//
// Todo lo de demo se identifica por: condominios con id "demo-*", correos @demo.siia.casa
// y archivos en S3 cuyo nombre empieza con "demo-".
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { AppSyncClient, ListGraphqlApisCommand } from '@aws-sdk/client-appsync';

process.env.AWS_PROFILE ??= 'Gared';
process.env.AWS_REGION ??= 'us-east-1';

const outputs = JSON.parse(readFileSync(new URL('../amplify_outputs.json', import.meta.url), 'utf8'));
const POOL = outputs.auth.user_pool_id;
const BUCKET = outputs.storage.bucket_name;
const DOMINIO = 'demo.siia.casa';
const ADMIN_EMAIL = 'gared291281@gmail.com';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const cognito = new CognitoIdentityProviderClient({});
const s3 = new S3Client({});

// ---------- utilidades ----------
let seed = 20260930;
const rnd = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const chance = (p) => rnd() < p;
const shuffle = (a) => a.map((x) => [rnd(), x]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
const pad = (n, w = 2) => String(n).padStart(w, '0');

const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const addDays = (f, n) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const addMonths = (p, n) => {
  const [y, m] = p.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
/** Fecha y hora local de México (UTC-6) → ISO */
const at = (fecha, hh = 12, mm = 0) => new Date(`${fecha}T${pad(hh)}:${pad(mm)}:00-06:00`).toISOString();
const ahoraMenos = (min) => new Date(Date.now() - min * 60000).toISOString();
const mxn = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
const sinAcentos = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const codigos = new Set();
const codigo = () => {
  let c;
  do c = Array.from({ length: 8 }, () => ALFABETO[Math.floor(rnd() * ALFABETO.length)]).join('');
  while (codigos.has(c));
  codigos.add(c);
  return c;
};

// ---------- archivos de ejemplo ----------
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
/** Imagen PNG 480×360 con degradado y figura (sirve como "foto" de ejemplo). */
function png([r1, g1, b1], [r2, g2, b2], figura = 'circulo') {
  const W = 480;
  const H = 360;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const t = (x + y) / (W + H);
      let r = r1 + (r2 - r1) * t;
      let g = g1 + (g2 - g1) * t;
      let b = b1 + (b2 - b1) * t;
      const dx = x - W / 2;
      const dy = y - H / 2;
      const dentro = figura === 'circulo' ? dx * dx + dy * dy < 90 * 90 : Math.abs(dx) < 110 && Math.abs(dy) < 70;
      if (dentro) [r, g, b] = [255 - r * 0.3, 255 - g * 0.3, 255 - b * 0.3];
      const o = y * (W * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** PDF de una página con líneas de texto (comprobante de transferencia de ejemplo). */
function pdf(lineas) {
  const esc = (s) => sinAcentos(s).replace(/[\\()]/g, '\\$&');
  const texto = lineas.map((l, i) => `BT /F1 ${i === 0 ? 16 : 11} Tf 60 ${760 - i * 22} Td (${esc(l)}) Tj ET`).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(texto)} >>\nstream\n${texto}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// ---------- AWS ----------
async function tablas() {
  const apis = await new AppSyncClient({}).send(new ListGraphqlApisCommand({}));
  const api = apis.graphqlApis.find((a) => a.uris?.GRAPHQL === outputs.data.url);
  if (!api) throw new Error('No se encontró la API de AppSync del portal.');
  return (m) => `${m}-${api.apiId}-NONE`;
}

async function escribir(T, model, items) {
  const ts = new Date().toISOString();
  const reqs = items.map((it) => ({
    PutRequest: { Item: { createdAt: ts, updatedAt: it.updatedAt ?? it.createdAt ?? ts, __typename: model, ...it } },
  }));
  for (let i = 0; i < reqs.length; i += 25) {
    let pendientes = { [T(model)]: reqs.slice(i, i + 25) };
    for (let intento = 0; intento < 6 && Object.keys(pendientes).length; intento++) {
      const r = await ddb.send(new BatchWriteCommand({ RequestItems: pendientes }));
      pendientes = r.UnprocessedItems ?? {};
      if (Object.keys(pendientes).length) await new Promise((res) => setTimeout(res, 300 * (intento + 1)));
    }
  }
}

async function subir(key, body, contentType) {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
  return key;
}

async function crearUsuario(email, nombre, password, invitado = false) {
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
  await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId: POOL, Username: sub, Password: password, Permanent: !invitado }));
  return sub;
}

/** identityId de Cognito Identity de un usuario (para guardar sus archivos en su carpeta privada). */
async function identityIds(usuarios, password) {
  const { Amplify } = await import('aws-amplify');
  const { signIn, signOut, fetchAuthSession } = await import('aws-amplify/auth');
  Amplify.configure(outputs);
  const r = {};
  for (const u of usuarios) {
    await signOut().catch(() => {});
    await signIn({ username: u.email, password });
    r[u.sub] = (await fetchAuthSession()).identityId;
    process.stdout.write('.');
  }
  await signOut().catch(() => {});
  process.stdout.write('\n');
  return r;
}

// ---------- limpieza ----------
async function limpiar(T) {
  console.log('▶ Borrando demo anterior');
  // Usuarios
  let token;
  let borrados = 0;
  do {
    const r = await cognito.send(new ListUsersCommand({ UserPoolId: POOL, PaginationToken: token }));
    for (const u of r.Users ?? []) {
      const email = u.Attributes?.find((a) => a.Name === 'email')?.Value ?? '';
      if (email.endsWith(`@${DOMINIO}`)) {
        await cognito.send(new AdminDeleteUserCommand({ UserPoolId: POOL, Username: u.Username }));
        borrados++;
      }
    }
    token = r.PaginationToken;
  } while (token);
  console.log(`  usuarios: ${borrados}`);
  // Registros
  const modelos = ['Condominio', 'Unidad', 'Perfil', 'Cargo', 'Pago', 'Comunicado', 'Encuesta', 'Voto', 'Mensaje', 'Incidente', 'Mantenimiento', 'Amenidad', 'Reserva', 'Visita', 'Aviso', 'Mascota'];
  for (const m of modelos) {
    const keyName = m === 'Perfil' ? 'userId' : 'id';
    const campo = m === 'Condominio' ? 'id' : 'condominioId';
    let ExclusiveStartKey;
    const keys = [];
    do {
      const r = await ddb.send(
        new ScanCommand({
          TableName: T(m),
          ExclusiveStartKey,
          FilterExpression: m === 'Perfil' ? 'begins_with(#c, :d) OR contains(email, :dom)' : 'begins_with(#c, :d)',
          ExpressionAttributeNames: { '#c': campo },
          ExpressionAttributeValues: m === 'Perfil' ? { ':d': 'demo-', ':dom': `@${DOMINIO}` } : { ':d': 'demo-' },
          ProjectionExpression: m === 'Perfil' ? 'userId, email' : keyName,
        }),
      );
      keys.push(...(r.Items ?? []));
      ExclusiveStartKey = r.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    // Cuentas dadas de alta en condominios demo con correos reales (p. ej. pruebas del administrador)
    if (m === 'Perfil') {
      for (const k of keys.filter((x) => !String(x.email ?? '').endsWith(`@${DOMINIO}`))) {
        await cognito.send(new AdminDeleteUserCommand({ UserPoolId: POOL, Username: k.userId })).catch(() => undefined);
        console.log(`  usuario de prueba: ${k.email}`);
      }
      keys.forEach((k) => delete k.email);
    }
    for (let i = 0; i < keys.length; i += 25) {
      await ddb.send(new BatchWriteCommand({ RequestItems: { [T(m)]: keys.slice(i, i + 25).map((k) => ({ DeleteRequest: { Key: k } })) } }));
    }
    if (keys.length) console.log(`  ${m}: ${keys.length}`);
  }
  // Archivos
  let ContinuationToken;
  let archivos = 0;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: 'residentes/', ContinuationToken }));
    const demo = (r.Contents ?? []).filter((o) => o.Key.split('/').pop().startsWith('demo-'));
    if (demo.length) await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: demo.map((o) => ({ Key: o.Key })) } }));
    archivos += demo.length;
    ContinuationToken = r.NextContinuationToken;
  } while (ContinuationToken);
  console.log(`  archivos: ${archivos}`);
}

// ---------- catálogos ----------
const NOMBRES = ['María Fernanda', 'José Luis', 'Ana Sofía', 'Juan Carlos', 'Guadalupe', 'Miguel Ángel', 'Alejandra', 'Francisco', 'Daniela', 'Jorge', 'Mariana', 'Ricardo', 'Verónica', 'Luis Fernando', 'Gabriela', 'Roberto', 'Paola', 'Eduardo', 'Claudia', 'Arturo', 'Ximena', 'Héctor', 'Lucía', 'Sergio', 'Andrea', 'Fernando', 'Patricia', 'Raúl', 'Valeria', 'Óscar', 'Adriana', 'Diego', 'Mónica', 'Alberto', 'Carmen', 'Emiliano', 'Rocío', 'Javier', 'Karla', 'Manuel', 'Beatriz', 'Rodrigo', 'Silvia', 'Iván', 'Leticia', 'Pablo', 'Diana', 'Gerardo', 'Regina', 'Tomás'];
const APELLIDOS = ['García', 'Hernández', 'Martínez', 'López', 'González', 'Rodríguez', 'Pérez', 'Sánchez', 'Ramírez', 'Torres', 'Flores', 'Rivera', 'Gómez', 'Díaz', 'Cruz', 'Morales', 'Reyes', 'Jiménez', 'Ruiz', 'Mendoza', 'Aguilar', 'Vargas', 'Castillo', 'Ortiz', 'Ramos', 'Olvera', 'Rangel', 'Ugalde', 'Arteaga', 'Montes', 'Zúñiga', 'Salinas', 'Trejo', 'Ledesma', 'Padilla'];
const VISITANTES = ['Laura Méndez', 'Carlos Ibarra', 'Sofía Navarro', 'Pedro Alvarado', 'Elena Cabrera', 'Tío Ramiro', 'Abuela Chelo', 'Marco Villanueva', 'Fernanda Soto', 'Grupo de estudio (4 personas)', 'Ing. Salvador Quiroz', 'Dra. Irene Paredes', 'Compañeros de trabajo', 'Andrés y Paty', 'Luisa Fuentes'];
const SERVICIOS = [
  ['SERVICIO', 'Doña Juana (trabajadora del hogar)'],
  ['SERVICIO', 'Jardinería Hermanos Reséndiz'],
  ['SERVICIO', 'Clases de piano – Mtra. Olga'],
  ['PROVEEDOR', 'Técnico Telmex'],
  ['PROVEEDOR', 'Gas Express Nieto'],
  ['PROVEEDOR', 'Plomería Rápida QRO'],
  ['PROVEEDOR', 'Instalador de persianas'],
  ['PAQUETERIA', 'Amazon'],
  ['PAQUETERIA', 'Mercado Libre'],
  ['PAQUETERIA', 'DHL'],
  ['PAQUETERIA', 'Estafeta'],
  ['PAQUETERIA', 'Rappi – comida'],
];
const TODOS = ['finanzas', 'visitas', 'comunicados', 'encuestas', 'chat', 'incidentes', 'mantenimientos', 'amenidades', 'mascotas'];

const CONDOS = [
  {
    id: 'demo-encinos',
    nombre: 'Residencial Los Encinos',
    tipo: 'Fraccionamiento cerrado',
    direccion: 'Av. de los Encinos 1200, El Refugio, 76146 Querétaro, Qro.',
    modulos: TODOS,
    datosPago:
      'Banco: BBVA México\nBeneficiario: Asociación de Colonos Residencial Los Encinos, A.C.\nCLABE: 012 680 01234567891 2\nReferencia: tu número de casa (ej. C14)\nEnvía tu comprobante desde Finanzas › Registrar pago.',
    telefonoCaseta: '442 215 3380',
    unidades: Array.from({ length: 30 }, (_, i) => ({ etiqueta: `Casa ${i + 1}`, cuota: i >= 24 ? 1650 : 1450 })),
  },
  {
    id: 'demo-alameda',
    nombre: 'Torre Alameda',
    tipo: 'Condominio vertical (edificio)',
    direccion: 'Calz. de los Arcos 85, Centro Histórico, 76000 Querétaro, Qro.',
    modulos: TODOS.filter((m) => m !== 'mascotas'), // la torre no tiene autorizado Mascota segura
    datosPago:
      'Banco: Banorte\nBeneficiario: Condominio Torre Alameda\nCLABE: 072 680 00987654321 0\nReferencia: número de departamento (ej. 302)',
    telefonoCaseta: '442 690 1127',
    unidades: [1, 2, 3, 4].flatMap((piso) => [1, 2, 3, 4, 5].map((n) => ({ etiqueta: `Depto ${piso}0${n}`, cuota: n === 5 ? 2400 : 2100 }))),
  },
];

// ---------- creación ----------
async function crear(T, password) {
  const reg = {}; // modelo → items
  const add = (m, it) => (reg[m] ??= []).push(it);
  const P0 = hoy.slice(0, 7);
  const periodos = [addMonths(P0, -2), addMonths(P0, -1), P0];
  const mesNombre = (p) => new Date(`${p}-15T12:00:00Z`).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });

  // Condominios y unidades
  const unidades = [];
  for (const c of CONDOS) {
    for (const u of c.unidades) {
      const un = { id: randomUUID(), condominioId: c.id, etiqueta: u.etiqueta, cuota: u.cuota, createdAt: at(addDays(hoy, -120), 10) };
      unidades.push(un);
    }
  }

  // Personas (50 residentes)
  const usados = new Set();
  const persona = () => {
    let n;
    do n = `${pick(NOMBRES)} ${pick(APELLIDOS)} ${pick(APELLIDOS)}`;
    while (usados.has(n));
    usados.add(n);
    const [nom, ap] = n.split(' ').filter((x, i, arr) => i === 0 || i === arr.length - 2);
    let email = sinAcentos(`${nom}.${ap}`).toLowerCase().replace(/[^a-z.]/g, '') + `@${DOMINIO}`;
    while ([...usados].includes(email)) email = email.replace('@', `${int(1, 9)}@`);
    usados.add(email);
    return { nombre: n, email, telefono: `${pick(['442', '446'])} ${int(100, 999)} ${pad(int(0, 9999), 4)}` };
  };
  const ocupadas = shuffle(unidades).slice(0, 45); // 45 unidades con residente registrado; 5 sin registrar
  const residentes = [];
  ocupadas.forEach((u, i) => residentes.push({ ...persona(), unidad: u, estado: i === 44 ? 'SUSPENDIDO' : 'APROBADO' }));
  // 2 familiares adicionales en unidades ya ocupadas
  for (const u of shuffle(ocupadas.slice(0, 40)).slice(0, 2)) residentes.push({ ...persona(), unidad: u, estado: 'APROBADO' });
  // 3 residentes que la administración ya dio de alta y recibieron sus accesos, pero aún no entran
  const libres = unidades.filter((u) => !ocupadas.includes(u));
  for (const u of libres.slice(0, 3)) residentes.push({ ...persona(), unidad: u, estado: 'APROBADO', invitado: true });
  const vigilantes = [
    { nombre: 'Martín Olvera Trejo', email: `vigilante.encinos@${DOMINIO}`, telefono: '442 118 4402', condominioId: 'demo-encinos' },
    { nombre: 'Rosa Hernández Ugalde', email: `vigilante.alameda@${DOMINIO}`, telefono: '442 330 7815', condominioId: 'demo-alameda' },
  ];
  const condoDe = (u) => CONDOS.find((c) => c.id === u.condominioId);

  console.log(`▶ Cuentas de Cognito (${residentes.length} residentes + ${vigilantes.length} vigilantes)`);
  for (const r of [...residentes, ...vigilantes]) {
    r.sub = await crearUsuario(r.email, r.nombre, password, !!r.invitado);
    const grupo = r.condominioId ? 'VIGILANTE' : ['APROBADO', 'SUSPENDIDO'].includes(r.estado) ? 'RESIDENTE' : null;
    if (grupo) await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: POOL, Username: r.sub, GroupName: grupo }));
    if (r.estado === 'SUSPENDIDO') await cognito.send(new AdminDisableUserCommand({ UserPoolId: POOL, Username: r.sub }));
    process.stdout.write('.');
  }
  process.stdout.write('\n');
  for (const r of residentes) {
    const u = r.unidad ?? r.solicita;
    add('Perfil', {
      userId: r.sub,
      email: r.email,
      nombre: r.nombre,
      telefono: r.telefono,
      rol: 'RESIDENTE',
      estado: r.estado,
      condominioId: u.condominioId,
      unidadId: r.unidad?.id,
      unidadSolicitada: r.solicita ? pick([u.etiqueta.toLowerCase(), u.etiqueta, u.etiqueta.replace('Depto ', 'Depto. ')]) : u.etiqueta,
      nota: r.nota,
      createdAt: r.invitado ? ahoraMenos(int(60, 2880)) : at(addDays(hoy, -int(20, 110)), int(8, 21), int(0, 59)),
    });
  }
  for (const v of vigilantes)
    add('Perfil', { userId: v.sub, email: v.email, nombre: v.nombre, telefono: v.telefono, rol: 'VIGILANTE', estado: 'APROBADO', condominioId: v.condominioId, createdAt: at(addDays(hoy, -100), 9) });

  // Propietario en la unidad = residente principal
  for (const u of unidades) {
    const r = residentes.find((x) => x.unidad === u);
    u.propietario = r?.nombre ?? `${pick(NOMBRES)} ${pick(APELLIDOS)} ${pick(APELLIDOS)}`;
    if (!r) u.notas = 'Propietario sin cuenta en el portal.';
  }
  const principal = (u) => residentes.find((r) => r.unidad === u && r.estado === 'APROBADO' && !r.invitado);

  console.log('▶ Carpetas privadas de los residentes (Cognito Identity)');
  const conArchivos = residentes.filter((r) => r.estado === 'APROBADO' && !r.invitado);
  const idents = await identityIds(conArchivos, password);
  const carpeta = (r) => `residentes/${idents[r.sub]}`;

  // ---------- Finanzas ----------
  console.log('▶ Finanzas');
  const folio = { 'demo-encinos': 0, 'demo-alameda': 0 };
  const archivos = [];
  const BANCOS = ['BBVA', 'Santander', 'Banorte', 'HSBC', 'Scotiabank', 'Banamex', 'BanCoppel', 'Nu México'];
  for (const u of unidades) {
    const c = condoDe(u);
    const r = principal(u);
    const perfil = r ? pick(['puntual', 'puntual', 'puntual', 'puntual', 'puntual', 'puntual', 'atrasado', 'atrasado', 'moroso']) : pick(['puntual', 'moroso']);
    const cargos = periodos.map((p) => ({
      id: `${u.id}#${p}#cuota`,
      condominioId: c.id,
      unidadId: u.id,
      concepto: `Cuota de mantenimiento ${mesNombre(p)}`,
      periodo: p,
      monto: u.cuota,
      vence: `${p}-10`,
      estado: 'PENDIENTE',
      createdAt: at(`${p}-01`, 7),
    }));
    if (c.id === 'demo-alameda')
      cargos.push({ id: randomUUID(), condominioId: c.id, unidadId: u.id, concepto: 'Cuota extraordinaria – impermeabilización de azotea', periodo: periodos[1], monto: 3500, vence: `${periodos[1]}-25`, estado: 'PENDIENTE', createdAt: at(`${periodos[1]}-05`, 9) });
    if (c.id === 'demo-encinos' && chance(0.12))
      cargos.push({ id: randomUUID(), condominioId: c.id, unidadId: u.id, concepto: pick(['Multa por estacionarse en área común', 'Multa por ruido después de las 23:00', 'Reposición de tarjeta de acceso']), periodo: periodos[1], monto: pick([250, 500, 500]), vence: `${periodos[2]}-05`, estado: 'PENDIENTE', createdAt: at(`${periodos[1]}-20`, 11) });

    // Cuáles se pagan según el perfil
    const pagar = cargos.filter((cg, i) => {
      if (perfil === 'puntual') return true;
      if (perfil === 'atrasado') return cg.periodo !== P0 && !(cg.concepto.startsWith('Multa') && chance(0.5));
      return cg.periodo === periodos[0] && chance(0.5);
    });
    // Agrupar: a veces un pago cubre dos cargos
    const grupos = [];
    for (const cg of pagar) {
      const ultimo = grupos[grupos.length - 1];
      if (ultimo && ultimo.length === 1 && chance(0.2)) ultimo.push(cg);
      else grupos.push([cg]);
    }
    for (const g of grupos) {
      const monto = g.reduce((s, x) => s + x.monto, 0);
      const base = g[g.length - 1];
      const esActual = base.periodo === P0;
      const fecha = esActual ? addDays(hoy, -int(0, Math.min(20, Number(hoy.slice(8)) - 1))) : addDays(base.vence, -int(0, 12));
      let estado = 'VALIDADO';
      if (esActual && r && chance(0.35)) estado = 'EN_REVISION';
      if (r && chance(0.04)) estado = 'RECHAZADO';
      const ref = `${pick(['SPEI', 'Transferencia', 'Depósito'])} ${int(1000000, 9999999)}`;
      let comprobantePath;
      if (r) {
        comprobantePath = `${carpeta(r)}/comprobantes/demo-${Date.now()}-${int(100, 999)}.pdf`;
        const banco = pick(BANCOS);
        archivos.push([
          comprobantePath,
          pdf([
            `${banco} · Comprobante de transferencia`,
            `Fecha de operación: ${fecha}`,
            `Clave de rastreo: ${ref.split(' ')[1]}${int(100000, 999999)}`,
            `Cuenta origen: **** ${int(1000, 9999)} (${r.nombre})`,
            `Beneficiario: ${c.datosPago.split('\n')[1].replace('Beneficiario: ', '')}`,
            `CLABE destino: ${c.datosPago.split('\n')[2].replace('CLABE: ', '')}`,
            `Concepto: ${u.etiqueta.replace('Casa ', 'C').replace('Depto ', '')} ${g.map((x) => x.periodo).join(' ')}`,
            `Importe: $${monto.toLocaleString('en-US', { minimumFractionDigits: 2 })} MXN`,
            'Estado: LIQUIDADA',
            '(Documento de ejemplo generado para demostración)',
          ]),
          'application/pdf',
        ]);
      }
      const pago = {
        id: randomUUID(),
        condominioId: c.id,
        unidadId: u.id,
        userId: r?.sub,
        monto: estado === 'RECHAZADO' ? monto - pick([200, 450, 725]) : monto,
        fecha,
        referencia: r ? ref : 'Depósito en ventanilla (registrado por administración)',
        comprobantePath,
        cargoIds: g.map((x) => x.id),
        estado,
        createdAt: at(fecha, int(8, 22), int(0, 59)),
      };
      if (estado !== 'EN_REVISION') {
        const vfecha = addDays(fecha, int(0, 2)) > hoy ? hoy : addDays(fecha, int(0, 2));
        pago.validadoEn = at(vfecha, int(9, 18), int(0, 59));
        pago.validadoPor = ADMIN_EMAIL;
      }
      if (estado === 'VALIDADO') {
        folio[c.id]++;
        pago.folio = `R-${pad(folio[c.id], 5)}`;
        g.forEach((x) => (x.estado = 'PAGADO'));
        if (r) add('Aviso', { id: randomUUID(), condominioId: c.id, unidadId: u.id, tipo: 'PAGO', titulo: `Tu pago fue aprobado · recibo ${pago.folio}`, texto: `Aprobamos tu pago por ${mxn(pago.monto)}. Ya puedes descargar tu recibo en Finanzas.`, leido: !esActual || chance(0.4), createdAt: pago.validadoEn });
      }
      if (estado === 'RECHAZADO') {
        pago.nota = 'El monto del comprobante no coincide con los cargos seleccionados. Por favor verifica y vuelve a enviarlo.';
        add('Aviso', { id: randomUUID(), condominioId: c.id, unidadId: u.id, tipo: 'PAGO', titulo: 'Tu pago no fue aprobado', texto: pago.nota, leido: false, createdAt: pago.validadoEn });
      }
      if (r)
        add('Aviso', { id: randomUUID(), condominioId: c.id, unidadId: u.id, tipo: 'PAGO', titulo: 'Comprobante de pago recibido', texto: `Recibimos tu comprobante por ${mxn(pago.monto)}. La administración lo revisará y te avisaremos cuando tu pago sea aprobado.`, leido: estado !== 'EN_REVISION' || chance(0.3), createdAt: pago.createdAt });
      add('Pago', pago);
    }
    cargos.forEach((x) => add('Cargo', x));
  }
  for (const u of unidades) add('Unidad', u);
  for (const c of CONDOS) {
    const { unidades: _, ...rest } = c;
    add('Condominio', { ...rest, activo: true, folioSeq: folio[c.id], createdAt: at(addDays(hoy, -130), 10) });
  }

  // ---------- Comunicados ----------
  console.log('▶ Comunicados, encuestas y chat');
  const comunicados = {
    'demo-encinos': [
      [-40, false, 'Bienvenidos al portal de residentes', 'A partir de hoy puedes consultar tu estado de cuenta, generar pases QR para tus visitas, reservar amenidades y reportar incidentes desde el portal.\n\nSi aún no recibes tus accesos por correo, solicítalos a la administración.'],
      [-25, true, 'Corte de agua programado', `El próximo ${addDays(hoy, -22)} se suspenderá el suministro de agua de 9:00 a 14:00 h por mantenimiento de la bomba hidroneumática.\n\nTe recomendamos almacenar agua con anticipación.`],
      [-14, false, 'Programa Mascota Segura', 'Registra a tus mascotas en el portal con foto y fecha de vacunación antirrábica. En caso de extravío, podrás reportarlas y la caseta y tus vecinos recibirán el aviso.\n\nRecuerda recoger las heces de tu mascota en áreas comunes; la multa es de $500.'],
      [-6, false, 'Fumigación de áreas comunes', `Se fumigarán jardines y andadores el ${addDays(hoy, 4)} a partir de las 8:00 h. Mantén a tus mascotas dentro de casa durante el día.`],
      [-2, true, 'Concurso de altares de Día de Muertos', 'Te invitamos a participar en el concurso de altares el 1 de noviembre en el salón de eventos. Inscríbete con la administración antes del 25 de octubre.\n\n¡Habrá premios para los tres primeros lugares y pan de muerto para todos!'],
    ],
    'demo-alameda': [
      [-35, false, 'Uso del elevador de servicio para mudanzas', 'Las mudanzas deben agendarse con 48 h de anticipación y realizarse exclusivamente en el elevador de servicio, de lunes a sábado de 9:00 a 18:00 h.'],
      [-20, true, 'Impermeabilización de azotea: calendario de trabajo', `Los trabajos iniciarán el ${addDays(hoy, -10)} y durarán aproximadamente tres semanas. El roof garden permanecerá cerrado durante ese periodo.\n\nLa cuota extraordinaria aprobada en asamblea es de $3,500 por departamento.`],
      [-11, false, 'Simulacro nacional', 'Gracias por su participación en el simulacro. El tiempo de evacuación de la torre fue de 3 min 40 s. Recuerden que el punto de reunión es la plaza frente al acceso principal.'],
      [-3, true, 'Convocatoria: asamblea ordinaria de condóminos', `Primera convocatoria: ${addDays(hoy, 12)} a las 19:00 h en la sala de juntas. Orden del día: informe financiero del trimestre, avance de impermeabilización y elección de comité de vigilancia.`],
    ],
  };
  for (const [cid, lista] of Object.entries(comunicados)) {
    for (const [d, importante, titulo, cuerpo] of lista)
      add('Comunicado', { id: randomUUID(), condominioId: cid, titulo, cuerpo, importante, autor: ADMIN_EMAIL, createdAt: at(addDays(hoy, d), int(9, 13), int(0, 59)) });
    const [d, , titulo, cuerpo] = lista[lista.length - 1];
    for (const u of unidades.filter((x) => x.condominioId === cid && principal(x)))
      add('Aviso', { id: randomUUID(), condominioId: cid, unidadId: u.id, tipo: 'COMUNICADO', titulo: `Nuevo comunicado: ${titulo}`, texto: cuerpo.slice(0, 200), leido: chance(0.5), createdAt: at(addDays(hoy, d), 13) });
  }

  // ---------- Encuestas y votos ----------
  const encuestas = [
    ['demo-encinos', '¿Aprobamos instalar paneles solares para el alumbrado de áreas comunes?', 'Costo estimado: $185,000 financiado con el fondo de reserva. Ahorro proyectado de 60 % en el recibo de luz de áreas comunes.', ['Sí', 'No', 'Abstención'], addDays(hoy, 10), 'ABIERTA', [0.62, 0.28, 0.1], 0.6],
    ['demo-encinos', 'Horario de la alberca en fin de semana', null, ['8:00 – 20:00', '9:00 – 21:00', '10:00 – 22:00'], addDays(hoy, -12), 'CERRADA', [0.25, 0.55, 0.2], 0.75],
    ['demo-alameda', 'Empresa para la impermeabilización de azotea', 'Se presentaron tres cotizaciones revisadas por el comité de vigilancia.', ['Impermeabilizantes del Bajío – $68,000', 'Techos QRO – $72,500', 'Sellatec – $65,900'], addDays(hoy, -28), 'CERRADA', [0.3, 0.15, 0.55], 0.85],
    ['demo-alameda', '¿Contratamos vigilancia 24 horas?', 'Incremento estimado de la cuota: $380 mensuales por departamento.', ['Sí', 'No'], addDays(hoy, 7), 'ABIERTA', [0.45, 0.55], 0.5],
  ];
  for (const [cid, pregunta, descripcion, opciones, cierra, estado, pesos, participacion] of encuestas) {
    const e = { id: randomUUID(), condominioId: cid, pregunta, descripcion, opciones, cierra, estado, createdAt: at(addDays(cierra, -14), 10) };
    add('Encuesta', e);
    for (const u of unidades.filter((x) => x.condominioId === cid && principal(x))) {
      if (!chance(participacion)) continue;
      let x = rnd();
      const opcion = opciones[pesos.findIndex((p) => (x -= p) < 0)] ?? opciones[0];
      add('Voto', { id: `${e.id}#${u.id}`, encuestaId: e.id, condominioId: cid, unidadId: u.id, opcion, userId: principal(u).sub, createdAt: at(addDays(e.createdAt.slice(0, 10), int(0, 8)), int(8, 22)) });
    }
  }

  // ---------- Chat ----------
  const conversaciones = {
    ADMIN: [
      [['R', 'Buenas tardes, ¿me pueden confirmar si ya se registró mi pago de este mes?'], ['A', 'Hola, sí: tu comprobante está en revisión y lo validamos hoy mismo. Recibirás el recibo en Finanzas.'], ['R', '¡Muchas gracias!']],
      [['R', 'Hay una lámpara fundida frente a mi casa desde hace varios días.'], ['A', 'Gracias por avisar. Ya lo registramos como incidente y el electricista viene el jueves.']],
      [['R', '¿Puedo pagar dos meses por adelantado?'], ['A', 'Claro, realiza la transferencia por el total y en la referencia indica los meses. Nosotros aplicamos el pago.']],
      [['R', 'Quisiera solicitar una copia del reglamento interno.'], ['A', 'Con gusto, te lo enviamos por correo. También estará disponible en comunicados la próxima semana.'], ['R', 'Perfecto, gracias.']],
      [['R', 'El vecino de al lado hace fiestas hasta muy tarde los viernes.'], ['A', 'Lamentamos la molestia. Enviaremos un recordatorio del horario de silencio (23:00 h) y, si continúa, aplicaremos el reglamento.']],
      [['R', '¿Cuándo es la próxima asamblea?']],
    ],
    CASETA: [
      [['R', 'Voy a recibir un paquete de Amazon, ¿me lo pueden guardar en caseta?'], ['V', 'Claro, aquí lo resguardamos. Le avisamos cuando llegue.'], ['V', 'Ya llegó su paquete, puede pasar por él.']],
      [['R', 'En 20 minutos llega mi mamá, se llama Carmen, no traje su pase.'], ['V', 'Enterado, la registramos al llegar.']],
      [['V', 'Buenas noches, su auto tiene las luces encendidas en el estacionamiento de visitas.'], ['R', '¡Gracias! Ya bajo.']],
      [['R', '¿Ya pasó el camión de la basura?'], ['V', 'Todavía no, normalmente pasa a las 10:30.']],
    ],
  };
  const chatUnidades = shuffle(unidades.filter(principal));
  let ci = 0;
  for (const canal of ['ADMIN', 'CASETA']) {
    for (const conv of conversaciones[canal]) {
      const u = chatUnidades[ci++];
      const r = principal(u);
      const c = condoDe(u);
      const vig = vigilantes.find((v) => v.condominioId === c.id);
      let t = Date.now() - int(1, 9) * 86400000 - int(0, 600) * 60000;
      if (conv === conversaciones[canal][0]) t = Date.now() - int(30, 240) * 60000;
      for (const [quien, texto] of conv) {
        t += int(3, 90) * 60000;
        const autor =
          quien === 'R'
            ? { autorId: r.sub, autorNombre: `${r.nombre} · ${u.etiqueta}`, autorRol: 'RESIDENTE' }
            : quien === 'A'
              ? { autorId: ADMIN_EMAIL, autorNombre: 'Administración SIIA', autorRol: 'ADMIN' }
              : { autorId: vig.sub, autorNombre: `Caseta · ${vig.nombre}`, autorRol: 'VIGILANTE' };
        add('Mensaje', { id: randomUUID(), condominioId: c.id, unidadId: u.id, canal, hilo: `${c.id}#${u.id}#${canal}`, ...autor, texto, createdAt: new Date(Math.min(t, Date.now() - 60000)).toISOString() });
      }
    }
  }

  // ---------- Incidentes ----------
  console.log('▶ Incidentes, mantenimientos, amenidades y reservas');
  const INCIDENTES = [
    ['Alumbrado', 'Lámpara fundida en andador', 'La lámpara del andador norte no enciende desde el fin de semana; está muy oscuro en la noche.', 'Andador norte, frente a casa 8'],
    ['Agua / fugas', 'Fuga de agua en jardín central', 'Sale agua de un registro del sistema de riego, se está formando un charco.', 'Jardín central'],
    ['Accesos / portones', 'Portón vehicular se queda abierto', 'El portón de salida tarda mucho en cerrar y a veces se queda abierto.', 'Acceso principal'],
    ['Áreas verdes', 'Árbol con ramas caídas', 'Después de la lluvia cayeron ramas grandes sobre la banqueta.', 'Calle Roble'],
    ['Limpieza', 'Contenedor de basura desbordado', 'El contenedor del área de basura está lleno desde el martes.', 'Área de contenedores'],
    ['Ruido / convivencia', 'Perro ladra toda la noche', 'Un perro de la privada ladra de 1 a 4 a.m. casi todos los días.', 'Privada 3'],
    ['Alberca', 'Agua turbia en alberca', 'El agua de la alberca se ve verde desde hace dos días.', 'Alberca'],
    ['Seguridad', 'Persona sospechosa en acceso peatonal', 'Una persona intentó entrar detrás de un residente sin identificarse.', 'Acceso peatonal'],
    ['Alumbrado', 'Luminaria de estacionamiento parpadea', 'La luminaria parpadea constantemente y hace ruido.', 'Estacionamiento de visitas'],
    ['Otro', 'Bache en la entrada', 'Hay un bache profundo a la entrada que puede dañar los autos.', 'Calle principal'],
  ];
  const INC_TORRE = [
    ['Accesos / portones', 'Elevador 2 se detiene entre pisos', 'El elevador 2 se detuvo entre el piso 2 y 3 por unos segundos.', 'Elevador 2'],
    ['Agua / fugas', 'Filtración en techo del pasillo', 'Hay una mancha de humedad en el techo del pasillo del piso 4.', 'Pasillo piso 4'],
    ['Limpieza', 'Ducto de basura con mal olor', 'El ducto de basura del piso 3 huele muy mal.', 'Piso 3'],
    ['Seguridad', 'Cámara del lobby apagada', 'La cámara del lobby no tiene luz indicadora.', 'Lobby'],
    ['Alumbrado', 'Focos fundidos en escaleras', 'Varias lámparas de la escalera de emergencia no encienden.', 'Escalera de emergencia'],
    ['Ruido / convivencia', 'Remodelación en horario no permitido', 'Están taladrando un domingo a las 8 a.m.', 'Piso 2'],
  ];
  const RESPUESTAS = {
    EN_PROCESO: ['Ya lo revisó el proveedor; esperamos la refacción esta semana.', 'Programamos la reparación para el jueves por la mañana.', 'Estamos en contacto con el residente involucrado.'],
    RESUELTO: ['Se reparó el día de hoy. Gracias por reportarlo.', 'El proveedor realizó el cambio de pieza y quedó funcionando.', 'Se habló con el residente y se aplicó el reglamento.'],
    CERRADO: ['Atendido y cerrado. Si vuelve a presentarse, repórtalo de nuevo.'],
  };
  const colores = [[0, 124, 125], [56, 203, 185], [75, 82, 111], [194, 65, 59], [230, 160, 40], [90, 140, 70]];
  for (const [cid, lista] of [['demo-encinos', INCIDENTES], ['demo-alameda', INC_TORRE]]) {
    for (const [categoria, titulo, descripcion, ubicacion] of lista) {
      const u = pick(unidades.filter((x) => x.condominioId === cid && principal(x)));
      const r = principal(u);
      const estado = pick(['ABIERTO', 'ABIERTO', 'EN_PROCESO', 'EN_PROCESO', 'RESUELTO', 'RESUELTO', 'CERRADO']);
      const creado = at(addDays(hoy, estado === 'ABIERTO' ? -int(0, 3) : -int(4, 40)), int(7, 22), int(0, 59));
      let fotoPath;
      if (chance(0.6)) {
        fotoPath = `${carpeta(r)}/incidentes/demo-${Date.now()}-${int(100, 999)}.png`;
        archivos.push([fotoPath, png(pick(colores), pick(colores), 'rect'), 'image/png']);
      }
      const respuesta = RESPUESTAS[estado] ? pick(RESPUESTAS[estado]) : undefined;
      add('Incidente', { id: randomUUID(), condominioId: cid, unidadId: u.id, userId: r.sub, categoria, titulo, descripcion, ubicacion, fotoPath, estado, respuesta, createdAt: creado, updatedAt: respuesta ? at(addDays(creado.slice(0, 10), 1), 12) : creado });
      if (respuesta) add('Aviso', { id: randomUUID(), condominioId: cid, unidadId: u.id, tipo: 'INCIDENTE', titulo: `Tu reporte "${titulo}" está ${estado === 'EN_PROCESO' ? 'en proceso' : estado.toLowerCase()}`, texto: respuesta, leido: chance(0.5), createdAt: at(addDays(creado.slice(0, 10), 1), 12) });
    }
  }

  // ---------- Mantenimientos ----------
  const MANT = {
    'demo-encinos': [
      ['Limpieza y cloración de alberca', 'PREVENTIVO', 'Alberca', -14, 'TERMINADO', 'Albercas Cristal'],
      ['Limpieza y cloración de alberca', 'PREVENTIVO', 'Alberca', -7, 'TERMINADO', 'Albercas Cristal'],
      ['Limpieza y cloración de alberca', 'PREVENTIVO', 'Alberca', 0, 'EN_PROCESO', 'Albercas Cristal'],
      ['Limpieza y cloración de alberca', 'PREVENTIVO', 'Alberca', 7, 'PROGRAMADO', 'Albercas Cristal'],
      ['Mantenimiento de bomba hidroneumática', 'PREVENTIVO', 'Cuarto de máquinas', -22, 'TERMINADO', 'Hidrosistemas del Centro'],
      ['Reparación de motor del portón vehicular', 'CORRECTIVO', 'Acceso principal', -9, 'TERMINADO', 'Automatización Querétaro'],
      ['Poda de árboles y áreas verdes', 'PREVENTIVO', 'Jardines y andadores', 3, 'PROGRAMADO', 'Jardinería Hermanos Reséndiz'],
      ['Fumigación de áreas comunes', 'PREVENTIVO', 'Jardines y andadores', 4, 'PROGRAMADO', 'Control de Plagas Bajío'],
      ['Pintura de guarniciones y señalización', 'PREVENTIVO', 'Calles internas', -2, 'EN_PROCESO', 'Pinturas y Acabados Rangel'],
      ['Reparación de fuga en riego', 'CORRECTIVO', 'Jardín central', 1, 'PROGRAMADO', 'Plomería Rápida QRO'],
    ],
    'demo-alameda': [
      ['Mantenimiento mensual de elevadores', 'PREVENTIVO', 'Elevadores 1 y 2', -18, 'TERMINADO', 'Schindler México'],
      ['Mantenimiento mensual de elevadores', 'PREVENTIVO', 'Elevadores 1 y 2', 12, 'PROGRAMADO', 'Schindler México'],
      ['Impermeabilización de azotea', 'CORRECTIVO', 'Azotea y roof garden', -10, 'EN_PROCESO', 'Sellatec'],
      ['Lavado y desinfección de cisterna', 'PREVENTIVO', 'Cisterna', 9, 'PROGRAMADO', 'Hidrosistemas del Centro'],
      ['Recarga y revisión de extintores', 'PREVENTIVO', 'Todos los pisos', -30, 'TERMINADO', 'Protección Civil Integral'],
      ['Cambio de luminarias LED en escaleras', 'CORRECTIVO', 'Escalera de emergencia', 2, 'PROGRAMADO', 'Eléctrica Arteaga'],
    ],
  };
  for (const [cid, lista] of Object.entries(MANT))
    for (const [titulo, tipo, area, d, estado, proveedor] of lista)
      add('Mantenimiento', { id: randomUUID(), condominioId: cid, titulo, tipo, area, fecha: addDays(hoy, d), estado, proveedor, notas: estado === 'PROGRAMADO' ? 'Se solicita no utilizar el área durante los trabajos.' : undefined, createdAt: at(addDays(hoy, d - 10), 10) });

  // ---------- Amenidades y reservas ----------
  const AMEN = {
    'demo-encinos': [
      ['Salón de eventos', 'Salón con cocineta, 10 mesas y 80 sillas.', '10:00', '23:00', 6, 80, 800, true, 'Depósito en garantía de $1,000. Música hasta las 23:00 h. Entregar limpio al terminar.'],
      ['Asadores', 'Zona de asadores junto al jardín central.', '10:00', '21:00', 4, 20, 0, false, 'Traer carbón propio. Apagar completamente al terminar.'],
      ['Alberca', 'Alberca climatizada.', '08:00', '20:00', 3, 30, 0, false, 'Uso de traje de baño obligatorio. Menores acompañados de un adulto.'],
      ['Cancha de pádel', 'Cancha con iluminación nocturna.', '07:00', '22:00', 2, 4, 0, false, 'Calzado deportivo obligatorio.'],
    ],
    'demo-alameda': [
      ['Roof garden', 'Terraza en azotea con vista a los Arcos.', '12:00', '22:00', 5, 40, 500, true, 'Cerrado temporalmente durante la impermeabilización.'],
      ['Gimnasio', 'Caminadoras, bicicletas y peso libre.', '06:00', '22:00', 2, 8, 0, false, 'Limpiar el equipo después de usarlo.'],
      ['Sala de juntas', 'Sala para 10 personas con pantalla.', '08:00', '20:00', 3, 10, 0, false, null],
    ],
  };
  for (const [cid, lista] of Object.entries(AMEN)) {
    for (const [nombre, descripcion, horaApertura, horaCierre, maxHoras, capacidad, costo, requiereAprobacion, reglas] of lista) {
      const am = { id: randomUUID(), condominioId: cid, nombre, descripcion, horaApertura, horaCierre, maxHoras, capacidad, costo: costo || undefined, requiereAprobacion, activa: !(nombre === 'Roof garden'), reglas, createdAt: at(addDays(hoy, -100), 10) };
      add('Amenidad', am);
      const ocupado = {};
      const n = nombre === 'Roof garden' ? 2 : int(3, 5);
      for (let i = 0; i < n; i++) {
        const d = int(-20, 21);
        const fecha = addDays(hoy, d);
        const dur = int(1, maxHoras);
        const ini = int(Number(horaApertura.slice(0, 2)), Number(horaCierre.slice(0, 2)) - dur);
        const clave = `${fecha}`;
        if ((ocupado[clave] ?? []).some(([a, b]) => ini < b && a < ini + dur)) continue;
        (ocupado[clave] ??= []).push([ini, ini + dur]);
        const u = pick(unidades.filter((x) => x.condominioId === cid && principal(x)));
        let estado = requiereAprobacion ? (d < 0 ? 'APROBADA' : pick(['SOLICITADA', 'SOLICITADA', 'APROBADA', 'RECHAZADA'])) : 'APROBADA';
        if (d > 0 && chance(0.1)) estado = 'CANCELADA';
        const nota = estado === 'RECHAZADA' ? 'Ya existe un evento del condominio en esa fecha.' : pick([undefined, undefined, 'Cumpleaños de mi hija', 'Reunión familiar', 'Partido con amigos']);
        const creado = at(addDays(fecha, -int(2, 12)), int(8, 21));
        add('Reserva', { id: randomUUID(), condominioId: cid, amenidadId: am.id, unidadId: u.id, userId: principal(u).sub, fecha, horaInicio: `${pad(ini)}:00`, horaFin: `${pad(ini + dur)}:00`, invitados: int(0, Math.min(capacidad, 40)), estado, nota, createdAt: creado > new Date().toISOString() ? ahoraMenos(120) : creado });
        if (requiereAprobacion && ['APROBADA', 'RECHAZADA'].includes(estado))
          add('Aviso', { id: randomUUID(), condominioId: cid, unidadId: u.id, tipo: 'RESERVA', titulo: `Tu reserva de ${nombre} (${fecha}) fue ${estado === 'APROBADA' ? 'aprobada' : 'rechazada'}`, texto: estado === 'RECHAZADA' ? nota : undefined, leido: d < 0, createdAt: ahoraMenos(int(60, 4000)) });
      }
    }
  }

  // ---------- Visitas y caseta ----------
  console.log('▶ Visitas, caseta y mascotas');
  for (const c of CONDOS) {
    const vig = vigilantes.find((v) => v.condominioId === c.id);
    const unis = unidades.filter((x) => x.condominioId === c.id && principal(x));
    const n = c.id === 'demo-encinos' ? 28 : 18;
    for (let i = 0; i < n; i++) {
      const u = pick(unis);
      const r = principal(u);
      const escenario = pick(['hoy_esperada', 'hoy_dentro', 'hoy_salio', 'pasada', 'pasada', 'pasada', 'futura', 'futura', 'cancelada', 'servicio', 'caseta_paquete', 'caseta_visita']);
      const [tipoS, nombreS] = pick(SERVICIOS.filter((s) => s[0] !== 'PAQUETERIA'));
      const base = { id: randomUUID(), condominioId: c.id, unidadId: u.id, userId: r.sub, tipo: 'VISITA', nombre: pick(VISITANTES), origen: 'RESIDENTE', placas: chance(0.5) ? `${pick(['UAB', 'UMX', 'SNR', 'TFK', 'RWD'])}-${int(100, 999)}-${pick(['A', 'B', 'C', 'D'])}` : undefined };
      let v;
      if (escenario === 'hoy_esperada') v = { ...base, fecha: hoy, estado: 'PROGRAMADA', codigo: codigo(), createdAt: ahoraMenos(int(30, 600)) };
      else if (escenario === 'hoy_dentro') v = { ...base, fecha: hoy, estado: 'DENTRO', codigo: codigo(), entradaEn: ahoraMenos(int(10, 180)), registradoPor: vig.nombre, createdAt: ahoraMenos(int(200, 900)) };
      else if (escenario === 'hoy_salio') {
        const ent = int(120, 500);
        v = { ...base, fecha: hoy, estado: 'SALIO', codigo: codigo(), entradaEn: ahoraMenos(ent), salidaEn: ahoraMenos(ent - int(30, 110)), registradoPor: vig.nombre, createdAt: ahoraMenos(ent + 60) };
      } else if (escenario === 'pasada') {
        const f = addDays(hoy, -int(1, 25));
        const h = int(10, 19);
        v = { ...base, fecha: f, estado: 'SALIO', codigo: codigo(), entradaEn: at(f, h, int(0, 59)), salidaEn: at(f, h + int(1, 3), int(0, 59)), registradoPor: vig.nombre, createdAt: at(addDays(f, -1), 20) };
      } else if (escenario === 'futura') v = { ...base, fecha: addDays(hoy, int(1, 12)), estado: 'PROGRAMADA', codigo: codigo(), notas: chance(0.4) ? 'Viene a la fiesta del sábado, favor de indicarle dónde estacionarse.' : undefined, createdAt: ahoraMenos(int(60, 3000)) };
      else if (escenario === 'cancelada') v = { ...base, fecha: addDays(hoy, int(-5, 5)), estado: 'CANCELADA', codigo: codigo(), createdAt: ahoraMenos(int(600, 6000)) };
      else if (escenario === 'servicio') {
        const ini = addDays(hoy, -int(5, 40));
        const dentro = chance(0.5);
        v = { ...base, tipo: tipoS, nombre: nombreS, fecha: ini, fechaFin: addDays(ini, int(45, 85)), estado: dentro ? 'DENTRO' : 'SALIO', codigo: codigo(), entradaEn: dentro ? ahoraMenos(int(30, 240)) : at(addDays(hoy, -1), 9), salidaEn: dentro ? undefined : at(addDays(hoy, -1), 15), registradoPor: vig.nombre, notas: 'Acceso de lunes a viernes.', createdAt: at(ini, 8) };
      } else if (escenario === 'caseta_paquete') {
        const [, emp] = pick(SERVICIOS.filter((s) => s[0] === 'PAQUETERIA'));
        const m = int(15, 2000);
        v = { ...base, userId: undefined, tipo: 'PAQUETERIA', nombre: emp, origen: 'CASETA', fecha: hoyMX(ahoraMenos(m)), estado: 'SALIO', entradaEn: ahoraMenos(m), salidaEn: ahoraMenos(m), registradoPor: vig.nombre, notas: pick(['Caja mediana, se resguarda en caseta.', 'Sobre, entregado en caseta.', 'Paquete frágil.']), createdAt: ahoraMenos(m) };
        add('Aviso', { id: randomUUID(), condominioId: c.id, unidadId: u.id, tipo: 'CASETA', titulo: `Tienes paquetería en caseta: ${emp}`, texto: v.notas, leido: m > 600, createdAt: v.createdAt });
      } else {
        const m = int(15, 300);
        v = { ...base, userId: undefined, origen: 'CASETA', fecha: hoy, estado: 'DENTRO', entradaEn: ahoraMenos(m), registradoPor: vig.nombre, notas: 'Llegó sin pase; el residente autorizó por teléfono.', createdAt: ahoraMenos(m) };
        add('Aviso', { id: randomUUID(), condominioId: c.id, unidadId: u.id, tipo: 'CASETA', titulo: `Llegó tu visita: ${v.nombre}`, texto: v.notas, leido: false, createdAt: v.createdAt });
      }
      if (v.origen === 'RESIDENTE' && v.entradaEn)
        add('Aviso', { id: randomUUID(), condominioId: c.id, unidadId: u.id, tipo: 'VISITA', titulo: `${v.tipo === 'VISITA' ? 'Tu visita' : 'Tu servicio'} ${v.nombre} ingresó`, texto: 'Registrado en caseta.', leido: v.estado !== 'DENTRO', createdAt: v.entradaEn });
      add('Visita', v);
    }
  }

  // ---------- Mascotas (solo Los Encinos tiene el servicio) ----------
  const MASCOTAS = [
    ['Firulais', 'Perro', 'Mestizo', 'Café con blanco'], ['Luna', 'Perro', 'Labrador', 'Dorado'], ['Michi', 'Gato', 'Doméstico', 'Atigrado gris'],
    ['Rocky', 'Perro', 'Schnauzer', 'Sal y pimienta'], ['Canela', 'Perro', 'Chihuahua', 'Canela'], ['Nieve', 'Gato', 'Persa', 'Blanco'],
    ['Max', 'Perro', 'Golden retriever', 'Dorado'], ['Kira', 'Perro', 'Pastor alemán', 'Negro y fuego'], ['Toby', 'Perro', 'French poodle', 'Blanco'],
    ['Pelusa', 'Gato', 'Siamés', 'Crema con puntas café'], ['Bruno', 'Perro', 'Bulldog francés', 'Atigrado'], ['Coco', 'Otro', 'Conejo', 'Gris'],
    ['Lola', 'Perro', 'Beagle', 'Tricolor'], ['Simba', 'Gato', 'Naranja doméstico', 'Naranja'],
  ];
  const conMascota = shuffle(unidades.filter((x) => x.condominioId === 'demo-encinos' && principal(x)));
  MASCOTAS.forEach(([nombre, especie, raza, color], i) => {
    const u = conMascota[i % conMascota.length];
    const r = principal(u);
    const estado = i < 10 ? 'APROBADA' : i < 13 ? 'PENDIENTE' : 'RECHAZADA';
    let fotoPath;
    if (i < 12) {
      fotoPath = `${carpeta(r)}/mascotas/demo-${Date.now()}-${i}.png`;
      archivos.push([fotoPath, png(pick(colores), pick(colores), 'circulo'), 'image/png']);
    }
    add('Mascota', { id: randomUUID(), condominioId: 'demo-encinos', unidadId: u.id, userId: r.sub, nombre, especie, raza, color, fotoPath, vacunaAntirrabica: estado === 'RECHAZADA' ? undefined : addDays(hoy, -int(20, 330)), estado, extraviada: i === 2, notas: estado === 'RECHAZADA' ? 'Falta la cartilla de vacunación vigente.' : i === 2 ? 'Tiene collar rojo con placa. Responde a su nombre.' : undefined, createdAt: at(addDays(hoy, -int(1, 60)), int(9, 20)) });
    if (i === 2) {
      for (const x of unidades.filter((y) => y.condominioId === 'demo-encinos' && principal(y) && y !== u))
        add('Aviso', { id: randomUUID(), condominioId: 'demo-encinos', unidadId: x.id, tipo: 'MASCOTA', titulo: `Mascota extraviada: ${nombre} (${raza}, ${color})`, texto: `Si la ves, avisa a caseta o a ${u.etiqueta}.`, leido: chance(0.3), createdAt: ahoraMenos(int(90, 400)) });
    }
  });

  // ---------- Escritura ----------
  console.log(`▶ Subiendo ${archivos.length} archivos a S3`);
  for (let i = 0; i < archivos.length; i += 10) await Promise.all(archivos.slice(i, i + 10).map(([k, b, t]) => subir(k, b, t)));
  console.log('▶ Escribiendo registros en DynamoDB');
  for (const [m, items] of Object.entries(reg)) {
    await escribir(T, m, items);
    console.log(`  ${m}: ${items.length}`);
  }
  return { residentes, vigilantes, unidades };
}

function hoyMX(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(iso));
}

// ---------- main ----------
const T = await tablas();
await limpiar(T);
if (process.argv.includes('--limpiar')) {
  console.log('✔ Demo eliminada');
  process.exit(0);
}
const password = process.env.DEMO_PASSWORD;
if (!password) throw new Error('Define DEMO_PASSWORD (contraseña común de las cuentas demo).');
const { residentes, vigilantes } = await crear(T, password);
console.log('\n✔ Demo creada. Cuentas de ejemplo (misma contraseña para todas):');
const muestra = [
  ...residentes.filter((r) => r.estado === 'APROBADO' && r.unidad.condominioId === 'demo-encinos').slice(0, 3),
  ...residentes.filter((r) => r.estado === 'APROBADO' && r.unidad.condominioId === 'demo-alameda').slice(0, 2),
  ...residentes.filter((r) => r.estado !== 'APROBADO' || r.invitado),
];
for (const r of muestra) console.log(`  ${r.email.padEnd(42)} ${(r.invitado ? 'INVITADO' : r.estado).padEnd(11)} ${r.unidad.etiqueta}`);
for (const v of vigilantes) console.log(`  ${v.email.padEnd(42)} VIGILANTE   ${v.condominioId}`);
