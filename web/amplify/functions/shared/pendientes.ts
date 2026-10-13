// Pendientes de un residente: avisos sin leer de su unidad y mensajes de chat (administración / caseta)
// que llegaron después de la última vez que abrió cada conversación. Lo usan la campana del portal
// y el número del icono de la app (portal-api y notificador).
import { byIndex, type Item } from './db';

export type Canal = 'ADMIN' | 'CASETA';
export const CAMPO_LEIDO: Record<Canal, 'chatLeidoAdmin' | 'chatLeidoCaseta'> = { ADMIN: 'chatLeidoAdmin', CASETA: 'chatLeidoCaseta' };

/** Canales de chat que ve el residente (Chat.tsx: Caseta solo si también está el módulo de visitas). */
export function canalesDe(condominio: Item): Canal[] {
  const mods: string[] = condominio.modulos ?? [];
  if (!mods.includes('chat')) return [];
  return mods.includes('visitas') ? ['ADMIN', 'CASETA'] : ['ADMIN'];
}

/** Momento hasta el que el residente ya vio el hilo: lo que marcó al abrirlo o su propio último mensaje. */
export function leidoHasta(perfil: Item, canal: Canal, mensajes: Item[]): string {
  const propio = mensajes.filter((m) => m.autorId === perfil.userId).reduce((max, m) => (m.createdAt > max ? m.createdAt : max), '');
  const marcado: string = perfil[CAMPO_LEIDO[canal]] ?? '';
  return marcado > propio ? marcado : propio;
}

export const deEquipo = (m: Item) => m.autorRol !== 'RESIDENTE';

export async function chatSinLeer(perfil: Item, condominio: Item, unidadId: string): Promise<Record<Canal, number>> {
  const out: Record<Canal, number> = { ADMIN: 0, CASETA: 0 };
  await Promise.all(
    canalesDe(condominio).map(async (canal) => {
      const mensajes = await byIndex('Mensaje', 'byHilo', 'hilo', `${condominio.id}#${unidadId}#${canal}`);
      const desde = leidoHasta(perfil, canal, mensajes);
      out[canal] = mensajes.filter((m) => deEquipo(m) && m.createdAt > desde).length;
    }),
  );
  return out;
}

export async function avisosSinLeer(unidadId: string): Promise<number> {
  return (await byIndex('Aviso', 'byUnidad', 'unidadId', unidadId)).filter((a) => !a.leido).length;
}
