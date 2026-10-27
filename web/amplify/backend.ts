import { defineBackend } from '@aws-amplify/backend';
import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { FilterCriteria, FilterRule, StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { FunctionUrlAuthType, HttpMethod } from 'aws-cdk-lib/aws-lambda';
import { Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { adminApi } from './functions/admin-api/resource';
import { portalApi } from './functions/portal-api/resource';
import { notificador } from './functions/notificador/resource';
import { recargos } from './functions/recargos/resource';
import { reservasVencidas } from './functions/reservas-vencidas/resource';
import { papelera } from './functions/papelera/resource';
import { cotizaciones } from './functions/cotizaciones/resource';
import { AMBIENTE, CORREO_SES, ES_PRODUCCION, PORTAL_URL, REMITENTE, SITIO, VAPID_PUBLICA } from './ambiente';

const backend = defineBackend({ auth, data, storage, adminApi, portalApi, notificador, recargos, reservasVencidas, papelera, cotizaciones });

const { userPool } = backend.auth.resources;
const tables = backend.data.resources.tables;

// Las Lambdas usan DynamoDB directo; reciben los nombres de tabla como variables de entorno (TABLE_<Modelo>).
for (const fn of [backend.adminApi, backend.portalApi, backend.notificador, backend.recargos, backend.reservasVencidas, backend.papelera]) {
  const lambda = fn.resources.lambda;
  for (const [model, table] of Object.entries(tables)) {
    table.grantReadWriteData(lambda);
    fn.addEnvironment(`TABLE_${model}`, table.tableName);
  }
  // grantReadWriteData no incluye los índices secundarios (byCondominio, byUnidad, …)
  lambda.addToRolePolicy(
    new PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: Object.values(tables).map((t) => `${t.tableArn}/index/*`),
    }),
  );
}

// Formularios del sitio público (Cotizar y Contacto): URL pública sin sesión; solo escribe en Cotizacion.
const cotizacionesFn = backend.cotizaciones.resources.lambda;
tables.Cotizacion.grantWriteData(cotizacionesFn);
tables.Cotizacion.grant(cotizacionesFn, 'dynamodb:Scan');
backend.cotizaciones.addEnvironment('TABLE_Cotizacion', tables.Cotizacion.tableName);
const urlCotizaciones = cotizacionesFn.addFunctionUrl({
  authType: FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ES_PRODUCCION ? [SITIO, 'https://www.siia.casa'] : [SITIO, 'http://localhost:4321'],
    allowedMethods: [HttpMethod.POST],
    allowedHeaders: ['content-type'],
    maxAge: Duration.hours(1),
  },
});

// Los usuarios de un grupo de Cognito reciben el rol IAM de su grupo (no el rol autenticado genérico),
// así que la regla "cada residente su carpeta" de defineStorage no les aplica. Se replica aquí.
const bucket = backend.storage.resources.bucket;
const carpetaPropia = `${bucket.bucketArn}/residentes/\${cognito-identity.amazonaws.com:sub}/*`;
// La política vive en la pila de storage (auth no puede depender de storage: dependencia circular).
new Policy(Stack.of(bucket), 'GruposCarpetaPropia', {
  roles: ['RESIDENTE', 'VIGILANTE'].map((g) => backend.auth.resources.groups[g].role),
  statements: [
    // Sin s3:DeleteObject: un comprobante enviado no se puede borrar.
    new PolicyStatement({ actions: ['s3:GetObject', 's3:PutObject'], resources: [carpetaPropia] }),
    new PolicyStatement({
      actions: ['s3:ListBucket'],
      resources: [bucket.bucketArn],
      conditions: { StringLike: { 's3:prefix': ['residentes/${cognito-identity.amazonaws.com:sub}/', 'residentes/${cognito-identity.amazonaws.com:sub}/*'] } },
    }),
  ],
});

