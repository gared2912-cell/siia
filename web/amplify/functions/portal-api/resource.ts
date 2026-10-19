import { defineFunction, secret } from '@aws-amplify/backend';
import { SECRETO_VAPID } from '../../ambiente';

export const portalApi = defineFunction({
  name: 'siia-portal-api',
  entry: './handler.ts',
  timeoutSeconds: 20,
  memoryMB: 512,
  runtime: 22,
  resourceGroupName: 'data',
  // Para «enviar notificación de prueba» a los dispositivos del usuario.
  environment: { VAPID_PRIVATE_KEY: secret(SECRETO_VAPID) },
});
