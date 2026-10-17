// Archivos de los comunicados: condominios/{id}/comunicados/<uuid>-<nombre>.

/** Nombre con el que se descarga un PDF adjunto (sin el prefijo único de la ruta). */
export function nombreAdjunto(path: string) {
  const base = path.split('/').pop() ?? 'documento.pdf';
  return base.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '') || 'documento.pdf';
}
