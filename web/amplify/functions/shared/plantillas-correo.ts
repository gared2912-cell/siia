// Contenido de los correos de SIIA (va dentro de shared/marco-correo.ts). Cada plantilla devuelve el asunto,
// el cuerpo HTML y la versión en texto. Sin acceso a la base de datos para poder generar vistas previas.
import { botonCorreo, escaparHtml as e, etiquetaCorreo, notaCorreo, tituloCorreo } from './marco-correo';

export type Correo = { asunto: string; contenido: string; texto: string; pie?: string };

const parrafo = (t: string) => `<p style="margin:0 0 16px;line-height:1.5">${t}</p>`;
/** Texto escrito por la administración: se escapa y se respetan los saltos de línea. */
const textoLibre = (t: string) => e(t).replace(/\r?\n/g, '<br>');
const hola = (nombre?: string | null) => `Hola${nombre ? ` ${nombre}` : ''}:`;
const caja = (html: string, centro = false) =>
  `<table role="presentation" width="100%" style="background:#e9faf8;border-radius:10px;border:1px solid #baf1ed;margin:0 0 22px"><tr><td style="padding:16px 18px;line-height:1.5${centro ? ';text-align:center' : ''}">${html}</td></tr></table>`;
const destacado = `<span style="display:inline-block;background:#fdecea;color:#a3261b;font-size:11px;font-weight:bold;letter-spacing:.5px;padding:2px 8px;border-radius:999px;margin:0 0 10px">IMPORTANTE</span>`;

/** Contraseña que la administración generó a mano y decidió enviar por correo. */
export function correoContrasena(d: { nombre?: string | null; email: string; password: string; url: string; destino: string }): Correo {
  const contenido = `
      ${etiquetaCorreo('Tu acceso a SIIA')}
      ${tituloCorreo('Tu contraseña nueva')}
      ${parrafo(`${e(hola(d.nombre))} la administración te asignó una contraseña nueva para entrar ${e(d.destino)} SIIA. Tu contraseña anterior ya no funciona.`)}
      ${caja(`<div style="font-weight:bold">Usuario:</div>
        <div style="margin:0 0 12px;word-break:break-all">${e(d.email)}</div>
        <div style="font-weight:bold">Contraseña:</div>
        <div style="font-family:Consolas,monospace;font-size:20px;white-space:nowrap">${e(d.password)}</div>`)}
      ${botonCorreo('Entrar a SIIA', d.url)}
      ${notaCorreo('Por tu seguridad, no compartas tu contraseña con nadie.')}
      ${notaCorreo('Si no pediste este cambio, comunícate con la administración de tu condominio.', true)}`;
  const texto = [hola(d.nombre), `La administración te asignó una contraseña nueva para entrar ${d.destino} SIIA.`, `Usuario: ${d.email}\nContraseña: ${d.password}`, `Entrar a SIIA:\n${d.url}`].join('\n\n');
  return { asunto: 'SIIA · Tu contraseña nueva', contenido, texto };
}

/** Comunicado marcado como importante que la administración decidió enviar también por correo. */
export function correoComunicado(d: { condominio: string; titulo: string; cuerpo: string; autor?: string | null; archivos: number; url: string }): Correo {
  const contenido = `
      ${etiquetaCorreo(`${e(d.condominio)} · Comunicado`)}
      ${destacado}
      ${tituloCorreo(e(d.titulo))}
      ${parrafo(textoLibre(d.cuerpo))}
      ${d.autor ? notaCorreo(`Publicado por ${e(d.autor)}`) : ''}
      ${d.archivos ? caja(`Este comunicado incluye <strong>${d.archivos} ${d.archivos === 1 ? 'archivo' : 'archivos'}</strong> (imágenes o PDF). Puedes verlos y descargarlos en el portal, sección Comunicados.`) : '<div style="height:6px"></div>'}
      ${botonCorreo('Ver en el portal', d.url)}`;
  const texto = [`Comunicado importante · ${d.condominio}`, d.titulo, d.cuerpo, d.archivos ? `Incluye ${d.archivos} archivo(s): consúltalos en el portal.` : '', `Ver en el portal:\n${d.url}`].filter(Boolean).join('\n\n');
  return { asunto: `Comunicado importante · ${d.titulo}`, contenido, texto };
}

