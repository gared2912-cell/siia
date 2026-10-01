// El access token que usa AppSync no incluye el correo; se consulta a Cognito cuando hace falta.
// En este user pool (inicio de sesión con correo) el username de Cognito es el sub.
import { AdminGetUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

export const cognito = new CognitoIdentityProviderClient({});

export async function emailDe(sub: string): Promise<string> {
  const r = await cognito.send(new AdminGetUserCommand({ UserPoolId: process.env.USER_POOL_ID!, Username: sub }));
  return r.UserAttributes?.find((a) => a.Name === 'email')?.Value ?? '';
}
