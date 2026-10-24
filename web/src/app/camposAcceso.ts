// Etiquetas en español del formulario de acceso (Amplify Authenticator), compartidas por /portal, /admin y la página pública.
export const camposAcceso = {
  signUp: {
    email: { order: 1, label: 'Correo electrónico', placeholder: 'tu@correo.com' },
    password: { order: 2, label: 'Contraseña', placeholder: 'Mínimo 8 caracteres, con símbolo' },
    confirm_password: { order: 3, label: 'Confirmar contraseña', placeholder: 'Repite tu contraseña' },
  },
  signIn: {
    username: { label: 'Correo electrónico', placeholder: 'tu@correo.com' },
    password: { label: 'Contraseña', placeholder: 'Tu contraseña' },
  },
  forgotPassword: {
    username: { label: 'Correo electrónico', placeholder: 'tu@correo.com' },
  },
};

export type AccesoLiga = { usuario: string; clave: string };
let deLiga: AccesoLiga | null | undefined;

/**
 * Usuario y contraseña temporal que trae el botón del correo de bienvenida (#acceso=…&clave=…).
 * Se leen una sola vez y se quitan de la barra de direcciones para que no queden en el historial.
 */
export function accesoDeLiga(): AccesoLiga | null {
  if (deLiga !== undefined) return deLiga;
  deLiga = null;
  const h = typeof location === 'undefined' ? '' : location.hash.slice(1);
  if (!h.startsWith('acceso=')) return deLiga;
  const v: Record<string, string> = {};
  for (const par of h.split('&')) {
    const i = par.indexOf('=');
    try {
      v[par.slice(0, i)] = decodeURIComponent(par.slice(i + 1));
    } catch {
      v[par.slice(0, i)] = par.slice(i + 1);
    }
  }
  history.replaceState(null, '', location.pathname + location.search);
  // Si el correo no sustituyó los datos, la liga trae las marcas {username} / {####}.
  if (v.acceso && v.clave && !v.clave.includes('{') && !v.acceso.includes('{')) deLiga = { usuario: v.acceso, clave: v.clave };
  return deLiga;
}

/** Campos de acceso con el usuario y la contraseña de la liga ya escritos. */
export function camposConLiga(a: AccesoLiga | null) {
  if (!a) return camposAcceso;
  return {
    ...camposAcceso,
    signIn: {
      username: { ...camposAcceso.signIn.username, defaultValue: a.usuario },
      password: { ...camposAcceso.signIn.password, defaultValue: a.clave },
    },
    forgotPassword: { username: { ...camposAcceso.forgotPassword.username, defaultValue: a.usuario } },
  };
}
