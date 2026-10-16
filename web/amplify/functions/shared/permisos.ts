// Catálogo de permisos de administración. Lo usan la Lambda admin-api (que los hace cumplir)
// y el panel /admin (que solo muestra lo permitido). Sin dependencias para poder importarse en ambos.
//
// SUPERADMIN: todo, incluidos roles de administración y alta de administradores.
// ADMIN: lo que diga su rol (RolAdmin) y solo en sus condominios asignados.

export type Nivel = 'ninguno' | 'ver' | 'editar';

export const NIVELES: [Nivel, string][] = [
  ['ninguno', 'Sin acceso'],
  ['ver', 'Solo ver'],
  ['editar', 'Gestionar'],
];

/** Secciones del panel y qué significa «Gestionar» en cada una. */
export const SECCIONES_PERMISO: { key: string; label: string; editar: string; soloVer?: boolean }[] = [
  { key: 'condominios', label: 'Condominios y unidades', editar: 'Editar datos del condominio y dar de alta (también con Excel), editar o eliminar casas y departamentos' },
  { key: 'usuarios', label: 'Residentes y vigilantes (dentro de Condominios)', editar: 'Dar de alta, autorizar, reenviar acceso, suspender y reactivar' },
  { key: 'finanzas', label: 'Finanzas', editar: 'Crear cuotas extraordinarias y cargos, y cancelar cargos' },
  { key: 'comunicados', label: 'Comunicados', editar: 'Publicar, editar y eliminar comunicados; avisos a todas las unidades' },
  { key: 'encuestas', label: 'Encuestas', editar: 'Crear, cerrar y eliminar encuestas' },
  { key: 'chat', label: 'Chat con residentes', editar: 'Responder mensajes' },
  { key: 'incidentes', label: 'Incidentes', editar: 'Atender incidentes y cambiar su estado' },
  { key: 'mantenimientos', label: 'Mantenimientos', editar: 'Programar, editar y eliminar mantenimientos' },
  { key: 'amenidades', label: 'Amenidades y reservas', editar: 'Configurar amenidades y aprobar o rechazar reservas' },
  { key: 'visitas', label: 'Visitas (bitácora)', editar: '', soloVer: true },
  { key: 'mascotas', label: 'Mascota segura', editar: 'Aprobar o rechazar mascotas' },
];

/** Permisos especiales, adicionales al nivel de su sección. */
export const EXTRAS: { key: string; seccion: string; label: string }[] = [
  { key: 'condominios.alta', seccion: 'condominios', label: 'Dar de alta condominios nuevos' },
  { key: 'condominios.servicios', seccion: 'condominios', label: 'Activar o desactivar servicios del portal y el portal completo' },
  { key: 'condominios.datosPago', seccion: 'condominios', label: 'Editar la cuota de mantenimiento y los datos bancarios' },
  { key: 'usuarios.eliminar', seccion: 'usuarios', label: 'Eliminar cuentas definitivamente' },
  { key: 'finanzas.validarPagos', seccion: 'finanzas', label: 'Aprobar o rechazar comprobantes de pago (emite recibos)' },
  { key: 'finanzas.generarCuotas', seccion: 'finanzas', label: 'Generar las cuotas de mantenimiento del mes' },
];

export type Permisos = { secciones: Record<string, Nivel>; extras: string[] };

export const SIN_PERMISOS: Permisos = { secciones: {}, extras: [] };

export const TODOS_LOS_PERMISOS: Permisos = {
  secciones: Object.fromEntries(SECCIONES_PERMISO.map((s) => [s.key, s.soloVer ? 'ver' : 'editar'])) as Record<string, Nivel>,
  extras: EXTRAS.map((e) => e.key),
};

/** Normaliza lo que venga de la base de datos o del formulario (descarta claves desconocidas). */
export function normalizarPermisos(raw: unknown): Permisos {
  let p: any = raw;
  for (let i = 0; i < 2 && typeof p === 'string'; i++) {
    try {
      p = JSON.parse(p);
    } catch {
      p = null;
    }
  }
  const secciones: Record<string, Nivel> = {};
  for (const s of SECCIONES_PERMISO) {
    const v = p?.secciones?.[s.key];
    const nivel: Nivel = v === 'editar' || v === 'ver' ? v : 'ninguno';
    secciones[s.key] = s.soloVer && nivel === 'editar' ? 'ver' : nivel;
  }
  // Un permiso especial solo vale si su sección es al menos visible.
  const extras = EXTRAS.filter((e) => (p?.extras ?? []).includes(e.key) && secciones[e.seccion] !== 'ninguno').map((e) => e.key);
  return { secciones, extras };
}

export const alcanza = (tiene: Nivel | undefined, pide: Nivel) =>
  pide === 'ninguno' || (pide === 'ver' ? tiene === 'ver' || tiene === 'editar' : tiene === 'editar');

/** Roles iniciales que se crean al activar los permisos (el superadministrador puede cambiarlos). */
export const ROLES_INICIALES: { id: string; nombre: string; descripcion: string; permisos: Permisos }[] = [
  {
    id: 'rol-general',
    nombre: 'Administrador general',
    descripcion: 'Gestiona todo en sus condominios asignados.',
    permisos: TODOS_LOS_PERMISOS,
  },
  {
    id: 'rol-contador',
    nombre: 'Contador',
    descripcion: 'Cobranza: comprobantes, recibos, cuotas y cargos.',
    permisos: {
      secciones: { condominios: 'ver', finanzas: 'editar', comunicados: 'ver', chat: 'ver' },
      extras: ['finanzas.validarPagos', 'finanzas.generarCuotas', 'condominios.datosPago'],
    },
  },
  {
    id: 'rol-operacion',
    nombre: 'Gerente de operación',
    descripcion: 'Día a día: incidentes, mantenimientos, amenidades, mascotas, visitas y comunicación.',
    permisos: {
      secciones: {
        condominios: 'ver',
        usuarios: 'ver',
        comunicados: 'editar',
        encuestas: 'editar',
        chat: 'editar',
        incidentes: 'editar',
        mantenimientos: 'editar',
        amenidades: 'editar',
        visitas: 'ver',
        mascotas: 'editar',
      },
      extras: [],
    },
  },
  {
    id: 'rol-consulta',
    nombre: 'Solo consulta',
    descripcion: 'Ve todas las secciones sin poder modificar nada (comité de vigilancia, auditoría).',
    permisos: {
      secciones: Object.fromEntries(SECCIONES_PERMISO.map((s) => [s.key, 'ver'])) as Record<string, Nivel>,
      extras: [],
    },
  },
];
