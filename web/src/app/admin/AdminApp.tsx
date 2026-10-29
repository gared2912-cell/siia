// /admin — panel de los grupos SUPERADMIN y ADMIN de Cognito. admin-api aplica los permisos del rol
// de administración y los condominios asignados; aquí solo se muestra lo que el usuario puede usar.
import { useAuthenticator } from '@aws-amplify/ui-react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { adminCall, all, db, grupos, type Schema } from '../api';
import { alcanza, type Nivel, type Permisos } from '../../../amplify/functions/shared/permisos';
import { Acceso, Shell, useHashNav, type NavItem } from '../Shell';
import { ErrorBox, Field, Icon, Loading, ToastProvider, useLoad, usePoll } from '../ui';
import { Panel } from './Panel';
import { BotonReporte } from './BotonReporte';
import { Reportes } from './Reportes';
import { esDesarrollador } from '../../../amplify/functions/shared/reportes';
import { Administradores } from './Administradores';
import { Condominios } from './Condominios';
import { FinanzasAdmin } from './FinanzasAdmin';
import { ComunicadosAdmin, EncuestasAdmin, ChatAdmin } from './Comunicacion';
import { IncidentesAdmin, MantenimientosAdmin, AmenidadesAdmin, VisitasAdmin, MascotasAdmin } from './Operacion';
import { ResidentesRapido } from './ResidentesRapido';
import { CampanaAdmin } from './CampanaAdmin';
import { Actividad } from './Actividad';
import { AvisoSuspendido } from './EstadoCondominio';
import { ProveedoresAdmin } from './Proveedores';
import { CotizacionesAdmin } from './Cotizaciones';

export type Condominio = Schema['Condominio']['type'];
export type Unidad = Schema['Unidad']['type'];

type Ctx = {
  condos: Condominio[];
  condo: Condominio | null;
  condoId: string;
  setCondoId: (id: string) => void;
  reloadCondos: () => void;
  unidades: Unidad[];
  reloadUnidades: () => void;
  etiqueta: (unidadId?: string | null) => string;
  yo: string;
  /** Nombre del administrador de la sesión (o su correo si no tiene nombre). */
  yoNombre: string;
  /** Cómo firma los reportes que descarga: «Nombre» o «Nombre (Superadmin)». */
  firmaReporte: string;
  /** Permisos del administrador (el superadministrador puede todo). */
  superadmin: boolean;
  puede: (seccion: string, nivel?: Nivel) => boolean;
  tiene: (extra: string) => boolean;
};
export type MisPermisos = { email: string; nombre?: string | null; superadmin: boolean; rol: string; permisos: Permisos; condominios: '*' | string[] };
const AdminCtx = createContext<Ctx>(null as unknown as Ctx);
export const useAdmin = () => useContext(AdminCtx);

export default function AdminApp() {
  return (
    <ToastProvider>
      <Acceso kicker="Administración" hideSignUp foot={<>Acceso exclusivo para administradores de SIIA.</>}>
        <SoloAdmin />
      </Acceso>
    </ToastProvider>
  );
}

function SoloAdmin() {
  const { signOut, user } = useAuthenticator((c) => [c.user]);
  const g = useLoad(grupos);
  const esAdmin = !!g.data?.some((x) => x === 'ADMIN' || x === 'SUPERADMIN');
  const mios = useLoad(() => (esAdmin ? adminCall<MisPermisos>('yo') : Promise.resolve(null)), [esAdmin]);
  if (g.loading || (esAdmin && mios.loading && !mios.data)) return <Loading />;
  if (esAdmin && mios.error)
    return (
      <div className="auth-screen">
        <div className="panel auth-card" style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.4rem' }}>Acceso restringido</h1>
          <p className="muted">{mios.error}</p>
          <button className="btn-app secondary" onClick={signOut}>
            Cerrar sesión
          </button>
        </div>
      </div>
    );
  if (!esAdmin || !mios.data)
    return (
      <div className="auth-screen">
        <div className="panel auth-card" style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.4rem' }}>Acceso restringido</h1>
          <p className="muted">Esta sección es solo para administradores. Si eres residente, entra al portal de residentes.</p>
          <div className="row-actions" style={{ justifyContent: 'center' }}>
            <a className="btn-app" href="/portal/">
              Ir al portal
            </a>
            <button className="btn-app secondary" onClick={signOut}>
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>
    );
  return <Admin yo={user?.signInDetails?.loginId ?? ''} mios={mios.data} />;
}

