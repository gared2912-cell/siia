import { defineStorage } from '@aws-amplify/backend';

// Archivos que suben los residentes (comprobantes de pago, fotos de incidentes y mascotas).
// Cada residente solo escribe en su carpeta y no puede borrar lo que ya envió (son soporte contable).
// Solo SUPERADMIN lee directo; los ADMIN reciben URLs firmadas por admin-api, únicamente de registros de sus condominios.
// keepOnDelete: el bucket y sus archivos se conservan aunque se elimine la pila de Amplify.
// versioned: un archivo borrado o sobrescrito se puede recuperar (ver reglas de ciclo de vida en backend.ts).
export const storage = defineStorage({
  name: 'siiaPortal',
  keepOnDelete: true,
  versioned: true,
  access: (allow) => ({
    'residentes/{entity_id}/*': [
      allow.entity('identity').to(['read', 'write']),
      allow.groups(['SUPERADMIN']).to(['read', 'delete']),
    ],
    'condominios/*': [allow.groups(['SUPERADMIN']).to(['read', 'write', 'delete'])],
  }),
});
