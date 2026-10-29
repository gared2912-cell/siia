// Reportes de fallas y solicitudes de mejora que los administradores mandan desde el botón flotante del panel.
// Los recibe y atiende el desarrollador (Gared), que no ve el botón.

/** Cuenta del desarrollador y administrador principal: no ve el botón y es quien atiende los reportes. */
export const DESARROLLADOR_EMAIL = 'gared291281@gmail.com';
/** Correo al que llegan los reportes y solicitudes. */
export const REPORTES_CORREO = 'gared2912@gmail.com';
export const esDesarrollador = (email?: string | null) => (email ?? '').trim().toLowerCase() === DESARROLLADOR_EMAIL;

export const TIPOS_REPORTE = {
  FALLA: { label: 'Reportar una falla', corto: 'Falla' },
  MEJORA: { label: 'Solicitar una mejora', corto: 'Mejora' },
} as const;
export type TipoReporte = keyof typeof TIPOS_REPORTE;

export const ESTADOS_REPORTE = {
  NUEVO: 'Recibido',
  EN_REVISION: 'En revisión',
  RESUELTO: 'Resuelto',
  DESCARTADO: 'No procede',
} as const;
export type EstadoReporte = keyof typeof ESTADOS_REPORTE;

export const MAX_IMAGENES_REPORTE = 5;
export const MIN_TEXTO_REPORTE = 10;

/** Aviso a quien lo envió cuando queda resuelto: la mejora ya está en producción o la falla ya quedó arreglada. */
export const avisoResuelto = (tipo: string) =>
  tipo === 'MEJORA' ? 'Tu solicitud de mejora ya está en producción' : 'La falla que reportaste ya quedó arreglada';
