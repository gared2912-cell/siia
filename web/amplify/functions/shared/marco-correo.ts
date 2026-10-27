// Marco de todos los correos de SIIA: encabezado teal con el logo, cuerpo en tarjeta blanca y pie de SIIA.
// Lo usan las plantillas de Cognito (auth/resource.ts) y los correos que envían las Lambdas (shared/correo.ts).
// Sin dependencias para poder importarse en ambos.

export const escaparHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export const PIE_RESIDENTES = 'Este correo es automático, no lo respondas. Si tienes dudas, comunícate con la administración de tu condominio.';

/** Envuelve `contenido` (HTML ya escapado) con el diseño de SIIA. `sitio` = https://siia.casa o el de pruebas;
 * `pie`: aviso final (por omisión, el de los residentes). */
export const marcoCorreo = (sitio: string, contenido: string, pie = PIE_RESIDENTES) => `
<div style="background:#f5f9fa;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#3a3f55">
  <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;border-collapse:separate;overflow:hidden;border:1px solid #dfe6ea">
    <tr><td bgcolor="#007c7d" style="background:#007c7d;background-image:linear-gradient(135deg,#00a7a7 0%,#007c7d 55%,#0b5c62 100%);padding:28px 28px 24px">
      <a href="${sitio}" style="text-decoration:none"><img src="${sitio}/marca/siia-horizontal-blanco.png" width="190" height="64" alt="SIIA soluciones inmobiliarias" style="display:block;border:0;width:190px;height:auto;color:#ffffff;font-size:22px;font-weight:bold"></a>
    </td></tr>
    <tr><td style="background:#38cbb9;height:4px;line-height:4px;font-size:0">&nbsp;</td></tr>
    <tr><td style="padding:28px 28px 8px">${contenido}
    </td></tr>
    <tr><td style="background:#f5f9fa;border-top:1px solid #dfe6ea;padding:18px 28px">
      <div style="font-size:13px;color:#4b526f;margin:0 0 6px"><strong style="color:#007c7d;letter-spacing:1px">SIIA</strong> · soluciones inmobiliarias · <a href="${sitio}" style="color:#007c7d;text-decoration:none">siia.casa</a></div>
      <div style="font-size:12px;color:#8a8fa3">${pie}</div>
    </td></tr>
  </table>
</div>`;

/** Piezas comunes del cuerpo. */
export const etiquetaCorreo = (texto: string) =>
  `<div style="font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#007c7d;margin:0 0 8px">${texto}</div>`;
export const tituloCorreo = (texto: string) => `<h1 style="font-size:22px;line-height:1.3;color:#2f3450;margin:0 0 12px">${texto}</h1>`;
export const botonCorreo = (texto: string, url: string) =>
  `<p style="margin:0 0 18px"><a href="${url}" style="display:inline-block;background:#007c7d;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px">${texto}</a></p>`;
export const notaCorreo = (texto: string, final = false) => `<p style="margin:0 0 ${final ? 20 : 6}px;font-size:13px;color:#676d86">${texto}</p>`;
