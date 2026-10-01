// /portal — residentes y vigilantes. El acceso real lo decide la Lambda portal-api:
// sin aprobación de la administración no se muestra ningún dato.
import { useAuthenticator } from '@aws-amplify/ui-react';
import { portal } from '../api';
import { Acceso, Shell, useHashNav, type NavItem } from '../Shell';
import { ErrorBox, Icon, Loading, ToastProvider, useLoad } from '../ui';
import { AvisosProvider, Campana, useAvisos } from './Notificaciones';
import CasetaApp from '../caseta/CasetaApp';
import { Inicio } from './Inicio';
import { Finanzas } from './Finanzas';
import { Visitas } from './Visitas';
import { Comunicados } from './Comunicados';
import { Chat } from './Chat';
import { Incidentes } from './Incidentes';
import { Amenidades } from './Amenidades';
import { Mascotas } from './Mascotas';

export type PerfilResp = {
  email: string;
  perfil: null | {
    userId: string;
    nombre?: string;
    email: string;
    rol: 'ADMIN' | 'RESIDENTE' | 'VIGILANTE';
    estado: 'PENDIENTE' | 'APROBADO' | 'RECHAZADO' | 'SUSPENDIDO';
    unidadSolicitada?: string;
    nota?: string;
  };
  condominio?: { id: string; nombre: string; modulos: string[]; datosPago?: string; telefonoCaseta?: string } | null;
  unidad?: { id: string; etiqueta: string; cuota?: number } | null;
};

export default function PortalApp() {
  return (
    <ToastProvider>
      <Acceso
        kicker="Portal de residentes"
        hideSignUp
        foot={
          <>
            Tus accesos te los envía por correo la administración de tu condominio. ¿No los recibiste o vencieron? Pídele que te
            reenvíe tu acceso. <a href="/portal-residentes/">Más información</a>
          </>
        }
      >
        <Portal />
      </Acceso>
    </ToastProvider>
  );
}

function Portal() {
  const { data, error, loading, reload } = useLoad(() => portal<PerfilResp>('perfil'));
  if (loading && !data) return <Loading />;
  if (error && !data) return <Centro><ErrorBox error={error} retry={reload} /></Centro>;
  const r = data!;
  const perfil = r.perfil;

  if (!perfil || perfil.estado === 'RECHAZADO')
    return (
      <Estado icon="alert" titulo="Tu cuenta no tiene acceso al portal">
        {perfil?.nota && <>{perfil.nota} </>}Comunícate con la administración de tu condominio para que te dé de alta.
      </Estado>
    );
  if (perfil.estado === 'PENDIENTE')
    return (
      <Estado icon="shield" titulo="Tu acceso está en revisión" recargar={reload}>
        La administración de <strong>{r.condominio?.nombre}</strong> está validando tu acceso
        {perfil.unidadSolicitada && (
          <>
            {' '}
            para <strong>{perfil.unidadSolicitada}</strong>
          </>
        )}
        . Puedes volver a entrar más tarde.
      </Estado>
    );
  if (perfil.estado === 'SUSPENDIDO')
    return (
      <Estado icon="alert" titulo="Tu acceso está suspendido">
        Comunícate con la administración de tu condominio.
      </Estado>
    );
  if (perfil.rol === 'ADMIN')
    return (
      <Estado icon="settings" titulo="Cuenta de administración">
        Tu cuenta es de administrador. <a href="/admin/">Ir al panel de administración</a>
      </Estado>
    );
  if (!r.condominio)
    return (
      <Estado icon="alert" titulo="Sin condominio asignado">
        La administración aún no asigna tu condominio.
      </Estado>
    );
  if (perfil.rol === 'VIGILANTE') return <CasetaApp perfil={r} />;
  if (!r.unidad)
    return (
      <Estado icon="alert" titulo="Sin unidad asignada">
        La administración aún no asigna tu casa o departamento.
      </Estado>
    );
  return <Residente perfil={r} />;
}

