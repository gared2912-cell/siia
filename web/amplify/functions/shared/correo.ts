// Correos a residentes (Amazon SES, remitente del dominio siia.casa). Un correo que no se puede enviar
// no detiene el proceso que lo pidió: se registra en el log y se sigue.
// EN PAUSA: no se envía nada mientras la función no tenga CORREOS_ACTIVOS=1 (ver backend.ts). Para activarlo hay
// que verificar el dominio siia.casa en SES (registros DKIM en Route 53) y sacar la cuenta del modo de pruebas.
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const ses = new SESv2Client({});
const REMITENTE = process.env.CORREO_REMITENTE ?? 'SIIA Soluciones Inmobiliarias <notificaciones@siia.casa>';

const escapar = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Envía un correo sencillo (texto y HTML con los colores de SIIA). Devuelve true si SES lo aceptó. */
export async function enviarCorreo(para: string, asunto: string, parrafos: string[], boton?: { texto: string; url: string }) {
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f6;font-family:Arial,Helvetica,sans-serif;color:#333">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:#38CBB9;color:#fff;padding:18px 24px;font-size:20px;font-weight:bold">SIIA <span style="font-weight:normal;font-size:14px">soluciones inmobiliarias</span></td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.5">
${parrafos.map((p) => `<p style="margin:0 0 14px">${escapar(p)}</p>`).join('\n')}
${boton ? `<p style="margin:22px 0 6px"><a href="${escapar(boton.url)}" style="background:#38CBB9;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:bold">${escapar(boton.texto)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:14px 24px;font-size:12px;color:#989898;border-top:1px solid #eee">Este es un aviso automático de SIIA. No respondas a este correo; escríbenos desde el chat del portal.</td></tr>
</table></td></tr></table></body></html>`;
  if (process.env.CORREOS_ACTIVOS !== '1') {
    console.log(`Correo en pausa (no enviado) a ${para}: ${asunto}`);
    return false;
  }
  const texto = [...parrafos, ...(boton ? [`${boton.texto}: ${boton.url}`] : [])].join('\n\n');
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
