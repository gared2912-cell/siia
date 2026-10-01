import { defineBackend } from '@aws-amplify/backend';
import { Stack } from 'aws-cdk-lib';
import { Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { adminApi } from './functions/admin-api/resource';
import { portalApi } from './functions/portal-api/resource';

const backend = defineBackend({ auth, data, storage, adminApi, portalApi });

const { userPool } = backend.auth.resources;
const tables = backend.data.resources.tables;

// Las Lambdas usan DynamoDB directo; reciben los nombres de tabla como variables de entorno (TABLE_<Modelo>).
for (const fn of [backend.adminApi, backend.portalApi]) {
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

// Los usuarios de un grupo de Cognito reciben el rol IAM de su grupo (no el rol autenticado genérico),
// así que la regla "cada residente su carpeta" de defineStorage no les aplica. Se replica aquí.
const bucket = backend.storage.resources.bucket;
const carpetaPropia = `${bucket.bucketArn}/residentes/\${cognito-identity.amazonaws.com:sub}/*`;
// La política vive en la pila de storage (auth no puede depender de storage: dependencia circular).
new Policy(Stack.of(bucket), 'GruposCarpetaPropia', {
  roles: ['RESIDENTE', 'VIGILANTE'].map((g) => backend.auth.resources.groups[g].role),
  statements: [
    new PolicyStatement({ actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'], resources: [carpetaPropia] }),
    new PolicyStatement({
      actions: ['s3:ListBucket'],
      resources: [bucket.bucketArn],
      conditions: { StringLike: { 's3:prefix': ['residentes/${cognito-identity.amazonaws.com:sub}/', 'residentes/${cognito-identity.amazonaws.com:sub}/*'] } },
    }),
  ],
});

// portal-api firma URLs temporales de fotos de mascotas extraviadas (visibles para vecinos y caseta).
backend.storage.resources.bucket.grantRead(backend.portalApi.resources.lambda, 'residentes/*');
backend.portalApi.addEnvironment('BUCKET', backend.storage.resources.bucket.bucketName);

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
      'cognito-idp:ListUsers',
    ],
    resources: [userPool.userPoolArn],
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
