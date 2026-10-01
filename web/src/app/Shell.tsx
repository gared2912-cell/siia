// Pantalla de acceso (Cognito) y estructura común con menú lateral / barra inferior.
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { useEffect, useState, type ReactNode } from 'react';
import logoBlanco from '../assets/marca/logo-siia-blanco.png';
import { Icon } from './ui';

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
            <img src="/logo-siia.png" alt="SIIA · Sistemas Integrales Inmobiliarios y de Administración" />
          </a>
          <span className="auth-kicker">{kicker}</span>
        </div>
        <Authenticator
          hideSignUp={hideSignUp}
          loginMechanisms={['email']}
          formFields={{
            signUp: {
              email: { order: 1, label: 'Correo electrónico', placeholder: 'tu@correo.com' },
              password: { order: 2, label: 'Contraseña', placeholder: 'Mínimo 8 caracteres, con símbolo' },
              confirm_password: { order: 3, label: 'Confirmar contraseña', placeholder: 'Repite tu contraseña' },
            },
            signIn: {
              username: { label: 'Correo electrónico', placeholder: 'tu@correo.com' },
              password: { label: 'Contraseña', placeholder: 'Tu contraseña' },
            },
          }}
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
  children,
}: {
  nav: NavItem[];
  current: string;
  onNav: (key: string) => void;
  title: string;
  subtitle?: string;
  user?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { signOut } = useAuthenticator((c) => [c.user]);
  const go = (k: string) => {
    onNav(k);
    window.scrollTo({ top: 0 });
  };
  return (
    <div className="shell">
      <aside className="sidebar">
        <img className="sidebar-logo" src={logoBlanco.src} alt="SIIA" />
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
          {user && <strong>{user}</strong>}
          <button className="linklike" style={{ color: 'var(--mint)', marginTop: 8 }} onClick={signOut}>
            Cerrar sesión
          </button>
        </div>
      </aside>
      <div>
        <header className="topbar">
          <img className="topbar-logo" src="/favicon.svg" alt="SIIA" />
          <div className="topbar-title">
            <strong>{title}</strong>
            {subtitle && <span>{subtitle}</span>}
          </div>
          <div className="topbar-actions">
            {actions}
            <button className="icon-btn" onClick={signOut} aria-label="Cerrar sesión" title="Cerrar sesión">
              <Icon name="logout" />
            </button>
          </div>
        </header>
        <main className="main">{children}</main>
      </div>
      <nav className="tabbar" aria-label="Secciones">
        {nav.map((n) => (
          <button key={n.key} aria-current={current === n.key ? 'page' : undefined} onClick={() => go(n.key)}>
            <Icon name={n.icon} />
            {n.label.split(' ')[0]}
            {!!n.count && <span className="nav-count">{n.count}</span>}
          </button>
        ))}
      </nav>
    </div>
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