const SECCIONES: (NavItem & { global?: boolean; soloSuper?: boolean; soloDesarrollador?: boolean })[] = [
  { key: 'panel', label: 'Panel', icon: 'home' },
  { key: 'administradores', label: 'Administradores', icon: 'shield', global: true, soloSuper: true },
  { key: 'condominios', label: 'Condominios', icon: 'building', global: true },
  { key: 'cotizaciones', label: 'Cotizaciones', icon: 'inbox', global: true },
  { key: 'finanzas', label: 'Finanzas', icon: 'money' },
  { key: 'comunicados', label: 'Comunicados', icon: 'megaphone' },
  { key: 'encuestas', label: 'Encuestas', icon: 'vote' },
  { key: 'chat', label: 'Chat', icon: 'chat' },
  { key: 'incidentes', label: 'Incidentes', icon: 'alert' },
  { key: 'mantenimientos', label: 'Mantenimientos', icon: 'tools' },
  { key: 'amenidades', label: 'Amenidades', icon: 'calendar' },
  { key: 'visitas', label: 'Visitas', icon: 'qr' },
  { key: 'mascotas', label: 'Mascotas', icon: 'paw' },
  { key: 'proveedores', label: 'Proveedores', icon: 'package' },
  { key: 'actividad', label: 'Actividad', icon: 'clock', soloSuper: true },
  { key: 'reportes', label: 'Reportes y mejoras', icon: 'flag', global: true, soloDesarrollador: true },
];

const LS = 'siia-admin-condo';

