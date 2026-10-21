// Formularios del sitio público: «Cotizar» (solicitud de cotización) y «Contacto». Sin sesión: se llama por la URL
// pública de la función (CORS solo para el dominio del sitio). Guarda la solicitud en Cotizacion, que el panel muestra
// en Cotizaciones (y en la campana hasta que alguien la marque «Respondido al solicitante»). Por ahora no se envía
// por correo (decisión del 2026-10-21): llega solo al panel, con notificación push.
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { createHash } from 'node:crypto';
import { ddb, put, table } from '../shared/db';

/** Envíos por hora desde la misma conexión (protección básica contra abuso). */
const MAX_POR_HORA = 8;

const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const parrafo = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '');
const correoValido = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

const responder = (statusCode: number, body: object): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  if (event.requestContext?.http?.method !== 'POST') return responder(405, { error: 'Método no permitido.' });
  let b: Record<string, unknown>;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : (event.body ?? '');
    if (raw.length > 20000) return responder(413, { error: 'La solicitud es demasiado grande.' });
    b = JSON.parse(raw);
  } catch {
    return responder(400, { error: 'Solicitud no válida.' });
  }

  // Campo oculto que solo llenan los robots: se responde como si se hubiera guardado.
  if (texto(b.sitio_web, 200)) return responder(200, { ok: true });

  const origen = b.origen === 'CONTACTO' ? 'CONTACTO' : 'COTIZACION';
  const nombre = texto(b.nombre, 120);
  const telefono = texto(b.telefono, 30);
  const correo = texto(b.correo, 160).toLowerCase();
  if (!nombre) return responder(400, { error: 'Escribe tu nombre.' });
  if ((telefono.match(/\d/g) ?? []).length < 10) return responder(400, { error: 'Escribe un teléfono de al menos 10 dígitos.' });
  if (correo && !correoValido(correo)) return responder(400, { error: 'El correo electrónico no es válido.' });
  const unidades = Number.parseInt(String(b.unidades ?? ''), 10);
  const servicios = texto(b.servicios, 600)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);

  // Límite por conexión (la IP se guarda cifrada con hash, no en claro).
  const ip = createHash('sha256').update(`siia:${event.requestContext.http.sourceIp ?? ''}`).digest('hex').slice(0, 24);
  const haceUnaHora = new Date(Date.now() - 3600_000).toISOString();
  const recientes = await ddb.send(
    new ScanCommand({
      TableName: table('Cotizacion'),
      FilterExpression: 'ipHash = :ip AND createdAt > :desde',
      ExpressionAttributeValues: { ':ip': ip, ':desde': haceUnaHora },
      ProjectionExpression: 'id, nombre, telefono',
    }),
  );
  const previas = recientes.Items ?? [];
  // Doble clic o reenvío del mismo formulario: no se duplica.
  if (previas.some((x) => x.nombre === nombre && x.telefono === telefono)) return responder(200, { ok: true });
  if (previas.length >= MAX_POR_HORA) return responder(429, { error: 'Recibimos varias solicitudes desde esta conexión. Intenta más tarde o escríbenos por correo.' });

  await put('Cotizacion', {
    origen,
    estado: 'PENDIENTE',
    nombre,
    telefono,
    correo: correo || null,
    rol: texto(b.rol, 80) || null,
    tipoDesarrollo: texto(b.tipo, 80) || null,
    unidades: Number.isFinite(unidades) && unidades > 0 ? Math.min(unidades, 100000) : null,
    desarrollo: texto(b.desarrollo, 160) || texto(b.condominio, 160) || null,
    ubicacion: texto(b.ubicacion, 120) || null,
    administracionActual: texto(b.administracion_actual, 60) || null,
    servicios: servicios.length ? servicios : null,
    motivo: texto(b.motivo, 120) || null,
    mensaje: parrafo(b.comentarios, 3000) || parrafo(b.mensaje, 3000) || null,
    pagina: texto(b.page, 120) || null,
    ipHash: ip,
  });

  return responder(200, { ok: true });
};
