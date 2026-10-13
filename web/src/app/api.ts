// Cliente de Amplify para /portal y /admin.
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { fetchAuthSession } from 'aws-amplify/auth';
import { getUrl, uploadData } from 'aws-amplify/storage';
import { I18n } from 'aws-amplify/utils';
import { translations } from '@aws-amplify/ui-react';
import outputs from '../../amplify_outputs.json';
import type { Schema } from '../../amplify/data/resource';

Amplify.configure(outputs);
I18n.putVocabularies(translations);
I18n.setLanguage('es');
I18n.putVocabulariesForLanguage('es', {
  'Sign In': 'Iniciar sesión',
  'Sign in': 'Iniciar sesión',
  'Create Account': 'Crear cuenta',
  'Enter your Email': 'Correo electrónico',
  'Enter your email': 'Correo electrónico',
  'Enter your Password': 'Contraseña',
  'Please confirm your Password': 'Confirma tu contraseña',
  'Forgot your password?': '¿Olvidaste tu contraseña?',
  'Reset Password': 'Restablecer contraseña',
  'Send code': 'Enviar código',
  'Back to Sign In': 'Volver a iniciar sesión',
  'Change Password': 'Cambiar contraseña',
  'Incorrect username or password.': 'Correo o contraseña incorrectos.',
  'User does not exist.': 'Correo o contraseña incorrectos.',
  'User is disabled.': 'Tu cuenta está suspendida. Comunícate con la administración.',
  'Password must have at least 8 characters': 'La contraseña debe tener al menos 8 caracteres',
  'Password must have upper case letters': 'La contraseña debe tener mayúsculas',
  'Password must have lower case letters': 'La contraseña debe tener minúsculas',
  'Password must have numbers': 'La contraseña debe tener números',
  'Password must have special characters': 'La contraseña debe tener un símbolo (por ejemplo $ ! # ?)',
  'Your passwords must match': 'Las contraseñas no coinciden',
});

export const client = generateClient<Schema>();
export type { Schema };

type Kind = 'portal' | 'admin';

async function call<T = any>(kind: Kind, action: string, payload?: object): Promise<T> {
  const fn = kind === 'portal' ? client.mutations.portal : client.mutations.admin;
  const { data, errors } = await fn({ action, payload: JSON.stringify(payload ?? {}) });
  if (errors?.length) throw new Error(errors[0].message.includes('Not Authorized') ? 'No tienes permiso para esta acción.' : errors[0].message);
  // AWSJSON llega como texto; se decodifica hasta obtener el objeto.
  let r: any = data;
  for (let i = 0; i < 2 && typeof r === 'string'; i++) r = JSON.parse(r);
  if (r && typeof r === 'object' && 'error' in r && r.error) throw new Error(r.error);
  return r as T;
}

export const portal = <T = any>(action: string, payload?: object) => call<T>('portal', action, payload);
export const adminCall = <T = any>(action: string, payload?: object) => call<T>('admin', action, payload);

/**
 * Datos del panel /admin con la misma forma que `client.models` (list, create, update, delete y consultas
 * por índice), pero a través de admin-api, que aplica el rol y los condominios del administrador.
 */
export const db = {
  models: new Proxy({} as Record<string, unknown>, {
    get: (_, model: string) =>
      new Proxy({} as Record<string, unknown>, {
        get:
          (_x, op: string) =>
          async (arg?: Record<string, unknown>) => {
            try {
              const escritura = op === 'create' || op === 'update' || op === 'delete';
              const data = await adminCall('db', escritura ? { model, op, input: arg } : { model, op, args: arg });
              return escritura ? { data } : { data: data ?? [], nextToken: null };
            } catch (e) {
              return { data: null, errors: [{ message: e instanceof Error ? e.message : String(e) }] };
            }
          },
      }),
  }),
} as unknown as Pick<typeof client, 'models'>;

/** Lanza el primer error de una operación de AppSync. */
export function ok<T>(r: { data: T; errors?: { message: string }[] }): T {
  if (r.errors?.length) throw new Error(r.errors[0].message);
  return r.data;
}

/** Recorre todas las páginas de una consulta paginada de Amplify Data. */
export async function all<T>(
  fn: (opts: { nextToken?: string | null; limit: number }) => Promise<{ data: T[]; nextToken?: string | null; errors?: any[] }>,
): Promise<T[]> {
  const out: T[] = [];
  let nextToken: string | null | undefined;
  do {
    const r = await fn({ nextToken, limit: 500 });
    if (r.errors?.length) throw new Error(r.errors[0].message);
    out.push(...r.data.filter(Boolean));
    nextToken = r.nextToken;
  } while (nextToken);
  return out;
}

/** URL firmada de un comprobante o foto para el panel /admin (admin-api valida el condominio). */
export async function urlArchivoAdmin(model: 'Pago' | 'Incidente' | 'Mascota', id: string): Promise<string> {
  return (await adminCall<{ url: string }>('archivo', { model, id })).url;
}

export async function grupos(): Promise<string[]> {
  const s = await fetchAuthSession();
  return (s.tokens?.accessToken.payload['cognito:groups'] as string[] | undefined) ?? [];
}

/** Sube un archivo a la carpeta privada del residente y regresa su ruta. */
export async function subirArchivo(file: File, carpeta: string): Promise<string> {
  if (file.size > 8 * 1024 * 1024) throw new Error('El archivo supera 8 MB.');
  const limpio = file.name.normalize('NFD').replace(/[^\w.-]+/g, '_').slice(-80);
  // El portal-api solo acepta archivos con el metadato `sub` de quien los adjunta.
  const sub = (await fetchAuthSession()).tokens?.accessToken.payload.sub as string | undefined;
  const r = await uploadData({
    path: ({ identityId }) => `residentes/${identityId}/${carpeta}/${Date.now()}-${limpio}`,
    data: file,
    options: { contentType: file.type || undefined, metadata: sub ? { sub } : undefined },
  }).result;
  return r.path;
}

export async function urlArchivo(path: string): Promise<string> {
  const r = await getUrl({ path, options: { expiresIn: 900 } });
  return r.url.toString();
}
