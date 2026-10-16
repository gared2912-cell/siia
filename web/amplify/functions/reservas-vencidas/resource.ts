import { defineFunction } from '@aws-amplify/backend';

// Cada hora cancela las reservas pendientes de pago que llevan 48 horas sin comprobante.
export const reservasVencidas = defineFunction({
  name: 'siia-reservas-vencidas',
  entry: './handler.ts',
  timeoutSeconds: 120,
  memoryMB: 512,
  runtime: 22,
  resourceGroupName: 'data',
  schedule: 'every 1h',
});
