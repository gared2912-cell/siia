import { defineFunction } from '@aws-amplify/backend';

// Papelera de condominios: desactiva o reactiva sus cuentas (admin-api la invoca al eliminar o restaurar) y, cada
// hora, borra definitivamente los que cumplieron 30 días en la papelera o cuyo borrado inmediato quedó pendiente.
export const papelera = defineFunction({
  name: 'siia-papelera',
  entry: './handler.ts',
  timeoutSeconds: 900,
  memoryMB: 512,
  runtime: 22,
  resourceGroupName: 'data',
  schedule: 'every 1h',
});
