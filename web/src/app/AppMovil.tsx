// App instalable y notificaciones push (residentes, vigilantes y administradores).
// - Instalar: Android/Chrome usan el aviso nativo (beforeinstallprompt); iPhone requiere «Compartir › Agregar a inicio».
// - Notificaciones: suscripción Web Push de este dispositivo + categorías que el usuario quiere recibir.
//   En iPhone solo funcionan con la app instalada en la pantalla de inicio (iOS 16.4+).
import { useEffect, useState } from 'react';
import { adminCall, portal } from './api';
import { Empty, ErrorBox, Icon, Loading, Modal, useAction, useLoad, useToast } from './ui';
import { VAPID_PUBLIC_KEY, type Categoria } from '../../amplify/functions/shared/notificaciones';

export type ApiApp = 'portal' | 'admin';
type Estado = { categorias: Categoria[]; apagadas: string[]; silencio: boolean; dispositivos: number; esteDispositivo: boolean };

const llamar = <T,>(api: ApiApp, action: string, payload?: object) => (api === 'admin' ? adminCall<T>(action, payload) : portal<T>(action, payload));

declare global {
  interface Window {
    __siiaInstalar?: Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
  }
}

const esIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const esApp = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const soportaPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function llaveVapid(base64: string) {
  const b = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
}

