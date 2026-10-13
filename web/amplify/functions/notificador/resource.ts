import { defineFunction, secret } from '@aws-amplify/backend';

export const notificador = defineFunction({
  name: 'siia-notificador',
  entry: './handler.ts',
  timeoutSeconds: 60,
  memoryMB: 512,
  runtime: 22,
  resourceGroupName: 'data',
  environment: { VAPID_PRIVATE_KEY: secret('VAPID_PRIVATE_KEY') },
});
