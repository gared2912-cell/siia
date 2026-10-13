// /admin — panel de los grupos SUPERADMIN y ADMIN de Cognito. admin-api aplica los permisos del rol
// de administración y los condominios asignados; aquí solo se muestra lo que el usuario puede usar.
import { useAuthenticator } from '@aws-amplify/ui-react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { adminCall, all, db, grupos, type Schema } from '../api';
import { alcanza, type Nivel, type Permisos } from '../../../amplify/functions/shared/permisos';
import { Acceso, Shell, useHashNav, type NavItem } from '../Shell';
import { ErrorBox, Field, Icon, Loading, ToastProvider, useLoad } from '../ui';
import { Panel } from './Panel';
import { Administradores } from './Administradores';
import { Condominios } from './Condominios';
import { Usuarios } from './Usuarios';
import { FinanzasAdmin } from './FinanzasAdmin';
import { ComunicadosAdmin, EncuestasAdmin, ChatAdmin } from './Comunicacion';
import { IncidentesAdmin, MantenimientosAdmin, AmenidadesAdmin, VisitasAdmin, MascotasAdmin } from './Operacion';

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
  /** Permisos del administrador (el superadministrador puede todo). */
  superadmin: boolean;
  puede: (seccion: string, nivel?: Nivel) => boolean;
  tiene: (extra: string) => boolean;
};
export type MisPermisos = { email: string; superadmin: boolean; rol: string; permisos: Permisos; condominios: '*' | string[] };
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

const SECCIONES: (NavItem & { global?: boolean; soloSuper?: boolean })[] = [
  { key: 'panel', label: 'Panel', icon: 'home' },
  { key: 'administradores', label: 'Administradores', icon: 'shield', global: true, soloSuper: true },
  { key: 'condominios', label: 'Condominios', icon: 'building', global: true },
  { key: 'usuarios', label: 'Usuarios', icon: 'users', global: true },
  { key: 'finanzas', label: 'Finanzas', icon: 'money' },
  { key: 'comunicados', label: 'Comunicados', icon: 'megaphone' },
  { key: 'encuestas', label: 'Encuestas', icon: 'vote' },
  { key: 'chat', label: 'Chat', icon: 'chat' },
  { key: 'incidentes', label: 'Incidentes', icon: 'alert' },
  { key: 'mantenimientos', label: 'Mantenimientos', icon: 'tools' },
  { key: 'amenidades', label: 'Amenidades', icon: 'calendar' },
  { key: 'visitas', label: 'Visitas', icon: 'qr' },
  { key: 'mascotas', label: 'Mascotas', icon: 'paw' },
];

const LS = 'siia-admin-condo';

function Admin({ yo, mios }: { yo: string; mios: MisPermisos }) {
  const [cur, go] = useHashNav('panel');
  const puede = (seccion: string, nivel: Nivel = 'ver') => mios.superadmin || alcanza(mios.permisos.secciones[seccion], nivel);
  const tiene = (extra: string) => mios.superadmin || mios.permisos.extras.includes(extra);
  const secciones = SECCIONES.filter((s) => (s.soloSuper ? mios.superadmin : s.key === 'panel' || puede(s.key)));
  const condos = useLoad(() => all<Condominio>((o) => db.models.Condominio.list(o)));
  const [condoId, setCondoIdState] = useState<string>(() => {
    try {
      return localStorage.getItem(LS) ?? '';
    } catch {
      return '';
    }
  });
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

  useEffect(() => {
    if (condos.data && !condo && lista.length) setCondoId(lista[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condos.data]);

  const unidades = useLoad(
    () => (condo ? all<Unidad>((o) => db.models.Unidad.unidadesPorCondominio({ condominioId: condo.id }, o)) : Promise.resolve([])),
    [condo?.id],
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
    superadmin: mios.superadmin,
    puede,
    tiene,
  };

  const actual = secciones.some((s) => s.key === cur) ? cur : 'panel';
  const sec = secciones.find((s) => s.key === actual)!;
  const necesitaCondo = !sec.global && !condo;

  return (
    <AdminCtx.Provider value={ctx}>
      <Shell
        api="admin"
        nav={secciones}
        current={actual}
        onNav={go}
        title="Administración SIIA"
        subtitle={condo?.nombre ?? 'Sin condominio seleccionado'}
        user={`${yo} · ${mios.rol}`}
      >
        {condos.error && <ErrorBox error={condos.error} retry={condos.reload} />}
        {!sec.global && lista.length > 0 && (
          <div className="panel" style={{ padding: '10px 14px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <Field label="Condominio">
              <select value={condo?.id ?? ''} onChange={(e) => setCondoId(e.target.value)} style={{ minWidth: 240 }}>
                {lista.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre} {c.activo === false ? '(inactivo)' : ''}
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
        ) : (
          <>
            {actual === 'panel' && <Panel go={go} />}
            {actual === 'administradores' && <Administradores />}
            {actual === 'condominios' && <Condominios />}
            {actual === 'usuarios' && <Usuarios />}
            {actual === 'finanzas' && <FinanzasAdmin />}
            {actual === 'comunicados' && <ComunicadosAdmin />}
            {actual === 'encuestas' && <EncuestasAdmin />}
            {actual === 'chat' && <ChatAdmin />}
            {actual === 'incidentes' && <IncidentesAdmin />}
            {actual === 'mantenimientos' && <MantenimientosAdmin />}
            {actual === 'amenidades' && <AmenidadesAdmin />}
            {actual === 'visitas' && <VisitasAdmin />}
            {actual === 'mascotas' && <MascotasAdmin />}
          </>
        )}
      </Shell>
    </AdminCtx.Provider>
  );
}

/** Aviso de que un módulo no está habilitado para el condominio seleccionado. */
export function ModuloInactivo({ modulo }: { modulo: string }) {
  const { condo } = useAdmin();
  if ((condo?.modulos ?? []).includes(modulo)) return null;
  return (
    <div className="alert" style={{ marginBottom: 16 }}>
      Este servicio no está habilitado para {condo?.nombre}. Los residentes no lo verán hasta que lo actives en Condominios.
    </div>
  );
}
