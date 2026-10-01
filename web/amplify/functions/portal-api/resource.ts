import { defineFunction } from '@aws-amplify/backend';

export const portalApi = defineFunction({
  name: 'siia-portal-api',
  entry: './handler.ts',
  timeoutSeconds: 20,
  memoryMB: 512,
  runtime: 22,
  resourceGroupName: 'data',
});
