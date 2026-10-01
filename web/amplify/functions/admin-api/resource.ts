import { defineFunction } from '@aws-amplify/backend';

export const adminApi = defineFunction({
  name: 'siia-admin-api',
  entry: './handler.ts',
  timeoutSeconds: 30,
  memoryMB: 512,
  runtime: 22,
  resourceGroupName: 'data',
});
