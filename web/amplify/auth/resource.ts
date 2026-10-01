import { defineAuth } from '@aws-amplify/backend';

// Cognito: inicio de sesión con correo. Los grupos definen el rol; un usuario sin grupo no ve nada.
// ADMIN      → panel /admin
// RESIDENTE  → portal /portal
// VIGILANTE  → modo caseta dentro de /portal
// Las cuentas solo las crea la administración (registro libre desactivado en backend.ts);
// Cognito envía al usuario el correo de bienvenida con su contraseña temporal.

const PORTAL = 'https://staging.siia.casa/portal/';

const invitacion = (usuario: string, codigo: string) => `
<div style="background:#f5f9fa;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#3a3f55">
  <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;border-collapse:separate;overflow:hidden">
    <tr><td style="background:#007c7d;padding:22px 28px;color:#ffffff">
      <div style="font-size:22px;font-weight:bold;letter-spacing:4px">SIIA</div>
      <div style="font-size:12px;opacity:.85">Sistemas Integrales Inmobiliarios y de Administración</div>
    </td></tr>
    <tr><td style="padding:28px">
      <h1 style="font-size:20px;color:#4b526f;margin:0 0 12px">Bienvenido al portal de residentes</h1>
      <p style="margin:0 0 16px;line-height:1.5">La administración de tu condominio te dio de alta en el portal SIIA. Desde ahí podrás consultar tu estado de cuenta, subir tus comprobantes de pago, registrar visitas, reservar amenidades y más.</p>
      <table role="presentation" style="background:#e9faf8;border-radius:10px;width:100%;margin:0 0 18px"><tr><td style="padding:16px 18px;line-height:1.7">
        <div><strong>Usuario:</strong> ${usuario}</div>
        <div><strong>Contraseña temporal:</strong> <span style="font-family:Consolas,monospace;font-size:16px">${codigo}</span></div>
      </td></tr></table>
      <p style="margin:0 0 22px"><a href="${PORTAL}" style="display:inline-block;background:#007c7d;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px">Entrar al portal</a></p>
      <p style="margin:0 0 6px;font-size:13px;color:#676d86">En tu primer ingreso te pediremos crear una contraseña nueva. La contraseña temporal vence en 7 días; si vence, pide a la administración que te reenvíe tu acceso.</p>
      <p style="margin:0;font-size:13px;color:#676d86">Si no esperabas este correo, ignóralo.</p>
    </td></tr>
  </table>
</div>`;

export const auth = defineAuth({
  loginWith: {
    email: {
      verificationEmailStyle: 'CODE',
      verificationEmailSubject: 'SIIA · Código de verificación',
      verificationEmailBody: (createCode) => `Tu código de verificación para el portal de residentes SIIA es: ${createCode()}`,
      userInvitation: {
        emailSubject: 'SIIA · Tus accesos al portal de residentes',
        emailBody: (user, code) => invitacion(user(), code()),
      },
    },
  },
  userAttributes: {
    fullname: { required: false, mutable: true },
  },
  groups: ['ADMIN', 'RESIDENTE', 'VIGILANTE'],
});
