// Pantalla de acceso (Cognito) y estructura común con menú lateral / barra inferior.
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from './ui';
import { camposAcceso } from './camposAcceso';
import { AppYNotificaciones, SugerenciaApp, bajaDeEsteDispositivo, useSincronizarPush, type ApiApp } from './AppMovil';

export function Acceso({
  kicker,
  hideSignUp,
  foot,
  children,
}: {
  kicker: string;
  hideSignUp?: boolean;
  foot?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Authenticator.Provider>
      <Puerta kicker={kicker} hideSignUp={hideSignUp} foot={foot}>
        {children}
      </Puerta>
    </Authenticator.Provider>
  );
}

function Puerta({ kicker, hideSignUp, foot, children }: { kicker: string; hideSignUp?: boolean; foot?: ReactNode; children: ReactNode }) {
  const { authStatus } = useAuthenticator((c) => [c.authStatus]);
  if (authStatus === 'authenticated') return <>{children}</>;
  if (authStatus === 'configuring') return null;
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <a href="/" aria-label="Ir al sitio de SIIA">
            <img src="/marca/siia-vertical.svg" alt="SIIA · soluciones inmobiliarias" />
          </a>
          <span className="auth-kicker">{kicker}</span>
        </div>
        <Authenticator
          hideSignUp={hideSignUp}
          loginMechanisms={['email']}
          formFields={camposAcceso}
        />
        {foot && <div className="auth-foot">{foot}</div>}
      </div>
    </div>
  );
}

export type NavItem = { key: string; label: string; icon: string; count?: number };

export function Shell({
  nav,
  current,
  onNav,
  title,
  subtitle,
  user,
  actions,
  api,
  children,
}: {
  nav: NavItem[];
  current: string;
  onNav: (key: string) => void;
  title: string;
  subtitle?: string;
  user?: string;
  actions?: ReactNode;
  /** API de la app (portal o panel) para la instalación y las notificaciones push. */
  api: ApiApp;
  children: ReactNode;
}) {
  const { signOut: salir } = useAuthenticator((c) => [c.user]);
  const [appAbierta, setAppAbierta] = useState(false);
  useSincronizarPush(api);
  // Cerrar sesión también da de baja las notificaciones de este dispositivo.
  const signOut = () => {
    bajaDeEsteDispositivo(api).finally(salir);
  };
  const abrirApp = () => setAppAbierta(true);
  const go = (k: string) => {
    onNav(k);
    window.scrollTo({ top: 0 });
  };
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img src="/marca/siia-horizontal-blanco.svg" alt="SIIA · soluciones inmobiliarias" />
        </div>
        <ul className="navlist">
          {nav.map((n) => (
            <li key={n.key}>
              <button aria-current={current === n.key ? 'page' : undefined} onClick={() => go(n.key)}>
                <Icon name={n.icon} />
                {n.label}
                {!!n.count && <span className="nav-count">{n.count}</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="sidebar-foot">
          <button className="linklike" style={{ color: 'var(--mint)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }} onClick={abrirApp}>
            <Icon name="phone" />
            App y notificaciones
          </button>
          {user && <strong>{user}</strong>}
          <button className="linklike" style={{ color: 'var(--mint)', marginTop: 8 }} onClick={signOut}>
            Cerrar sesión
          </button>
        </div>
      </aside>
      <div className="shell-body">
        <header className="topbar">
          <img className="topbar-logo" src="/favicon.svg" alt="SIIA" />
          <div className="topbar-title">
            <strong>{title}</strong>
            {subtitle && <span>{subtitle}</span>}
          </div>
          <div className="topbar-actions">
            {actions}
            <button className="icon-btn" onClick={abrirApp} aria-label="App y notificaciones" title="App y notificaciones">
              <Icon name="phone" />
            </button>
            <button className="icon-btn" onClick={signOut} aria-label="Cerrar sesión" title="Cerrar sesión">
              <Icon name="logout" />
            </button>
          </div>
        </header>
        <main className="main">
          <SugerenciaApp abrir={abrirApp} />
          {children}
        </main>
      </div>
      <Tabbar nav={nav} current={current} go={go} user={user} signOut={signOut} />
      {appAbierta && <AppYNotificaciones api={api} onClose={() => setAppAbierta(false)} />}
    </div>
  );
}

/** Barra inferior para móvil: hasta 5 botones; si hay más secciones, las 4 primeras + «Más» (hoja con todas). */
function Tabbar({ nav, current, go, user, signOut }: { nav: NavItem[]; current: string; go: (k: string) => void; user?: string; signOut: () => void }) {
  const [mas, setMas] = useState(false);
  const cabe = nav.length <= 5;
  const visibles = cabe ? nav : nav.slice(0, 4);
  const enMas = !cabe && !visibles.some((n) => n.key === current);
  const pendientesMas = cabe ? 0 : nav.slice(4).reduce((s, n) => s + (n.count ?? 0), 0);

  useEffect(() => {
    if (!mas) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMas(false);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [mas]);

  const boton = (n: NavItem) => (
    <button key={n.key} aria-current={current === n.key ? 'page' : undefined} onClick={() => (setMas(false), go(n.key))}>
      <Icon name={n.icon} />
      <span className="tab-label">{n.label}</span>
      {!!n.count && <span className="nav-count">{n.count}</span>}
    </button>
  );

  return (
    <>
      <nav className="tabbar" aria-label="Secciones">
        {visibles.map(boton)}
        {!cabe && (
          <button aria-current={enMas ? 'page' : undefined} aria-expanded={mas} onClick={() => setMas(!mas)}>
            <Icon name="menu" />
            <span className="tab-label">Más</span>
            {!!pendientesMas && <span className="nav-count">{pendientesMas}</span>}
          </button>
        )}
      </nav>
      {mas && (
        <div className="sheet-bg" onMouseDown={(e) => e.target === e.currentTarget && setMas(false)}>
          <div className="sheet" role="dialog" aria-label="Todas las secciones">
            <div className="sheet-handle" />
            <div className="sheet-grid">{nav.map(boton)}</div>
            <div className="sheet-foot">
              {user && <span className="small muted">{user}</span>}
              <button className="btn-app sm secondary" onClick={signOut}>
                <Icon name="logout" />
                Cerrar sesión
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Sección actual en el hash (#finanzas) para que atrás/adelante y recargar funcionen. */
export function useHashNav(def: string): [string, (k: string) => void] {
  const read = () => decodeURIComponent(location.hash.replace(/^#\/?/, '')) || def;
  const [cur, setCur] = useState(read);
  useEffect(() => {
    const on = () => setCur(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [cur, (k: string) => (location.hash = `/${k}`)];
}
