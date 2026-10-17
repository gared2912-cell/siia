// Campana del panel: lo pendiente de atender en el condominio seleccionado (comprobantes, reservas,
// mascotas, incidentes nuevos, solicitudes de acceso y chats por responder). Cada renglón lleva a la
// sección donde se atiende y, una vez visto, desaparece de la campana.
import { useMemo } from 'react';
import { all, db, type Schema } from '../api';
import { money, useLoad, usePoll } from '../ui';
import { Campana, useVistos, type ItemCampana } from '../Campana';
import { useInsigniaApp } from '../AppMovil';

export const VISTOS_ADMIN = 'siia-vistos-admin';
import { useAdmin } from './AdminApp';

type Mensaje = Schema['Mensaje']['type'];

export function CampanaAdmin({ go, mensajes }: { go: (k: string) => void; mensajes: Mensaje[] }) {
  const { condo, puede, tiene, etiqueta } = useAdmin();
  const vistos = useVistos(VISTOS_ADMIN);
  const id = condo?.id ?? '';
  // Solo se consultan las secciones que el rol puede ver (igual que el Panel).
  const si = <T,>(ok: boolean, fn: () => Promise<T[]>) => (id && ok ? fn() : Promise.resolve([] as T[]));
  const datos = useLoad(async () => {
    const q = { condominioId: id };
    const [pagos, reservas, mascotas, incidentes, perfiles] = await Promise.all([
      si(puede('finanzas') && tiene('finanzas.validarPagos'), () => all((o) => db.models.Pago.pagosPorCondominio(q, o))),
      si(puede('amenidades'), () => all((o) => db.models.Reserva.reservasPorCondominio(q, o))),
      si(puede('mascotas'), () => all((o) => db.models.Mascota.mascotasPorCondominio(q, o))),
      si(puede('incidentes'), () => all((o) => db.models.Incidente.incidentesPorCondominio(q, o))),
      si(puede('usuarios'), () => all((o) => db.models.Perfil.list(o))),
    ]);
    return { pagos, reservas, mascotas, incidentes, perfiles };
  }, [id]);
  usePoll(() => datos.reload(true), 60000, !!id);

  const items = useMemo<ItemCampana[]>(() => {
    const d = datos.data;
    const out: ItemCampana[] = [];
    // Chats cuyo último mensaje es de un residente: abre esa conversación
    const ultimo = new Map<string, Mensaje>();
    for (const m of mensajes) if (m.canal === 'ADMIN' && (!ultimo.has(m.unidadId) || m.createdAt > ultimo.get(m.unidadId)!.createdAt)) ultimo.set(m.unidadId, m);
    for (const m of ultimo.values())
      if (m.autorRol === 'RESIDENTE')
        out.push({ id: `chat-${m.unidadId}`, icono: 'chat', titulo: `Mensaje de ${etiqueta(m.unidadId)}`, texto: m.texto || '📷 Foto', fecha: m.createdAt, nuevo: true, abrir: () => go(`chat/${m.unidadId}`) });
    if (d) {
      for (const p of d.pagos.filter((x) => x.estado === 'EN_REVISION'))
        out.push({ id: `pago-${p.id}`, icono: 'money', titulo: 'Comprobante por aprobar', texto: `${etiqueta(p.unidadId)} · ${money(p.monto)}`, fecha: p.createdAt, nuevo: true, abrir: () => go('finanzas/revision') });
      for (const r of d.reservas.filter((x) => x.estado === 'SOLICITADA'))
        out.push({ id: `reserva-${r.id}`, icono: 'calendar', titulo: 'Reserva por aprobar', texto: `${etiqueta(r.unidadId)} · ${r.fecha} ${r.horaInicio}–${r.horaFin}`, fecha: r.createdAt, nuevo: true, abrir: () => go('amenidades') });
      for (const m of d.mascotas.filter((x) => x.estado === 'PENDIENTE'))
        out.push({ id: `mascota-${m.id}`, icono: 'paw', titulo: `Mascota por validar: ${m.nombre}`, texto: etiqueta(m.unidadId), fecha: m.createdAt, nuevo: true, abrir: () => go('mascotas') });
      for (const i of d.incidentes.filter((x) => x.estado === 'ABIERTO'))
        out.push({ id: `incidente-${i.id}`, icono: 'alert', titulo: `Incidente nuevo: ${i.titulo}`, texto: etiqueta(i.unidadId), fecha: i.createdAt, nuevo: true, abrir: () => go('incidentes') });
      for (const p of d.perfiles.filter((x) => x.estado === 'PENDIENTE' && x.condominioId === id))
        out.push({ id: `perfil-${p.userId}`, icono: 'users', titulo: `Solicitud de acceso: ${p.nombre || p.email}`, texto: p.unidadSolicitada ?? undefined, fecha: p.createdAt, nuevo: true, abrir: () => go('condominios/residentes') });
    }
    return vistos(out.sort((a, b) => String(b.fecha ?? '').localeCompare(String(a.fecha ?? ''))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos.data, mensajes, id, vistos]);
  const total = items.length;
  useInsigniaApp(total);

  return <Campana total={total} items={items} vacio="No hay pendientes en este condominio." />;
}
