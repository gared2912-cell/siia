// Firma de la administración: cada alta o cambio que hace un administrador (o una tarea automática)
// queda sellado en el registro y en el registro de actividad (modelo Actividad).
// - firma: quién lo creó · firmaCambio: quién lo modificó por última vez → { id, nombre, email, rol, en }
// - La pone el servidor con la sesión de quien llama: el navegador no puede quitarla ni cambiarla.
// - Una invocación de Lambda atiende una petición a la vez, así que el firmante vive en el módulo.

export type Firmante = { id: string; nombre: string; email?: string | null; rol: 'SUPERADMIN' | 'ADMIN' | 'SISTEMA' };
export type Firma = Firmante & { en: string };
export type CampoCambio = { campo: string; antes: unknown; despues: unknown };
export type Cambio = { modelo: string; op: 'alta' | 'cambio' | 'baja'; id: string; condominioId: string | null; etiqueta: string; campos: CampoCambio[] };

export const SISTEMA: Firmante = { id: 'sistema', nombre: 'SIIA (automático)', rol: 'SISTEMA' };

// Modelos que llevan firma (los mismos que tienen los campos firma/firmaCambio en el esquema).
export const MODELOS_FIRMADOS = new Set([
  'RolAdmin', 'Condominio', 'Unidad', 'Perfil', 'Cargo', 'Pago', 'Egreso', 'SaldoMensual', 'Comunicado',
  'Encuesta', 'Mensaje', 'Incidente', 'Mantenimiento', 'Amenidad', 'Reserva', 'Mascota', 'CorteAccesos',
]);

// Campos que se actualizan solos (contadores, marcas de lectura): no son un cambio de la administración.
const IGNORADOS = new Set(['updatedAt', 'createdAt', '__typename', 'firma', 'firmaCambio', 'chatLeidoAdmin', 'chatLeidoCaseta', 'owner', 'avisoVencido']);
// Nunca se guardan en el registro de actividad.
const SECRETOS = /password|contrasena|token|p256dh|auth$/i;

let firmante: Firmante | null = null;
let cambios: Cambio[] = [];

/** Al inicio de cada petición: quién firma lo que se guarde (null = no firmar, p. ej. residentes). */
export function firmarComo(f: Firmante | null) {
  firmante = f;
  cambios = [];
}
export const firmanteActual = () => firmante;
/** Los cambios registrados en esta petición (y los borra). */
export function tomarCambios(): Cambio[] {
  const c = cambios;
  cambios = [];
  return c;
}

export const firmado = (modelo: string) => !!firmante && MODELOS_FIRMADOS.has(modelo);
export const selloFirma = (): string => JSON.stringify({ ...firmante!, en: new Date().toISOString() } satisfies Firma);

const relevante = (campo: string) => !IGNORADOS.has(campo);
/** ¿El cambio toca algo más que campos automáticos? */
export const cambioRelevante = (campos: Record<string, unknown>) => Object.keys(campos).some(relevante);

const etiquetaDe = (x: Record<string, any>) =>
  String(x.titulo || x.nombre || x.concepto || x.folio || x.numero || x.email || x.texto || x.pregunta || x.periodo || x.id || '').slice(0, 120);

const corto = (v: unknown): unknown => {
  if (v === undefined) return null;
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > 300 ? `${s.slice(0, 300)}…` : v;
};
const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Anota un alta, cambio o baja hecho por el firmante actual. */
export function registrarCambio(modelo: string, op: Cambio['op'], antes: Record<string, any> | undefined, despues: Record<string, any> | undefined) {
  if (!firmado(modelo)) return;
  const base = (despues ?? antes ?? {}) as Record<string, any>;
  const claves = op === 'cambio' ? Object.keys(despues ?? {}) : Object.keys(base);
  const campos: CampoCambio[] = claves
    .filter((k) => relevante(k) && !SECRETOS.test(k) && k !== 'id')
    .filter((k) => op !== 'cambio' || !igual(antes?.[k], despues?.[k]))
    .map((k) => ({ campo: k, antes: op === 'alta' ? null : corto(antes?.[k]), despues: op === 'baja' ? null : corto(despues?.[k]) }))
    .filter((c) => op !== 'alta' || c.despues !== null);
  if (op === 'cambio' && !campos.length) return;
  cambios.push({
    modelo,
    op,
    id: String(base.id ?? base.userId ?? ''),
    condominioId: (modelo === 'Condominio' ? base.id : (base.condominioId ?? antes?.condominioId)) ?? null,
    etiqueta: etiquetaDe({ ...(antes ?? {}), ...(despues ?? {}) }),
    campos: campos.slice(0, 40),
  });
}

/** Anota en la actividad una acción que no cambia datos guardados (p. ej. asignar una contraseña en Cognito). */
export function anotar(modelo: string, registro: Record<string, any>, campo: string, texto: string) {
  if (!firmado(modelo)) return;
  registrarCambio(modelo, 'cambio', { ...registro, [campo]: null }, { ...registro, [campo]: texto });
}

/** Quita el correo de las firmas (los administradores ven el nombre; el correo solo el superadministrador). */
export function sinCorreos<T>(valor: T): T {
  const limpiar = (v: any): any => {
    if (Array.isArray(v)) return v.map(limpiar);
    if (!v || typeof v !== 'object') return v;
    const out: Record<string, any> = {};
    for (const [k, x] of Object.entries(v)) {
      if ((k === 'firma' || k === 'firmaCambio' || k === 'ediciones') && x) {
        try {
          // Puede venir codificada dos veces (AWSJSON de un valor que ya era texto JSON).
          let f: any = x;
          for (let i = 0; i < 2 && typeof f === 'string'; i++) f = JSON.parse(f);
          // ediciones: [{ por: { nombre, email, … }, … }] (shared/ediciones.ts)
          if (Array.isArray(f)) f.forEach((e) => e?.por && delete e.por.email);
          else if (f && typeof f === 'object') delete f.email;
          out[k] = f;
        } catch {
          out[k] = null;
        }
      } else out[k] = limpiar(x);
    }
    return out;
  };
  return limpiar(valor);
}

/**
 * Los residentes y vigilantes nunca ven quién de la administración hizo algo: solo «Administración».
 * (registradoPor se conserva: en visitas y turnos es el vigilante, que la caseta sí debe ver.)
 */
export function sinFirmas<T>(valor: T): T {
  const quitar = new Set(['firma', 'firmaCambio', 'validadoPor', 'registradoPorNombre', 'editadoPor', 'autor', 'ediciones']);
  const limpiar = (v: any): any => {
    if (Array.isArray(v)) return v.map(limpiar);
    if (!v || typeof v !== 'object') return v;
    return Object.fromEntries(Object.entries(v).filter(([k]) => !quitar.has(k)).map(([k, x]) => [k, limpiar(x)]));
  };
  return limpiar(valor);
}
