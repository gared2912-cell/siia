// La sesión solo se cierra con «Cerrar sesión» (o cuando la administración la invalida: suspensión,
// cambio de rol, de correo o de contraseña). Cognito da el token de renovación a 10 años, pero cada
// 60 min Amplify renueva el acceso y el Authenticator cierra la sesión ante CUALQUIER falla de esa
// renovación que no se llame NetworkError (petición abortada al congelar el teléfono la pestaña,
// 429/5xx de Cognito, respuesta cortada…). Aquí esas fallas pasajeras se reintentan y, si persisten,
// se reportan como NetworkError: se conservan los tokens y el siguiente uso vuelve a intentar.
import { AuthError } from 'aws-amplify/auth';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';
import { useEffect, useState, type ReactNode } from 'react';

const orquestador = cognitoUserPoolsTokenProvider.tokenOrchestrator;

// Errores que sí significan que la sesión ya no vale (los mismos con que Amplify borra los tokens).
const DEFINITIVOS = [
  'NotAuthorizedException',
  'TokenRevokedException',
  'UserNotFoundException',
  'PasswordResetRequiredException',
  'UserNotConfirmedException',
  'RefreshTokenReuseException',
];
export const esDefinitivo = (e: unknown) => DEFINITIVOS.some((n) => String((e as Error)?.name ?? '').startsWith(n));

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

const renovar = orquestador.getTokenRefresher();
orquestador.setTokenRefresher(async (args) => {
  let ultimo: unknown;
  for (let i = 0; i < 3; i++) {
    if (i) await pausa(1000 * 2 ** i);
    try {
      return await renovar(args);
    } catch (e) {
      if (esDefinitivo(e)) throw e;
      ultimo = e;
    }
  }
  throw new AuthError({ name: 'NetworkError', message: 'No se pudo renovar la sesión; se reintentará.', underlyingError: ultimo });
});

/**
 * Antes de montar el Authenticator: si hay una sesión guardada, la deja vigente. Mientras la renovación
 * falle por conexión sigue reintentando, para no mostrar el formulario de acceso a quien ya inició sesión.
 * Termina cuando la sesión es válida, cuando no hay sesión o cuando Cognito la rechaza de forma definitiva.
 */
export async function esperarSesion(): Promise<void> {
  for (let i = 0; ; i++) {
    const guardados = await orquestador.getTokenStore().loadTokens().catch(() => null);
    if (!guardados) return;
    try {
      await orquestador.getTokens();
      return;
    } catch (e) {
      if (esDefinitivo(e)) return;
      await Promise.race([pausa(Math.min(15000, 1000 * 2 ** i)), new Promise((r) => globalThis.addEventListener?.('online', r, { once: true }))]);
    }
  }
}

/** Monta su contenido (el Authenticator) hasta que `esperarSesion` termina. */
export function SesionLista({ children, espera }: { children: ReactNode; espera?: ReactNode }) {
  const [lista, setLista] = useState(false);
  const [lento, setLento] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLento(true), 1500);
    esperarSesion().finally(() => {
      clearTimeout(t);
      setLista(true);
    });
    return () => clearTimeout(t);
  }, []);
  if (lista) return <>{children}</>;
  return lento ? <>{espera}</> : null;
}
