import { defineFunction, secret } from '@aws-amplify/backend';
import { SECRETO_VAPID } from '../../ambiente';

export const notificador = defineFunction({
  name: 'siia-notificador',
  entry: './handler.ts',
  timeoutSeconds: 60,
  memoryMB: 512,
  runtime: 22,
  resourceGroupName: 'data',
  environment: { VAPID_PRIVATE_KEY: secret(SECRETO_VAPID) },
});
