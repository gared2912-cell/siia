// Catálogo de notificaciones push. Lo usan el notificador (qué enviar y a quién), las APIs (preferencias)
// y el portal / panel (pantalla «App y notificaciones»). Sin dependencias para importarse en ambos lados.

/** Llave pública VAPID (la privada vive como secreto de Amplify: VAPID_PRIVATE_KEY). */
export const VAPID_PUBLIC_KEY = 'BBc-cq61OlRhNVETYGaLxzKz_aDe-C6UUH2-1NbRe_W1o5-Y_6Diw1_zVOETvEqf1nRuqjUV6a7j_zeyX8YVKnI';
export const VAPID_SUBJECT = 'mailto:contacto@siia.casa';

export type Categoria = { key: string; label: string; desc: string };

export const CATEGORIAS_RESIDENTE: Categoria[] = [
  { key: 'pagos', label: 'Pagos', desc: 'Comprobante recibido, pago aprobado o rechazado.' },
  { key: 'caseta', label: 'Caseta y visitas', desc: 'Llegada de visitas, paquetería y alertas de caseta.' },
  { key: 'comunicados', label: 'Comunicados y encuestas', desc: 'Avisos generales de la administración.' },
  { key: 'tramites', label: 'Mis trámites', desc: 'Respuesta a incidentes, reservas y registro de mascotas.' },
  { key: 'chat', label: 'Mensajes', desc: 'Respuestas de la administración o de la caseta en el chat.' },
];

export const CATEGORIAS_VIGILANTE: Categoria[] = [{ key: 'chat', label: 'Mensajes de residentes', desc: 'Un residente escribe al chat de caseta.' }];

export const CATEGORIAS_ADMIN: (Categoria & { seccion: string; nivel: 'ver' | 'editar'; extra?: string })[] = [
  { key: 'pagos', label: 'Comprobantes por aprobar', desc: 'Un residente sube un comprobante de pago.', seccion: 'finanzas', nivel: 'ver', extra: 'finanzas.validarPagos' },
  { key: 'chat', label: 'Mensajes de residentes', desc: 'Un residente escribe a la administración.', seccion: 'chat', nivel: 'ver' },
  { key: 'incidentes', label: 'Incidentes nuevos', desc: 'Un residente reporta una falla o incidente.', seccion: 'incidentes', nivel: 'ver' },
  { key: 'reservas', label: 'Reservas por aprobar', desc: 'Solicitud de reserva de una amenidad.', seccion: 'amenidades', nivel: 'editar' },
  { key: 'mascotas', label: 'Mascotas por validar', desc: 'Un residente registra una mascota.', seccion: 'mascotas', nivel: 'editar' },
];

/** Categoría de residente de cada tipo de aviso (los avisos son lo que aparece en la campana del portal). */
export function categoriaDeAviso(tipo?: string | null): string {
  switch (tipo) {
    case 'PAGO':
      return 'pagos';
    case 'VISITA':
    case 'CASETA':
      return 'caseta';
    case 'INCIDENTE':
    case 'RESERVA':
    case 'MASCOTA':
      return 'tramites';
    default:
      return 'comunicados';
  }
}
