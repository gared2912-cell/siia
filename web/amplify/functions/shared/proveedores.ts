// Proveedores (siia.casa/proveedores): personas de empresas externas o personal propio (jardinero, alberca, fumigación…)
// que entran a SIIA a registrar su bitácora de trabajo con fotos. Cada día hacen dos reportes independientes:
// uno detallado para la administración y otro para los residentes. Una vez enviado, un reporte ya no se modifica.

/** Servicios más comunes en condominios. «Otro» deja escribir el servicio. */
export const SERVICIOS_PROVEEDOR = [
  'Jardinería y poda',
  'Mantenimiento de alberca',
  'Fumigación y control de plagas',
  'Limpieza de áreas comunes',
  'Limpieza y desinfección de cisternas y tinacos',
  'Bombas e hidroneumáticos',
  'Elevadores',
  'Electricidad e iluminación',
  'Plomería',
  'Impermeabilización',
  'Pintura y fachadas',
  'Portones y control de acceso',
  'Cámaras y seguridad electrónica',
  'Extintores y equipo contra incendio',
  'Gas estacionario',
  'Herrería y cancelería',
  'Albañilería',
  'Aire acondicionado',
  'Sistema de riego',
  'Recolección de basura',
] as const;
/** Si la administración se lo asigna, el proveedor puede escribir un servicio que no está en su lista. */
export const OTRO_SERVICIO = 'Otro';
export const ETIQUETA_OTRO = 'Otro (el proveedor escribe cuál)';

export type DestinoReporte = 'ADMIN' | 'RESIDENTES';
export const ETIQUETA_DESTINO: Record<DestinoReporte, string> = { ADMIN: 'Administración', RESIDENTES: 'Residentes' };

export const MAX_FOTOS_REPORTE = 20;
export const MAX_FOTO_REPORTE = 10 * 1024 * 1024;

export type FotoReporte = { path: string; descripcion: string; url?: string };
export type ReporteProveedor = {
  id: string;
  condominioId: string;
  condominio?: string;
  proveedorId: string;
  proveedorNombre?: string | null;
  empresa?: string | null;
  destino: DestinoReporte;
  tipo: string;
  descripcion?: string | null;
  fecha: string;
  createdAt: string;
  fotos: FotoReporte[];
};

/** Servicio que se muestra: el del catálogo o el que escribió en «Otro». */
export const servicioDe = (tipo: string, tipoOtro?: string | null) => (tipo === OTRO_SERVICIO && tipoOtro ? tipoOtro : tipo);

/** Lista guardada como texto JSON (a veces dos veces). */
export function listaJson<T>(v: unknown): T[] {
  let x = v;
  for (let k = 0; k < 2 && typeof x === 'string'; k++) {
    try {
      x = JSON.parse(x);
    } catch {
      return [];
    }
  }
  return Array.isArray(x) ? (x as T[]) : [];
}
