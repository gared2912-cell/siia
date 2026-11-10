// Chat con la administración: cuándo una conversación queda «por responder» (número rojo, campana, semáforo y la
// insignia «Por responder» de la lista de chats).
// - Mensaje nuevo: el residente escribe y la administración no ha contestado → por responder.
// - Conversación que continúa: si la administración ya contestó y el residente sigue escribiendo poco después
//   (p. ej. «gracias»), se toma como respondida.
// - Si el residente vuelve a escribir después de HORAS_CONVERSACION sin actividad, es un mensaje nuevo otra vez.
export const HORAS_CONVERSACION = 12;

type Msg = { unidadId: string; canal?: string | null; autorRol?: string | null; createdAt: string };

/** ¿La conversación (mensajes de una sola unidad y canal) espera respuesta de la administración? */
export function hiloPorResponder(mensajes: Msg[]): boolean {
  const orden = [...mensajes].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const ultimo = orden[orden.length - 1];
  if (!ultimo || ultimo.autorRol !== 'RESIDENTE') return false;
  let iRespuesta = -1;
  for (let k = orden.length - 1; k >= 0; k--)
    if (orden[k].autorRol !== 'RESIDENTE') {
      iRespuesta = k;
      break;
    }
  if (iRespuesta < 0) return true; // nadie le ha contestado
  // Después de la última respuesta: si algún mensaje del residente llegó tras una pausa larga, es un mensaje nuevo.
  const limite = HORAS_CONVERSACION * 3_600_000;
  let anterior = Date.parse(orden[iRespuesta].createdAt);
  for (const m of orden.slice(iRespuesta + 1)) {
    const t = Date.parse(m.createdAt);
    if (t - anterior > limite) return true;
    anterior = t;
  }
  return false;
}

/** Último mensaje de cada conversación del canal que espera respuesta. */
export function chatsPorResponder<T extends Msg>(mensajes: T[], canal = 'ADMIN'): T[] {
  const porUnidad = new Map<string, T[]>();
  for (const m of mensajes) if (m.canal === canal) porUnidad.set(m.unidadId, [...(porUnidad.get(m.unidadId) ?? []), m]);
  const r: T[] = [];
  for (const lista of porUnidad.values()) {
    if (!hiloPorResponder(lista)) continue;
    r.push(lista.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)));
  }
  return r;
}