// portal-api firma URLs temporales de fotos de mascotas extraviadas (visibles para vecinos y caseta).
backend.storage.resources.bucket.grantRead(backend.portalApi.resources.lambda, 'residentes/*');
// … y el reglamento y los términos de uso de las amenidades que el residente acepta al reservar.
backend.storage.resources.bucket.grantRead(backend.portalApi.resources.lambda, 'condominios/*');
// Proveedores: URL firmada para subir las fotos de su bitácora de trabajo.
backend.storage.resources.bucket.grantPut(backend.portalApi.resources.lambda, 'condominios/*/proveedores/*');
backend.portalApi.addEnvironment('BUCKET', backend.storage.resources.bucket.bucketName);
// admin-api firma URLs de comprobantes y fotos solo para registros de los condominios del administrador.
backend.storage.resources.bucket.grantRead(backend.adminApi.resources.lambda, 'residentes/*');
backend.adminApi.addEnvironment('BUCKET', backend.storage.resources.bucket.bucketName);
// Documentos del condominio (reglamento y otros): admin-api firma la subida y la descarga.
backend.storage.resources.bucket.grantReadWrite(backend.adminApi.resources.lambda, 'condominios/*');

// portal-api solo lee el correo del usuario en Cognito (el access token no lo incluye).
backend.portalApi.addEnvironment('USER_POOL_ID', userPool.userPoolId);
backend.portalApi.resources.lambda.addToRolePolicy(
  new PolicyStatement({ actions: ['cognito-idp:AdminGetUser'], resources: [userPool.userPoolArn] }),
);

// Solo admin-api administra usuarios en Cognito (alta, grupos, suspensión).
backend.adminApi.addEnvironment('USER_POOL_ID', userPool.userPoolId);
backend.adminApi.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: [
      'cognito-idp:AdminCreateUser',
      'cognito-idp:AdminAddUserToGroup',
      'cognito-idp:AdminRemoveUserFromGroup',
      'cognito-idp:AdminListGroupsForUser',
      'cognito-idp:AdminDisableUser',
      'cognito-idp:AdminEnableUser',
      'cognito-idp:AdminDeleteUser',
      'cognito-idp:AdminGetUser',
      'cognito-idp:AdminUserGlobalSignOut',
      'cognito-idp:AdminSetUserPassword',
      'cognito-idp:AdminUpdateUserAttributes',
      'cognito-idp:ListUsers',
      'cognito-idp:ListUsersInGroup',
    ],
    resources: [userPool.userPoolArn],
  }),
);

// Papelera de condominios: admin-api la invoca (sin esperar) al eliminar, restaurar o borrar definitivamente.
// Desactiva, reactiva y borra cuentas de Cognito, y borra los archivos del condominio con sus versiones anteriores.
const papeleraFn = backend.papelera.resources.lambda;
papeleraFn.grantInvoke(backend.adminApi.resources.lambda);
backend.adminApi.addEnvironment('PAPELERA_FN', papeleraFn.functionName);
backend.papelera.addEnvironment('USER_POOL_ID', userPool.userPoolId);
backend.papelera.addEnvironment('BUCKET', bucket.bucketName);
papeleraFn.addToRolePolicy(
  new PolicyStatement({
    actions: ['cognito-idp:AdminDisableUser', 'cognito-idp:AdminEnableUser', 'cognito-idp:AdminDeleteUser', 'cognito-idp:AdminUserGlobalSignOut'],
    resources: [userPool.userPoolArn],
  }),
);
papeleraFn.addToRolePolicy(new PolicyStatement({ actions: ['s3:ListBucketVersions', 's3:ListBucket'], resources: [bucket.bucketArn] }));
papeleraFn.addToRolePolicy(
  new PolicyStatement({
    actions: ['s3:DeleteObject', 's3:DeleteObjectVersion'],
    resources: [`${bucket.bucketArn}/condominios/*`, `${bucket.bucketArn}/residentes/*`],
  }),
);

// Alta solo por la administración: se desactiva el registro libre (Cognito rechaza SignUp).
backend.auth.resources.cfnResources.cfnUserPool.addPropertyOverride('AdminCreateUserConfig.AllowAdminCreateUserOnly', true);

// Política de contraseñas: 8+ caracteres con mayúscula, minúscula, número y símbolo.
backend.auth.resources.cfnResources.cfnUserPool.policies = {
  passwordPolicy: {
    minimumLength: 8,
    requireLowercase: true,
    requireUppercase: true,
    requireNumbers: true,
    requireSymbols: true,
    temporaryPasswordValidityDays: 7,
  },
};

