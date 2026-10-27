// Correos a residentes (Amazon SES, remitente del dominio siia.casa), con el diseño de SIIA (shared/marco-correo.ts).
// Un correo que no se puede enviar no detiene el proceso que lo pidió: se registra en el log y se sigue.
// Interruptor general: no se envía nada mientras la función no tenga CORREOS_ACTIVOS=1 (ver backend.ts).
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { marcoCorreo } from './marco-correo';
import type { Correo } from './plantillas-correo';

const ses = new SESv2Client({});
const REMITENTE = process.env.CORREO_REMITENTE ?? 'SIIA <no-reply@siia.casa>';
/** Sitio del ambiente (logo y enlaces), a partir de la dirección del portal. */
const SIN_BUZON = /@([a-z0-9-]+\.)*siia\.casa$|@example\.(com|org|net)$/i;
export const SITIO_CORREO =(process.env.PORTAL_URL ?? 'https://staging.siia.casa/portal/').replace(/\/portal\/?$/, '');

/** Envía un correo: `contenido` es el cuerpo HTML (ya escapado) que va dentro del marco; `texto`, la versión sin formato. */
export async function enviarCorreo(para: string, asunto: string, contenido: string, texto: string, pie?: string) {
  // siia.casa y sus subdominios (cuentas de demostración y de pruebas) no tienen buzón: un envío ahí rebota y los
  // rebotes dañan la reputación de la cuenta de SES.
  if (SIN_BUZON.test(para.trim())) {
    console.log(`Correo omitido (dirección sin buzón) a ${para}: ${asunto}`);
    return false;
  }
  if (process.env.CORREOS_ACTIVOS !== '1') {
    console.log(`Correo en pausa (no enviado) a ${para}: ${asunto}`);
    return false;
  }
  const html = `<!doctype html><html><body style="margin:0;background:#f5f9fa">${marcoCorreo(SITIO_CORREO, contenido, pie)}</body></html>`;
  try {
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: REMITENTE,
        Destination: { ToAddresses: [para] },
        Content: { Simple: { Subject: { Data: asunto, Charset: 'UTF-8' }, Body: { Text: { Data: texto, Charset: 'UTF-8' }, Html: { Data: html, Charset: 'UTF-8' } } } },
      }),
    );
    return true;
  } catch (err) {
    console.error(`Correo no enviado a ${para}:`, err);
    return false;
  }
}

/** Envía una plantilla (shared/plantillas-correo.ts) a una dirección. */
export const enviarPlantilla = (para: string, c: Correo) => enviarCorreo(para, c.asunto, c.contenido, c.texto, c.pie);

/** Envía a varios destinatarios, de 8 en 8 (SES permite 14 por segundo). Devuelve cuántos aceptó SES. */
export async function enviarVarios(destinos: { email: string; correo: Correo }[]) {
  let enviados = 0;
  for (let i = 0; i < destinos.length; i += 8) {
    const r = await Promise.all(destinos.slice(i, i + 8).map((d) => enviarPlantilla(d.email, d.correo)));
    enviados += r.filter(Boolean).length;
  }
  return enviados;
}
