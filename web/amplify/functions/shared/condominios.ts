// Estado de un condominio: activo, suspendido o en la papelera (solo el SUPERADMIN suspende o elimina).
// Suspendido: nadie de ese condominio entra (residentes, caseta ni sus administradores; el SUPERADMIN sí) y no se
// generan cuotas ni recargos automáticos. En la papelera: oculto para todos y sus cuentas desactivadas; la Lambda
// siia-papelera lo borra definitivamente (con todos sus datos) DIAS_PAPELERA días después.
import type { Item } from './db';

export const DIAS_PAPELERA = 30;

export const enPapelera = (c?: Item | null) => !!c?.eliminadoEn;
export const suspendido = (c?: Item | null) => !!c?.suspendido;
/** Condominio en operación: ni suspendido ni en la papelera. */
export const operando = (c?: Item | null) => !!c && !suspendido(c) && !enPapelera(c);

/** Cuándo se borra definitivamente un condominio que está en la papelera. */
export const fechaBorrado = (eliminadoEn: string) => new Date(Date.parse(eliminadoEn) + DIAS_PAPELERA * 86400000).toISOString();

/** Campos a.json(): se guardan como texto y AppSync puede devolverlos doblemente codificados. */
export function jsonDe<T = Item>(v: unknown): T | null {
  let x = v;
  for (let k = 0; k < 2 && typeof x === 'string'; k++) {
    try {
      x = JSON.parse(x);
    } catch {
      return null;
    }
  }
  return x && typeof x === 'object' ? (x as T) : null;
}

/** Acciones de la Lambda siia-papelera (admin-api la invoca sin esperar; también corre cada hora). */
export type OrdenPapelera =
  | { accion: 'desactivar'; condominioId: string }
  | { accion: 'reactivar'; condominioId: string; cuentas: string[] }
  | { accion: 'purgar'; condominioId: string };