// ---------- conservación de datos ----------
// Archivos: después de 1 año pasan a almacenamiento de acceso poco frecuente (más barato, misma disponibilidad).
// No vencen nunca (soporte contable: mínimo 5 años). Las versiones anteriores o borradas se guardan 5 años.
backend.storage.resources.cfnResources.cfnBucket.lifecycleConfiguration = {
  rules: [
    {
      id: 'conservacion-archivos',
      status: 'Enabled',
      abortIncompleteMultipartUpload: { daysAfterInitiation: 7 },
      transitions: [{ storageClass: 'GLACIER_IR', transitionInDays: 365 }],
      noncurrentVersionTransitions: [{ storageClass: 'GLACIER_IR', transitionInDays: 30 }],
      noncurrentVersionExpiration: { noncurrentDays: 5 * 365 },
    },
  ],
};

// Tablas: respaldo continuo (recuperación a cualquier segundo de los últimos 35 días), protección contra borrado
// y se conservan aunque se elimine la pila.
for (const tabla of Object.values(backend.data.resources.cfnResources.amplifyDynamoDbTables)) {
  tabla.pointInTimeRecoveryEnabled = true;
  tabla.deletionProtectionEnabled = true;
  tabla.applyRemovalPolicy(RemovalPolicy.RETAIN);
}

// Cuentas de usuario: protección contra borrado del user pool.
backend.auth.resources.cfnResources.cfnUserPool.deletionProtection = 'ACTIVE';

// ---------- sesión ----------
// La sesión queda abierta hasta que el usuario la cierre: el token de actualización dura 10 años (máximo de Cognito).
// Suspender, rechazar o cambiar el rol de una cuenta sigue cerrando sus sesiones de inmediato.
backend.auth.resources.cfnResources.cfnUserPoolClient.refreshTokenValidity = 3650;
backend.auth.resources.cfnResources.cfnUserPoolClient.tokenValidityUnits = { refreshToken: 'days', accessToken: 'minutes', idToken: 'minutes' };
backend.auth.resources.cfnResources.cfnUserPoolClient.accessTokenValidity = 60;
backend.auth.resources.cfnResources.cfnUserPoolClient.idTokenValidity = 60;

// ---------- correo ----------
// Cuentas: con CORREO_SES, Cognito envía por SES con la identidad del dominio siia.casa (ver ambiente.ts).
// Amplify (senders.email) solo acepta la identidad del correo exacto, por eso se configura aquí sobre el dominio.
if (CORREO_SES) {
  backend.auth.resources.cfnResources.cfnUserPool.emailConfiguration = {
    emailSendingAccount: 'DEVELOPER',
    from: REMITENTE,
    sourceArn: Stack.of(userPool).formatArn({ service: 'ses', resource: 'identity', resourceName: 'siia.casa' }),
  };
}
// Correos con el diseño de SIIA (shared/correo.ts): pago vencido (recargos), contraseña, comunicados y mantenimientos
// importantes y corte de accesos (admin-api) y acuse de cotizaciones del sitio. '0' pausa los correos de esa función.
for (const fn of [backend.recargos, backend.adminApi, backend.cotizaciones]) {
  fn.addEnvironment('CORREOS_ACTIVOS', '1');
  fn.addEnvironment('PORTAL_URL', PORTAL_URL);
  fn.resources.lambda.addToRolePolicy(
    new PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: [`arn:aws:ses:${Stack.of(fn.resources.lambda).region}:${Stack.of(fn.resources.lambda).account}:identity/*`],
    }),
  );
}

// ---------- ambiente (staging o producción) ----------
// Cada ambiente tiene su llave pública VAPID y su dirección del portal (enlaces de correos y avisos).
for (const fn of [backend.adminApi, backend.portalApi, backend.notificador]) fn.addEnvironment('VAPID_PUBLIC_KEY', VAPID_PUBLICA);
// El sitio lee estos datos de amplify_outputs.json (y los scripts de prueba se niegan a correr en producción).
backend.addOutput({ custom: { ambiente: AMBIENTE, sitio: SITIO, vapidPublica: VAPID_PUBLICA, cotizacionesUrl: urlCotizaciones.url } });

// ---------- notificaciones push ----------
// El notificador escucha los registros nuevos de estas tablas (los streams ya existen en las tablas de Amplify).
for (const modelo of ['Aviso', 'Mensaje', 'Pago', 'Incidente', 'Reserva', 'Mascota', 'Cotizacion']) {
  backend.notificador.resources.lambda.addEventSource(
    new DynamoEventSource(tables[modelo], {
      startingPosition: StartingPosition.LATEST,
      batchSize: 25,
      retryAttempts: 2,
      bisectBatchOnError: true,
      filters: [FilterCriteria.filter({ eventName: FilterRule.isEqual('INSERT') })],
    }),
  );
}
