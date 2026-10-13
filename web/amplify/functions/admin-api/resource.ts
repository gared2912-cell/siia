import { defineFunction, secret } from '@aws-amplify/backend';

export const adminApi = defineFunction({
  name: 'siia-admin-api',
  entry: './handler.ts',
  timeoutSeconds: 30,
  memoryMB: 512,
  runtime: 22,
  resourceGroupName: 'data',
  // Para «enviar notificación de prueba» a los dispositivos del usuario.
  environment: { VAPID_PRIVATE_KEY: secret('VAPID_PRIVATE_KEY') },
});
