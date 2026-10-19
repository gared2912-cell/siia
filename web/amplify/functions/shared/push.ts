// Notificaciones push (Web Push / VAPID): registro de dispositivos, preferencias y envío.
// Cada teléfono o navegador donde el usuario activa notificaciones es un `Dispositivo` (id = hash del endpoint).
import { createHash } from 'node:crypto';
import webpush from 'web-push';
import { byIndex, fail, get, put, remove, str, update, type Item } from './db';
import { VAPID_PUBLIC_KEY, VAPID_SUBJECT, type Categoria } from './notificaciones';

/**
 * `badge`: número para el icono de la app (pendientes del destinatario); sin él, el icono no cambia.
 * `silent`: sin sonido ni vibración (preferencia Perfil.notifSilencio del destinatario).
 */
export type Aviso = { title: string; body?: string; url: string; tag?: string; badge?: number; silent?: boolean; image?: string };

let listo = false;
function configurar() {
  if (listo) return;
  if (!process.env.VAPID_PRIVATE_KEY) throw new Error('Falta el secreto VAPID_PRIVATE_KEY');
  webpush.setVapidDetails(VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  listo = true;
}

const idDispositivo = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex');

/** Envía a todos los dispositivos del usuario; borra los que el navegador ya dio de baja. Regresa cuántos recibieron. */
export async function enviarAUsuario(userId: string, aviso: Aviso): Promise<number> {
  configurar();
  const dispositivos = await byIndex('Dispositivo', 'byUser', 'userId', userId);
  let enviados = 0;
  await Promise.all(
    dispositivos.map(async (d) => {
      try {
        await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, JSON.stringify(aviso), {
          TTL: 24 * 3600,
          urgency: 'high',
        });
        enviados++;
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) await remove('Dispositivo', { id: d.id });
        else console.error('push', d.id, err?.statusCode, err?.body ?? err?.message);
      }
    }),
  );
  return enviados;
}

/**
 * Acciones `notificaciones.*` comunes a portal-api y admin-api.
 * `categorias`: las que aplican al usuario según su rol (y permisos, si es administrador).
 */
export async function accionNotificaciones(action: string, p: Item, userId: string, categorias: Categoria[], url: string) {
  const perfil = await get('Perfil', { userId });
  if (!perfil) fail('Usuario no encontrado.');
  const endpoint = str(p.endpoint, 1000);

  switch (action) {
    case 'notificaciones.estado': {
      const dispositivos = await byIndex('Dispositivo', 'byUser', 'userId', userId);
      return {
        categorias,
        apagadas: (perfil!.notifApagadas ?? []).filter(Boolean),
        silencio: !!perfil!.notifSilencio,
        dispositivos: dispositivos.length,
        esteDispositivo: !!endpoint && dispositivos.some((d) => d.endpoint === endpoint),
      };
    }
    case 'notificaciones.suscribir': {
      const s = p.subscription ?? {};
      const ep = str(s.endpoint, 1000);
      if (!/^https:\/\//.test(ep) || !str(s.keys?.p256dh, 200) || !str(s.keys?.auth, 100)) fail('Suscripción no válida.');
      // Si el teléfono estaba registrado con otra cuenta, ahora es de quien inició sesión.
      await put('Dispositivo', {
        id: idDispositivo(ep),
        userId,
        endpoint: ep,
        p256dh: str(s.keys.p256dh, 200),
        auth: str(s.keys.auth, 100),
        plataforma: str(p.plataforma, 200),
      });
      return { ok: true };
    }
    case 'notificaciones.baja': {
      if (!endpoint) return { ok: true };
      const d = await get('Dispositivo', { id: idDispositivo(endpoint) });
      if (d?.userId === userId) await remove('Dispositivo', { id: d.id });
      return { ok: true };
    }
    case 'notificaciones.preferencias': {
      // Cada campo es opcional: solo se cambia lo que se envía (categorías apagadas y/o modo silencio).
      const validas = new Set(categorias.map((c) => c.key));
      const cambios: Item = {};
      if (Array.isArray(p.apagadas)) cambios.notifApagadas = [...new Set(p.apagadas.map(String))].filter((k) => validas.has(k));
      if (typeof p.silencio === 'boolean') cambios.notifSilencio = p.silencio;
      if (!Object.keys(cambios).length) fail('Sin cambios.');
      const r = await update('Perfil', { userId }, cambios);
      return { apagadas: (r.notifApagadas ?? []).filter(Boolean), silencio: !!r.notifSilencio };
    }
    case 'notificaciones.probar': {
      const enviados = await enviarAUsuario(userId, {
        title: 'SIIA',
        body: perfil!.notifSilencio ? 'Las notificaciones funcionan en este dispositivo (en silencio).' : 'Las notificaciones funcionan en este dispositivo.',
        url,
        tag: 'prueba',
        silent: !!perfil!.notifSilencio,
      });
      if (!enviados) fail('No hay dispositivos con notificaciones activas en tu cuenta.');
      return { enviados };
    }
  }
  fail('Acción no válida.');
}
