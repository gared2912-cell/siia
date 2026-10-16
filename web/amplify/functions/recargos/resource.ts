import { defineFunction } from '@aws-amplify/backend';

// Recargo por pago tardío: corre cada día a las 00:15 (hora de México).
export const recargos = defineFunction({
  name: 'siia-recargos',
  entry: './handler.ts',
  timeoutSeconds: 300,
  memoryMB: 512,
  runtime: 22,
  resourceGroupName: 'data',
  schedule: { cron: '15 0 * * ? *', timezone: 'America/Mexico_City', description: 'Recargos por pago tardío' },
});
