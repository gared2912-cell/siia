import { defineAuth } from '@aws-amplify/backend';
import { PORTAL_URL, SITIO } from '../ambiente';
import { marcoCorreo } from '../functions/shared/marco-correo';

// Cognito: inicio de sesión con correo. Los grupos definen el rol; un usuario sin grupo no ve nada.
// SUPERADMIN → panel /admin completo, roles de administración y alta de administradores
// ADMIN      → panel /admin según su rol de administración y sus condominios
// RESIDENTE  → portal /portal
// VIGILANTE  → modo caseta dentro de /portal
// Las cuentas solo las crea la administración (registro libre desactivado en backend.ts);
// Cognito envía al usuario el correo de bienvenida con su contraseña temporal.

const PORTAL = PORTAL_URL;

const correo = (contenido: string) => marcoCorreo(SITIO, contenido);

export const invitacion = (usuario: string, codigo: string) => correo(`
      <div style="font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#007c7d;margin:0 0 8px">Portal de residentes</div>
      <h1 style="font-size:22px;line-height:1.3;color:#2f3450;margin:0 0 12px">Te damos la bienvenida a SIIA</h1>
      <p style="margin:0 0 16px;line-height:1.5">La administración de tu condominio te dio de alta en el portal SIIA. Desde ahí podrás consultar tu estado de cuenta, subir tus comprobantes de pago, registrar visitas, reservar amenidades y más.</p>
      <p style="margin:0 0 18px"><a href="${PORTAL}#acceso=${usuario}&clave=${codigo}" style="display:inline-block;background:#007c7d;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px">Entrar al portal</a></p>
      <table role="presentation" style="background:#e9faf8;border-radius:10px;border:1px solid #baf1ed;width:100%;margin:0 0 22px"><tr><td style="padding:16px 18px;line-height:1.5">
        <div style="font-weight:bold">Usuario:</div>
        <div style="margin:0 0 12px;word-break:break-all">${usuario}</div>
        <div style="font-weight:bold">Contraseña temporal:</div>
        <div style="font-family:Consolas,monospace;font-size:18px;white-space:nowrap">${codigo}</div>
      </td></tr></table>
      <p style="margin:0 0 6px;font-size:13px;color:#676d86">En tu primer ingreso te pediremos crear una contraseña nueva. La contraseña temporal vence en 7 días; si vence, pide a la administración que te reenvíe tu acceso.</p>
      <p style="margin:0 0 20px;font-size:13px;color:#676d86">Si no esperabas este correo, ignóralo.</p>`);

// Código de Cognito: se usa al restablecer la contraseña («¿Olvidaste tu contraseña?») y al confirmar el correo.
export const verificacion = (codigo: string) => correo(`
      <div style="font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#007c7d;margin:0 0 8px">Portal de residentes</div>
      <h1 style="font-size:22px;line-height:1.3;color:#2f3450;margin:0 0 12px">Tu código de verificación</h1>
      <p style="margin:0 0 16px;line-height:1.5">Recibimos una solicitud para restablecer tu contraseña o confirmar tu correo en el portal SIIA. Escribe este código en la pantalla donde lo solicitaste:</p>
      <table role="presentation" style="background:#e9faf8;border-radius:10px;border:1px solid #baf1ed;width:100%;margin:0 0 22px"><tr><td style="padding:18px;text-align:center">
        <div style="font-family:Consolas,monospace;font-size:30px;font-weight:bold;letter-spacing:6px;color:#2f3450;white-space:nowrap">${codigo}</div>
      </td></tr></table>
      <p style="margin:0 0 18px"><a href="${PORTAL}" style="display:inline-block;background:#007c7d;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px">Ir al portal</a></p>
      <p style="margin:0 0 6px;font-size:13px;color:#676d86">El código vence en poco tiempo; si vence, solicita uno nuevo. Por tu seguridad, no lo compartas con nadie; la administración nunca te lo pedirá.</p>
      <p style="margin:0 0 20px;font-size:13px;color:#676d86">Si no solicitaste este código, ignora este correo: tu contraseña no cambiará.</p>`);

export const auth = defineAuth({
  loginWith: {
    email: {
      verificationEmailStyle: 'CODE',
      verificationEmailSubject: 'SIIA · Código de verificación',
      verificationEmailBody: (createCode) => verificacion(createCode()),
      userInvitation: {
        emailSubject: 'SIIA · Tus accesos al portal de residentes',
        emailBody: (user, code) => invitacion(user(), code()),
      },
    },
  },
  userAttributes: {
    fullname: { required: false, mutable: true },
  },
  groups: ['SUPERADMIN', 'ADMIN', 'RESIDENTE', 'VIGILANTE', 'PROVEEDOR'],
});
