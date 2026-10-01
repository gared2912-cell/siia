// /admin — panel exclusivo del grupo ADMIN de Cognito. AppSync rechaza cualquier operación
// de otro usuario; aquí además se bloquea la interfaz si la sesión no pertenece al grupo.
import { useAuthenticator } from '@aws-amplify/ui-react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { all, client, grupos, type Schema } from '../api';
import { Acceso, Shell, useHashNav, type NavItem } from '../Shell';
import { ErrorBox, Field, Icon, Loading, ToastProvider, useLoad } from '../ui';
import { Panel } from './Panel';
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
};
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
  if (g.loading) return <Loading />;
  if (!g.data?.includes('ADMIN'))
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
  return <Admin yo={user?.signInDetails?.loginId ?? ''} />;
}

const SECCIONES: (NavItem & { global?: boolean })[] = [
  { key: 'panel', label: 'Panel', icon: 'home' },
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

function Admin({ yo }: { yo: string }) {
  const [cur, go] = useHashNav('panel');
  const condos = useLoad(() => all<Condominio>((o) => client.models.Condominio.list(o)));
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
    () => (condo ? all<Unidad>((o) => client.models.Unidad.unidadesPorCondominio({ condominioId: condo.id }, o)) : Promise.resolve([])),
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
  };

  const actual = SECCIONES.some((s) => s.key === cur) ? cur : 'panel';
  const sec = SECCIONES.find((s) => s.key === actual)!;
  const necesitaCondo = !sec.global && !condo;

  return (
    <AdminCtx.Provider value={ctx}>
      <Shell nav={SECCIONES} current={actual} onNav={go} title="Administración SIIA" subtitle={condo?.nombre ?? 'Sin condominio seleccionado'} user={yo}>
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
            <p style={{ margin: '0 0 12px' }}>Primero da de alta un condominio para administrar sus servicios.</p>
            <button className="btn-app" onClick={() => go('condominios')}>
              <Icon name="plus" />
              Dar de alta condominio
            </button>
          </div>
        ) : (
          <>
            {actual === 'panel' && <Panel go={go} />}
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
