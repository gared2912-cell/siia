import { defineFunction } from '@aws-amplify/backend';

// Formularios del sitio público (Cotizar y Contacto): URL pública sin sesión (ver backend.ts).
export const cotizaciones = defineFunction({
  name: 'siia-cotizaciones',
  entry: './handler.ts',
  timeoutSeconds: 15,
  memoryMB: 256,
  runtime: 22,
  resourceGroupName: 'data',
});