async function suscripcionActual() {
  if (!soportaPush()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** Estado de instalación y del aviso nativo de Android (llega una vez, antes de que React cargue). */
function useInstalacion() {
  const [instalable, setInstalable] = useState(() => !!window.__siiaInstalar);
  const [app, setApp] = useState(esApp);
  useEffect(() => {
    const on = () => setInstalable(true);
    const instalada = () => (setApp(true), setInstalable(false));
    window.addEventListener('siia-instalable', on);
    window.addEventListener('appinstalled', instalada);
    return () => {
      window.removeEventListener('siia-instalable', on);
      window.removeEventListener('appinstalled', instalada);
    };
  }, []);
  const instalar = async () => {
    const e = window.__siiaInstalar;
    if (!e) return;
    await e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome === 'accepted') window.__siiaInstalar = undefined;
    setInstalable(!!window.__siiaInstalar);
  };
  return { app, instalable, instalar, ios: esIOS() };
}

/**
 * Al abrir la app: si este dispositivo ya tenía notificaciones, se vuelve a registrar a nombre de la cuenta actual
 * (un teléfono compartido recibe las de quien inició sesión).
 */
export function useSincronizarPush(api: ApiApp) {
  useEffect(() => {
    if (!soportaPush() || Notification.permission !== 'granted') return;
    suscripcionActual()
      .then((s) => s && llamar(api, 'notificaciones.suscribir', { subscription: s.toJSON(), plataforma: navigator.userAgent.slice(0, 200) }))
      .catch(() => undefined);
  }, [api]);
}

/** Al cerrar sesión: este dispositivo deja de recibir las notificaciones de la cuenta. */
type ConInsignia = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

/** Número en el icono de la app instalada (Android / iPhone). 0 lo quita. Sin soporte del navegador no hace nada. */
export function ponerInsignia(n: number) {
  const nav = navigator as ConInsignia;
  if (!nav.setAppBadge || !nav.clearAppBadge) return;
  (n > 0 ? nav.setAppBadge(n) : nav.clearAppBadge()).catch(() => undefined);
}

export function useInsigniaApp(n: number) {
  useEffect(() => ponerInsignia(n), [n]);
}

export async function bajaDeEsteDispositivo(api: ApiApp) {
  ponerInsignia(0);
  const s = await suscripcionActual().catch(() => null);
  if (!s) return;
  await llamar(api, 'notificaciones.baja', { endpoint: s.endpoint }).catch(() => undefined);
  await s.unsubscribe().catch(() => undefined);
}

export function AppYNotificaciones({ api, onClose }: { api: ApiApp; onClose: () => void }) {
  const toast = useToast();
  const inst = useInstalacion();
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const estado = useLoad(async () => {
    const s = await suscripcionActual().catch(() => null);
    setEndpoint(s?.endpoint ?? null);
    return llamar<Estado>(api, 'notificaciones.estado', { endpoint: s?.endpoint });
  });
  const { run, busy } = useAction();
  const push = soportaPush();
  const permiso = push ? Notification.permission : 'default';
  const activas = !!endpoint && !!estado.data?.esteDispositivo && permiso === 'granted';

  async function activar() {
    await run(async () => {
      const p = await Notification.requestPermission();
      if (p !== 'granted') throw new Error('No diste permiso de notificaciones. Puedes activarlo en los ajustes del teléfono para SIIA.');
      const reg = await navigator.serviceWorker.ready;
      const s =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: llaveVapid(VAPID_PUBLIC_KEY) }));
      await llamar(api, 'notificaciones.suscribir', { subscription: s.toJSON(), plataforma: navigator.userAgent.slice(0, 200) });
      await estado.reload(true);
    }, 'Notificaciones activadas en este dispositivo');
  }
  async function desactivar() {
    await run(async () => {
      await bajaDeEsteDispositivo(api);
      await estado.reload(true);
    }, 'Notificaciones desactivadas en este dispositivo');
  }
  async function silenciar(silencio: boolean) {
    estado.setData({ ...estado.data!, silencio });
    try {
      await llamar(api, 'notificaciones.preferencias', { silencio });
      toast(silencio ? 'Notificaciones en silencio: llegarán sin sonido' : 'Notificaciones con sonido');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar', true);
      estado.reload(true);
    }
  }
  async function cambiar(key: string, encendida: boolean) {
    const actuales = estado.data!.apagadas;
    const apagadas = encendida ? actuales.filter((k) => k !== key) : [...actuales, key];
    estado.setData({ ...estado.data!, apagadas });
    try {
      await llamar(api, 'notificaciones.preferencias', { apagadas });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar', true);
      estado.reload(true);
    }
  }

  return (
    <Modal title="App y notificaciones" onClose={onClose}>
      <div className="stack">
        <section className="app-paso">
          <h3>
            <Icon name="phone" /> Instalar en tu teléfono
          </h3>
          {inst.app ? (
            <p className="small">
              <Icon name="check" /> Estás usando la app SIIA. Tu sesión permanece abierta hasta que cierres sesión.
            </p>
          ) : inst.instalable ? (
            <>
              <p className="small muted">Agrega SIIA a tu pantalla de inicio para abrirla como una app, sin buscar la página.</p>
              <button className="btn-app" onClick={inst.instalar}>
                <Icon name="plus" />
                Agregar a la pantalla de inicio
              </button>
            </>
          ) : inst.ios ? (
            <ol className="app-pasos small">
              <li>
                En Safari, toca <strong>Compartir</strong> <span aria-hidden="true">(el cuadro con la flecha ↑)</span>.
              </li>
              <li>
                Elige <strong>Agregar a inicio</strong> y luego <strong>Agregar</strong>.
              </li>
              <li>
                Abre <strong>SIIA</strong> desde el nuevo ícono para activar las notificaciones.
              </li>
            </ol>
          ) : (
            <p className="small muted">
              Abre el menú del navegador <strong>⋮</strong> y elige <strong>Instalar app</strong> o <strong>Agregar a la pantalla de inicio</strong>.
            </p>
          )}
        </section>

        <section className="app-paso">
          <h3>
            <Icon name="bell" /> Notificaciones en este dispositivo
          </h3>
          {!push ? (
            <p className="small muted">
              {inst.ios && !inst.app
                ? 'En iPhone las notificaciones funcionan con la app instalada: sigue los pasos de arriba y entra desde el ícono de SIIA.'
                : 'Este navegador no admite notificaciones. Usa Chrome en Android o Safari en iPhone (iOS 16.4 o posterior).'}
            </p>
          ) : permiso === 'denied' ? (
            <p className="small muted">
              Las notificaciones están bloqueadas para SIIA. Actívalas en los ajustes del teléfono o del navegador y vuelve a intentarlo.
            </p>
          ) : estado.loading && !estado.data ? (
            <Loading />
          ) : estado.error ? (
            <ErrorBox error={estado.error} retry={estado.reload} />
          ) : activas ? (
            <div className="row-actions">
              <span className="small">
                <Icon name="check" /> Activas en este dispositivo
              </span>
              <button className="btn-app sm secondary" disabled={busy} onClick={() => run(() => llamar(api, 'notificaciones.probar'), 'Notificación de prueba enviada')}>
                Enviar prueba
              </button>
              <button className="btn-app sm secondary" disabled={busy} onClick={desactivar}>
                Desactivar
              </button>
            </div>
          ) : (
            <>
              <p className="small muted">Recibe en tu teléfono los avisos de SIIA aunque la app esté cerrada.</p>
              <button className="btn-app" disabled={busy} onClick={activar}>
                <Icon name="bell" />
                {busy ? 'Activando…' : 'Activar notificaciones'}
              </button>
            </>
          )}
        </section>

        {estado.data && (
          <section className="app-paso">
            <h3>Qué quieres recibir</h3>
            {estado.data.categorias.length ? (
              <div className="checks">
                {estado.data.categorias.map((c) => (
                  <label key={c.key} className="check app-categoria">
                    <input type="checkbox" checked={!estado.data!.apagadas.includes(c.key)} onChange={(e) => cambiar(c.key, e.target.checked)} />
                    <span>
                      <strong>{c.label}</strong>
                      <small className="muted">{c.desc}</small>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <Empty icon="bell">Tu cuenta no tiene notificaciones disponibles.</Empty>
            )}
            {estado.data.categorias.length > 0 && (
              <label className="check app-categoria" style={{ marginTop: 12 }}>
                <input type="checkbox" checked={estado.data.silencio} onChange={(e) => silenciar(e.target.checked)} />
                <span>
                  <strong>Recibir en silencio</strong>
                  <small className="muted">
                    Te llegan igual, pero sin sonido ni vibración.{inst.ios && ' En iPhone, si aún suenan, quita el sonido en Ajustes › Notificaciones › SIIA.'}
                  </small>
                </span>
              </label>
            )}
            <p className="small muted" style={{ margin: '8px 0 0' }}>
              Aplica a todos tus dispositivos ({estado.data.dispositivos} con notificaciones activas).
            </p>
          </section>
        )}
      </div>
    </Modal>
  );
}

/** Invitación (una vez) a instalar la app y activar notificaciones. */
export function SugerenciaApp({ abrir }: { abrir: () => void }) {
  const CLAVE = 'siia-sugerencia-app';
  const [ver, setVer] = useState(() => {
    try {
      if (localStorage.getItem(CLAVE)) return false;
    } catch {
      return false;
    }
    const sinPush = soportaPush() ? Notification.permission !== 'granted' : !esApp();
    return !esApp() || sinPush;
  });
  if (!ver) return null;
  const cerrar = () => {
    try {
      localStorage.setItem(CLAVE, '1');
    } catch {
      /* sin almacenamiento local */
    }
    setVer(false);
  };
  return (
    <div className="app-sugerencia">
      <Icon name="phone" />
      <div>
        <strong>Usa SIIA como app</strong>
        <span>Agrégala a tu pantalla de inicio y recibe tus avisos al momento.</span>
      </div>
      <div className="row-actions">
        <button className="btn-app sm" onClick={() => (cerrar(), abrir())}>
          Configurar
        </button>
        <button className="linklike small" onClick={cerrar}>
          Ahora no
        </button>
      </div>
    </div>
  );
}
