// Inicio de sesión del portal directamente en la página pública «Acceso a residentes»:
// al entrar (o si ya hay sesión) lleva a /portal/ sin pasos intermedios.
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import './amplify-auth.css';
import './api';
import { useEffect } from 'react';
import { camposAcceso } from './camposAcceso';
import { SesionLista } from './sesion';

const PORTAL = '/portal/';

function AlPortal() {
  const { authStatus } = useAuthenticator((c) => [c.authStatus]);
  useEffect(() => {
    if (authStatus === 'authenticated') window.location.replace(PORTAL);
  }, [authStatus]);
  return null;
}

export default function LoginResidentes() {
  return (
    <SesionLista espera={<p className="login-res__entrando">Conectando…</p>}>
      <Authenticator.Provider>
        <AlPortal />
        <Authenticator hideSignUp loginMechanisms={['email']} formFields={camposAcceso}>
          {() => <p className="login-res__entrando">Entrando al portal…</p>}
        </Authenticator>
      </Authenticator.Provider>
    </SesionLista>
  );
}