function Centro({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-screen">
      <div className="auth-card">{children}</div>
    </div>
  );
}

function Estado({ icon, titulo, children, recargar }: { icon: string; titulo: string; children: React.ReactNode; recargar?: () => void }) {
  const { signOut } = useAuthenticator((c) => [c.user]);
  return (
    <Centro>
      <div className="panel" style={{ textAlign: 'center', padding: 28 }}>
        <div className="tile-icon" style={{ margin: '0 auto 12px' }}>
          <Icon name={icon} />
        </div>
        <h1 style={{ fontSize: '1.4rem' }}>{titulo}</h1>
        <p className="muted">{children}</p>
        <div className="row-actions" style={{ justifyContent: 'center' }}>
          {recargar && (
            <button className="btn-app secondary" onClick={recargar}>
              <Icon name="refresh" />
              Actualizar
            </button>
          )}
          <button className="btn-app secondary" onClick={signOut}>
            <Icon name="logout" />
            Cerrar sesión
          </button>
        </div>
      </div>
    </Centro>
  );
}

// ---------- App del residente ----------
function Residente({ perfil }: { perfil: PerfilResp }) {
  return (
    <AvisosProvider>
      <AppResidente perfil={perfil} />
    </AvisosProvider>
  );
}

function AppResidente({ perfil }: { perfil: PerfilResp }) {
  const mods = perfil.condominio!.modulos ?? [];
  const has = (m: string) => mods.includes(m);
  const [cur, go] = useHashNav('inicio');
  const { sinLeer } = useAvisos();

  const nav: NavItem[] = [
    { key: 'inicio', label: 'Inicio', icon: 'home', count: sinLeer },
    ...(has('finanzas') ? [{ key: 'finanzas', label: 'Finanzas', icon: 'money' }] : []),
    ...(has('visitas') ? [{ key: 'visitas', label: 'Visitas', icon: 'qr' }] : []),
    ...(has('amenidades') ? [{ key: 'amenidades', label: 'Reservas', icon: 'calendar' }] : []),
    ...(has('incidentes') || has('mantenimientos') ? [{ key: 'incidentes', label: 'Incidentes', icon: 'alert' }] : []),
    ...(has('comunicados') || has('encuestas') ? [{ key: 'comunicados', label: 'Comunicados', icon: 'megaphone' }] : []),
    ...(has('chat') ? [{ key: 'chat', label: 'Chat', icon: 'chat' }] : []),
    ...(has('mascotas') ? [{ key: 'mascotas', label: 'Mascotas', icon: 'paw' }] : []),
  ];
  const actual = nav.some((n) => n.key === cur) ? cur : 'inicio';
  const props = { perfil, go, has };

  return (
    <Shell
      nav={nav}
      current={actual}
      onNav={go}
      title={perfil.condominio!.nombre}
      subtitle={`${perfil.unidad!.etiqueta} · ${perfil.perfil!.nombre ?? perfil.email}`}
      user={perfil.email}
      actions={<Campana />}
    >
      {actual === 'inicio' && <Inicio {...props} />}
      {actual === 'finanzas' && <Finanzas {...props} />}
      {actual === 'visitas' && <Visitas {...props} />}
      {actual === 'amenidades' && <Amenidades {...props} />}
      {actual === 'incidentes' && <Incidentes {...props} />}
      {actual === 'comunicados' && <Comunicados {...props} />}
      {actual === 'chat' && <Chat {...props} />}
      {actual === 'mascotas' && <Mascotas {...props} />}
      {nav.length === 1 && (
        <div className="alert" style={{ marginTop: 16 }}>
          La administración aún no habilita servicios para tu condominio. Aparecerán aquí conforme se autoricen.
        </div>
      )}
    </Shell>
  );
}

export type ModProps = { perfil: PerfilResp; go: (k: string) => void; has: (m: string) => boolean };
