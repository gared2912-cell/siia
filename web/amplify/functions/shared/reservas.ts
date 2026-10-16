// Reservas de amenidades. Tiene preferencia quien pide primero: toda reserva activa aparta el horario.
// Las de amenidades con costo nacen PENDIENTE_PAGO con su cargo («reserva#<id>») y se aprueban al validar el pago;
// si a las 48 horas no hay comprobante (en revisión o validado), se cancelan solas y el horario se libera.
// Las gratuitas se aprueban al reservar o cuando la administración las autoriza.
import { byIndex, get, put, update, type Item } from './db';

export const ACTIVAS = ['PENDIENTE_PAGO', 'SOLICITADA', 'APROBADA'];
export const HORAS_APARTADO = 48;
export const cargoDeReserva = (reservaId: string) => `reserva#${reservaId}`;

const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
export const seEmpalman = (a: Item, b: Item) =>
  a.fecha === b.fecha && minutos(a.horaInicio) < minutos(b.horaFin) && minutos(b.horaInicio) < minutos(a.horaFin);

/** Amenidades cuyas reservas bloquean a esta: ella misma, la amenidad completa de la que es sección y sus secciones. */
export function relacionadas(am: Item, todas: Item[]): string[] {
  const ids = new Set<string>([am.id]);
  if (am.parteDeId) ids.add(am.parteDeId);
  for (const a of todas) if (a.parteDeId === am.id) ids.add(a.id);
  return [...ids];
}

/** Reservas activas de la amenidad y de las relacionadas que se empalman con `r` (sin contar a `r`). */
async function empalmadas(r: Item) {
  const todas = await byIndex('Amenidad', 'byCondominio', 'condominioId', r.condominioId);
  const am = todas.find((a) => a.id === r.amenidadId);
  if (!am) return { todas, otras: [] as Item[] };
  const ids = relacionadas(am, todas);
  const otras = (await Promise.all(ids.map((id) => byIndex('Reserva', 'byAmenidad', 'amenidadId', id))))
    .flat()
    .filter((x) => x.id !== r.id && ACTIVAS.includes(x.estado) && seEmpalman(x, r));
  return { todas, otras };
}

/** Reserva aprobada que ya ocupa ese horario (si la hay) y el nombre de su amenidad. */
export async function choqueAprobado(r: Item) {
  const { todas, otras } = await empalmadas(r);
  const ocupa = otras.find((x) => x.estado === 'APROBADA');
  return ocupa ? { reserva: ocupa, nombre: todas.find((a) => a.id === ocupa.amenidadId)?.nombre ?? 'otra amenidad' } : undefined;
}

/** Fecha y hora límite para subir el comprobante de una reserva pendiente de pago. */
export const limitePago = (r: Item) => new Date(new Date(r.createdAt).getTime() + HORAS_APARTADO * 3600_000);

/**
 * Si la reserva sigue pendiente de pago, pasaron 48 horas y no hay comprobante en revisión o validado que
 * incluya su cargo, se cancela (con su cargo y un aviso) y regresa true.
 */
export async function vencerSiCorresponde(r: Item, ahora = new Date()) {
  if (r.estado !== 'PENDIENTE_PAGO' || limitePago(r) > ahora) return false;
  const cargo = cargoDeReserva(r.id);
  const pagos = await byIndex('Pago', 'byUnidad', 'unidadId', r.unidadId);
  if (pagos.some((p) => ['EN_REVISION', 'VALIDADO'].includes(p.estado) && (p.cargoIds ?? []).includes(cargo))) return false;
  await update('Reserva', { id: r.id }, { estado: 'CANCELADA', nota: `Cancelada: no se recibió el comprobante de pago en ${HORAS_APARTADO} horas.` });
  await cancelarCargoReserva(r.id);
  const am = await get('Amenidad', { id: r.amenidadId });
  await put('Aviso', {
    condominioId: r.condominioId,
    unidadId: r.unidadId,
    tipo: 'RESERVA',
    titulo: `Tu reserva de ${am?.nombre ?? 'amenidad'} se canceló`,
    texto: `No recibimos tu comprobante de pago en ${HORAS_APARTADO} horas, así que el ${r.fecha} de ${r.horaInicio} a ${r.horaFin} quedó libre. Puedes volver a reservar si sigue disponible.`,
    leido: false,
  });
  return true;
}

/** Reservas activas que apartan ese horario (las vencidas sin comprobante se cancelan aquí y no cuentan). */
export async function apartadas(reservas: Item[], pedida: Item) {
  const out: Item[] = [];
  for (const r of reservas) {
    if (!ACTIVAS.includes(r.estado) || !seEmpalman(r, pedida)) continue;
    if (await vencerSiCorresponde(r)) continue;
    out.push(r);
  }
  return out;
}

/** Cancela el cargo de una reserva si sigue pendiente de pago. */
export async function cancelarCargoReserva(reservaId: string) {
  const c = await get('Cargo', { id: cargoDeReserva(reservaId) });
  if (c?.estado === 'PENDIENTE') await update('Cargo', { id: c.id }, { estado: 'CANCELADO' });
}

/**
 * Aprueba la reserva (bloquea el horario) y cancela las solicitudes de otras unidades que chocan con ella,
 * con su cargo pendiente y un aviso. Si el horario ya está apartado, regresa ese choque sin aprobar.
 */
export async function confirmarReserva(r: Item, avisoTitulo?: string) {
  const { todas, otras } = await empalmadas(r);
  const ocupa = otras.find((x) => x.estado === 'APROBADA');
  if (ocupa) return { ok: false as const, nombre: todas.find((a) => a.id === ocupa.amenidadId)?.nombre ?? 'otra amenidad' };
  await update('Reserva', { id: r.id }, { estado: 'APROBADA' });
  const nombre = (id: string) => todas.find((a) => a.id === id)?.nombre ?? 'la amenidad';
  if (avisoTitulo) {
    await put('Aviso', {
      condominioId: r.condominioId,
      unidadId: r.unidadId,
      tipo: 'RESERVA',
      titulo: avisoTitulo,
      texto: `${nombre(r.amenidadId)} quedó apartada el ${r.fecha} de ${r.horaInicio} a ${r.horaFin}.`,
      leido: false,
    });
  }
  for (const x of otras.filter((o) => o.estado !== 'APROBADA')) {
    await update('Reserva', { id: x.id }, { estado: 'CANCELADA', nota: 'El horario fue apartado por otra unidad.' });
    await cancelarCargoReserva(x.id);
    await put('Aviso', {
      condominioId: x.condominioId,
      unidadId: x.unidadId,
      tipo: 'RESERVA',
      titulo: `Tu solicitud de ${nombre(x.amenidadId)} se canceló`,
      texto: `Otra unidad confirmó primero el ${x.fecha} de ${x.horaInicio} a ${x.horaFin}. Si ya pagaste, comunícate con la administración.`,
      leido: false,
    });
  }
  return { ok: true as const };
}