function Admin({ yo, mios }: { yo: string; mios: MisPermisos }) {
  const [cur, go] = useHashNav('panel');
  const puede = (seccion: string, nivel: Nivel = 'ver') => mios.superadmin || alcanza(mios.permisos.secciones[seccion], nivel);
  const tiene = (extra: string) => mios.superadmin || mios.permisos.extras.includes(extra);
  // Condominios incluye a sus residentes: lo ve quien tenga acceso a condominios o a usuarios.
  const visible = (k: string) => k === 'panel' || puede(k) || (k === 'condominios' && puede('usuarios'));
  // El desarrollador (Gared) atiende los reportes y no ve el botón flotante; los demás administradores sí.
  const desarrollador = esDesarrollador(mios.email);
  const secciones = SECCIONES.filter((s) => (s.soloDesarrollador ? desarrollador : s.soloSuper ? mios.superadmin : visible(s.key)));
  const condos = useLoad(() => all<Condominio>((o) => db.models.Condominio.list(o)));
  // Una notificación push abre /admin/?c=<condominio>#/sección: ese condominio queda seleccionado.
  const [condoId, setCondoIdState] = useState<string>(() => {
    const desdeAviso = new URLSearchParams(location.search).get('c');
    try {
      if (desdeAviso) localStorage.setItem(LS, desdeAviso);
      return desdeAviso ?? localStorage.getItem(LS) ?? '';
    } catch {
      return desdeAviso ?? '';
    }
  });
  // Al entrar (o recargar) siempre se abre el Panel; una notificación push (?c=…) sí abre su sección.
  useEffect(() => {
    // ?abrir=1: un aviso que lleva a una sección global (p. ej. Reportes y mejoras) sin cambiar de condominio.
    const q = new URLSearchParams(location.search);
    if (!q.get('c') && !q.get('abrir')) go('panel');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (location.search) history.replaceState(null, '', location.pathname + location.hash);
  }, []);
  const setCondoId = (id: string) => {
    setCondoIdState(id);
    try {
      localStorage.setItem(LS, id);
    } catch {
      /* sin almacenamiento local */
    }
  };
  const lista = useMemo(() => [...(condos.data ?? [])].sort((a, b) => a.nombre.localeCompare(b.nombre)), [condos.data]);
  const condo = lista.find((c) => c.id === condoId) ?? null;
  // Condominio suspendido: sus administradores no pueden trabajarlo (admin-api lo rechaza); el superadministrador sí.
  const bloqueado = !!condo?.suspendido && !mios.superadmin;

  useEffect(() => {
    if (condos.data && !condo && lista.length) setCondoId(lista[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condos.data]);

  const unidades = useLoad(
    () => (condo && !bloqueado ? all<Unidad>((o) => db.models.Unidad.unidadesPorCondominio({ condominioId: condo.id }, o)) : Promise.resolve([])),
    [condo?.id, bloqueado],
  );
  const unidadesOrden = useMemo(
    () => [...(unidades.data ?? [])].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es', { numeric: true })),
    [unidades.data],
  );

  const ctx: Ctx = {
    condos: lista,
    condo,
    condoId: condo?.id ?? '',
    setCondoId,
    reloadCondos: () => condos.reload(true),
    unidades: unidadesOrden,
    reloadUnidades: () => unidades.reload(true),
    etiqueta: (id) => unidadesOrden.find((u) => u.id === id)?.etiqueta ?? '—',
    yo,
    yoNombre: mios.nombre || mios.email || yo,
    firmaReporte: `${mios.nombre || mios.email || yo}${mios.superadmin ? ' (Superadmin)' : ''}`,
    superadmin: mios.superadmin,
    puede,
    tiene,
  };

  // Conversaciones del condominio cuyo último mensaje es de un residente (menú Chat; el icono de la app lleva el número de la campana)
  const veChat = !!condo && !bloqueado && puede('chat');
  const mensajes = useLoad(
    () => (veChat ? all<Mensaje>((o) => db.models.Mensaje.mensajesPorCondominio({ condominioId: condo!.id }, o)) : Promise.resolve([])),
    [condo?.id, veChat],
  );
  usePoll(() => mensajes.reload(true), 30000, veChat);
  const chatPorResponder = useMemo(() => porResponder(mensajes.data ?? [], 'ADMIN'), [mensajes.data]);
  const nav = secciones.map((s) => (s.key === 'chat' ? { ...s, count: chatPorResponder } : s));

  // «sección/subsección» abre una parte concreta (p. ej. condominios/residentes, acceso directo desde el Panel).
  const [base, sub] = cur.split('/');
  // «residentes»: lista rápida del Panel (chat y contraseña); se muestra dentro de Panel.
  const rapido = base === 'residentes' && puede('usuarios');
  const actual = secciones.some((s) => s.key === base) ? base : 'panel';
  const sec = secciones.find((s) => s.key === actual)!;
  const necesitaCondo = !sec.global && !condo;

  return (
    <AdminCtx.Provider value={ctx}>
      <Shell
        api="admin"
        nav={nav}
        current={actual}
        onNav={go}
        title="Administración SIIA"
        subtitle={condo?.nombre ?? 'Sin condominio seleccionado'}
        user={`${yo} · ${mios.rol}`}
        actions={((condo && !bloqueado) || puede('cotizaciones')) && <CampanaAdmin go={go} mensajes={veChat ? (mensajes.data ?? []) : []} />}
      >
        {condos.error && <ErrorBox error={condos.error} retry={condos.reload} />}
        {!sec.global && lista.length > 0 && (
          <div className="panel" style={{ padding: '10px 14px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <Field label="Condominio">
              <select value={condo?.id ?? ''} onChange={(e) => setCondoId(e.target.value)} style={{ minWidth: 240 }}>
                {lista.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre} {c.suspendido ? '(suspendido)' : c.activo === false ? '(inactivo)' : ''}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
        {condos.loading && !condos.data ? (
          <Loading />
        ) : necesitaCondo ? (
          <div className="panel">
            {tiene('condominios.alta') ? (
              <>
                <p style={{ margin: '0 0 12px' }}>Primero da de alta un condominio para administrar sus servicios.</p>
                <button className="btn-app" onClick={() => go('condominios')}>
                  <Icon name="plus" />
                  Dar de alta condominio
                </button>
              </>
            ) : (
              <p style={{ margin: 0 }}>Aún no tienes condominios asignados. Pide al superadministrador que te asigne uno.</p>
            )}
          </div>
        ) : bloqueado && !sec.global ? (
          <AvisoSuspendido c={condo!} />
        ) : (
          <>
            {!sec.global && condo?.suspendido && (
              <div style={{ marginBottom: 16 }}>
                <AvisoSuspendido c={condo} />
              </div>
            )}
            {actual === 'panel' && (rapido ? <ResidentesRapido go={go} /> : <Panel go={go} />)}
            {actual === 'administradores' && <Administradores />}
            {actual === 'actividad' && <Actividad />}
            {actual === 'reportes' && <Reportes />}
            {actual === 'condominios' && <Condominios key={cur} inicio={sub === 'residentes' ? 'residentes' : undefined} />}
            {actual === 'finanzas' && <FinanzasAdmin key={cur} inicio={sub === 'revision' ? 'revision' : undefined} />}
            {actual === 'comunicados' && <ComunicadosAdmin />}
            {actual === 'encuestas' && <EncuestasAdmin />}
            {actual === 'chat' && <ChatAdmin key={cur} inicial={sub} onCambio={() => mensajes.reload(true)} />}
            {actual === 'incidentes' && <IncidentesAdmin />}
            {actual === 'mantenimientos' && <MantenimientosAdmin />}
            {actual === 'amenidades' && <AmenidadesAdmin />}
            {actual === 'visitas' && <VisitasAdmin />}
            {actual === 'mascotas' && <MascotasAdmin />}
            {actual === 'proveedores' && <ProveedoresAdmin />}
            {actual === 'cotizaciones' && <CotizacionesAdmin key={cur} abrir={sub} />}
          </>
        )}
        {!desarrollador && <BotonReporte seccion={sec.label} />}
      </Shell>
    </AdminCtx.Provider>
  );
}

type Mensaje = Schema['Mensaje']['type'];

/** Hilos de un canal cuyo último mensaje es de un residente (pendientes de respuesta). */
export function porResponder(mensajes: { unidadId: string; canal?: string | null; autorRol?: string | null; createdAt: string }[], canal: string) {
  const ultimo = new Map<string, { autorRol?: string | null; createdAt: string }>();
  for (const m of mensajes) {
    if (m.canal !== canal) continue;
    const u = ultimo.get(m.unidadId);
    if (!u || m.createdAt > u.createdAt) ultimo.set(m.unidadId, m);
  }
  return [...ultimo.values()].filter((m) => m.autorRol === 'RESIDENTE').length;
}

/** Aviso de que un módulo no está habilitado para el condominio seleccionado. */
export function ModuloInactivo({ modulo }: { modulo: string }) {
  const { condo } = useAdmin();
  if ((condo?.modulos ?? []).includes(modulo)) return null;
  return (
    <div className="alert" style={{ marginBottom: 16 }}>
      Este servicio no está habilitado para {condo?.nombre}. Los residentes no lo verán hasta que lo actives en Condominios › Servicios del portal.
    </div>
  );
}
