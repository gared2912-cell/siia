import { defineStorage } from '@aws-amplify/backend';

// Archivos que suben los residentes (comprobantes de pago, fotos de incidentes y mascotas).
// Cada residente solo escribe en su carpeta; la administración puede leer todo.
export const storage = defineStorage({
  name: 'siiaPortal',
  access: (allow) => ({
    'residentes/{entity_id}/*': [
      allow.entity('identity').to(['read', 'write', 'delete']),
      allow.groups(['ADMIN']).to(['read', 'delete']),
    ],
    'condominios/*': [allow.groups(['ADMIN']).to(['read', 'write', 'delete'])],
  }),
});