/** Mantenimiento marcado como importante, con correo a los residentes. */
export function correoMantenimiento(d: { condominio: string; titulo: string; reprogramado: boolean; cuando?: string; area?: string | null; notas?: string | null; url: string }): Correo {
  const fila = (etq: string, val?: string | null) =>
    val ? `<tr><td style="padding:3px 0;color:#676d86;font-size:13px;white-space:nowrap;vertical-align:top">${etq}</td><td style="padding:3px 0 3px 12px;font-size:15px;font-weight:bold;color:#2f3450">${e(val)}</td></tr>` : '';
  const titulo = d.reprogramado ? 'Mantenimiento reprogramado' : 'Mantenimiento programado';
  const contenido = `
      ${etiquetaCorreo(`${e(d.condominio)} · Mantenimientos`)}
      ${destacado}
      ${tituloCorreo(`${titulo}: ${e(d.titulo)}`)}
      ${parrafo(d.reprogramado ? 'La administración cambió la fecha de este mantenimiento. Toma en cuenta la nueva fecha:' : 'La administración programó un mantenimiento que puede afectar tu día a día. Toma tus precauciones:')}
      ${caja(`<table role="presentation" style="border-collapse:collapse">${fila(d.reprogramado ? 'Nueva fecha' : 'Fecha', d.cuando)}${fila('Área', d.area)}</table>`)}
      ${d.notas ? parrafo(textoLibre(d.notas)) : ''}
      ${botonCorreo('Ver en el portal', d.url)}
      ${notaCorreo('Si tienes dudas, escríbenos desde el chat del portal.', true)}`;
  const texto = [`${titulo} · ${d.condominio}`, d.titulo, d.cuando && `${d.reprogramado ? 'Nueva fecha' : 'Fecha'}: ${d.cuando}`, d.area && `Área: ${d.area}`, d.notas, `Ver en el portal:\n${d.url}`]
    .filter(Boolean)
    .join('\n\n');
  return { asunto: `${titulo} · ${d.titulo}`, contenido, texto };
}

/** Accesos que se desactivarán por falta de pago (corte de accesos). */
export function correoCorteAccesos(d: { condominio: string; unidad: string; nombre?: string | null; accesos: string[]; cuotas: number; monto: string; url: string }): Correo {
  const lista = d.accesos.map((a) => `<li style="margin:0 0 4px">${e(a)}</li>`).join('');
  const adeudo = `${d.cuotas} ${d.cuotas === 1 ? 'pago vencido' : 'pagos vencidos'}`;
  const contenido = `
      ${etiquetaCorreo(`${e(d.condominio)} · ${e(d.unidad)}`)}
      ${tituloCorreo('Tus accesos se desactivarán por falta de pago')}
      ${parrafo(`${e(hola(d.nombre))} tu casa o departamento tiene <strong>${adeudo}</strong> por <strong>${e(d.monto)}</strong>. Por esta razón, la administración desactivará los siguientes accesos:`)}
      ${caja(`<ul style="margin:0;padding-left:20px;font-weight:bold;color:#2f3450">${lista}</ul>`)}
      ${parrafo('En cuanto quede cubierto tu adeudo, tus accesos se vuelven a activar en el siguiente corte. Te pedimos realizar tu pago lo antes posible.')}
      ${botonCorreo('Ver mi estado de cuenta', d.url)}
      ${notaCorreo('Si ya pagaste, sube tu comprobante en el portal, sección Finanzas, para que la administración lo valide.', true)}`;
  const texto = [hola(d.nombre), `Tu casa o departamento (${d.unidad}, ${d.condominio}) tiene ${adeudo} por ${d.monto}. La administración desactivará estos accesos:`, d.accesos.map((a) => `- ${a}`).join('\n'), 'En cuanto quede cubierto tu adeudo, se vuelven a activar en el siguiente corte.', `Ver mi estado de cuenta:\n${d.url}`].join('\n\n');
  return { asunto: `Aviso: tus accesos se desactivarán · ${d.condominio}`, contenido, texto };
}

/** Acuse automático a quien llena Cotizar o Contacto en el sitio. */
export function correoCotizacionRecibida(d: { nombre: string; cotizacion: boolean; sitio: string }): Correo {
  const que = d.cotizacion ? 'solicitud de cotización' : 'mensaje';
  const contenido = `
      ${etiquetaCorreo(d.cotizacion ? 'Solicitud de cotización' : 'Contacto')}
      ${tituloCorreo(d.cotizacion ? 'Recibimos tu solicitud de cotización' : 'Recibimos tu mensaje')}
      ${parrafo(`${e(hola(d.nombre))} gracias por tu interés en SIIA. Tu ${que} ya está con nuestro equipo y uno de nuestros asesores se pondrá en contacto contigo muy pronto, al teléfono o correo que nos dejaste.`)}
      ${caja(`<div style="font-weight:bold;color:#2f3450;margin:0 0 6px">En SIIA administramos tu condominio de forma integral:</div>
        <div style="font-size:14px;color:#4b526f">Cobranza y finanzas transparentes · Portal y app para residentes · Control de caseta y visitas · Mantenimiento y proveedores</div>`)}
      ${botonCorreo('Conoce SIIA', d.sitio)}
      ${notaCorreo('Si no llenaste ningún formulario en siia.casa, ignora este correo.', true)}`;
  const texto = [hola(d.nombre), `Gracias por tu interés en SIIA. Tu ${que} ya está con nuestro equipo y uno de nuestros asesores se pondrá en contacto contigo muy pronto.`, `Conoce SIIA:\n${d.sitio}`].join('\n\n');
  return {
    asunto: d.cotizacion ? 'SIIA · Recibimos tu solicitud de cotización' : 'SIIA · Recibimos tu mensaje',
    contenido,
    texto,
    pie: 'Este correo es automático, no lo respondas. Nuestro equipo te contactará muy pronto.',
  };
}
