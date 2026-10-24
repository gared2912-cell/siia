import { defineAuth } from '@aws-amplify/backend';
import { PORTAL_URL, SITIO } from '../ambiente';

// Cognito: inicio de sesión con correo. Los grupos definen el rol; un usuario sin grupo no ve nada.
// SUPERADMIN → panel /admin completo, roles de administración y alta de administradores
// ADMIN      → panel /admin según su rol de administración y sus condominios
// RESIDENTE  → portal /portal
// VIGILANTE  → modo caseta dentro de /portal
// Las cuentas solo las crea la administración (registro libre desactivado en backend.ts);
// Cognito envía al usuario el correo de bienvenida con su contraseña temporal.

const PORTAL = PORTAL_URL;

const invitacion = (usuario: string, codigo: string) => `
<div style="background:#f5f9fa;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#3a3f55">
  <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;border-collapse:separate;overflow:hidden;border:1px solid #dfe6ea">
    <tr><td bgcolor="#007c7d" style="background:#007c7d;background-image:linear-gradient(135deg,#00a7a7 0%,#007c7d 55%,#0b5c62 100%);padding:28px 28px 24px">
      <a href="${SITIO}" style="text-decoration:none"><img src="${SITIO}/marca/siia-horizontal-blanco.png" width="190" height="64" alt="SIIA soluciones inmobiliarias" style="display:block;border:0;width:190px;height:auto;color:#ffffff;font-size:22px;font-weight:bold"></a>
    </td></tr>
    <tr><td style="background:#38cbb9;height:4px;line-height:4px;font-size:0">&nbsp;</td></tr>
    <tr><td style="padding:28px 28px 8px">
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
      <p style="margin:0 0 20px;font-size:13px;color:#676d86">Si no esperabas este correo, ignóralo.</p>
    </td></tr>
    <tr><td style="background:#f5f9fa;border-top:1px solid #dfe6ea;padding:18px 28px">
      <div style="font-size:13px;color:#4b526f;margin:0 0 6px"><strong style="color:#007c7d;letter-spacing:1px">SIIA</strong> · soluciones inmobiliarias · <a href="${SITIO}" style="color:#007c7d;text-decoration:none">siia.casa</a></div>
      <div style="font-size:12px;color:#8a8fa3">Este correo es automático, no lo respondas. Si tienes dudas, comunícate con la administración de tu condominio.</div>
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
  groups: ['SUPERADMIN', 'ADMIN', 'RESIDENTE', 'VIGILANTE', 'PROVEEDOR'],
});
