// Pendientes del panel: lo que hay que atender en el condominio seleccionado (comprobantes, reservas, mascotas,
// incidentes nuevos, solicitudes de acceso y chats por responder) más las cotizaciones del sitio web y las solicitudes
// de asistencia técnica (de todos los condominios). Cada pendiente tiene su sección del menú:
// - El menú lateral muestra en rojo cuántos pendientes tiene cada módulo (siguen ahí hasta que se atienden).
// - La campana lista cada pendiente; al tocarlo lleva a donde se atiende y, una vez visto, sale de la campana.
//   Excepción: cotizaciones y asistencia técnica siguen en la campana hasta que alguien las marca como respondidas.
// - El semáforo (y el beagle) suma todos los pendientes: hasta 5 verde, más de 5 amarillo, más de 10 rojo.
import { useMemo } from 'react';
import { adminCall, all, db, type Schema } from '../api';
import { fechaHora, money, useLoad, usePoll } from '../ui';
import { Campana, useVistos, type ItemCampana } from '../Campana';
import { useInsigniaApp } from '../AppMovil';
import { listaCotizaciones, resumenCotizacion, type Cotizacion } from './Cotizaciones';
import { listaAsistencia, type SolicitudAyuda } from './Asistencia';
import { EVENTO_MIS_REPORTES, type ReporteVista } from './BotonReporte';
import { ESTADOS_REPORTE, TIPOS_REPORTE, avisoResuelto } from '../../../amplify/functions/shared/reportes';
import type { Nivel } from '../../../amplify/functions/shared/permisos';

export const VISTOS_ADMIN = 'siia-vistos-admin';

type Mensaje = Schema['Mensaje']['type'];
type Condominio = Schema['Condominio']['type'];
export type AsistenciaVista = { id: string; nombrePublico?: string | null; proveedorNombre?: string | null; estado: string; entradaEn: string; salidaEn?: string | null; entradaDescripcion?: string | null };

/** Pendiente con la sección del menú donde se atiende. */
type Pendiente = ItemCampana & { seccion: string };

export type PendientesAdmin = {
  /** Lo que lista la campana (sin lo ya visto) más avisos informativos (llegada de proveedores, mis reportes). */
  items: ItemCampana[];
  /** Pendientes reales por sección del menú (para el número en rojo de cada módulo). */
  conteos: Record<string, number>;
  /** Suma de todos los pendientes (semáforo). */
  total: number;
  recargar: () => void;
};

type Opciones = {
  condo: Condominio | null;
  bloqueado: boolean;
  superadmin: boolean;
  reporta: boolean;
  puede: (seccion: string, nivel?: Nivel) => boolean;
  tiene: (extra: string) => boolean;
  etiqueta: (unidadId?: string | null) => string;
  go: (k: string) => void;
  mensajes: Mensaje[];
};

/** Hilos de chat cuyo último mensaje es de un residente (por responder). */
function chatsPorResponder(mensajes: Mensaje[]) {
  const ultimo = new Map<string, Mensaje>();
  for (const m of mensajes) if (m.canal === 'ADMIN' && (!ultimo.has(m.unidadId) || m.createdAt > ultimo.get(m.unidadId)!.createdAt)) ultimo.set(m.unidadId, m);
  return [...ultimo.values()].filter((m) => m.autorRol === 'RESIDENTE');
}

export function usePendientesAdmin({ condo, bloqueado, superadmin, reporta, puede, tiene, etiqueta, go, mensajes }: Opciones): PendientesAdmin {
  const vistos = useVistos(VISTOS_ADMIN);
  const id = condo?.id ?? '';
  const enCondo = !!condo && !bloqueado && (!condo.suspendido || superadmin);
  const si = <T,>(ok: boolean, fn: () => Promise<T[]>) => (id && enCondo && ok ? fn() : Promise.resolve([] as T[]));
  const veCotizaciones = puede('cotizaciones');
  const veAsistencia = puede('usuarios');
  const datos = useLoad(async () => {
    const q = { condominioId: id };
    const [pagos, reservas, mascotas, incidentes, perfiles, cotizaciones, ayuda, llegadas] = await Promise.all([
      si(puede('finanzas') && tiene('finanzas.validarPagos'), () => all((o) => db.models.Pago.pagosPorCondominio(q, o))),
      si(puede('amenidades'), () => all((o) => db.models.Reserva.reservasPorCondominio(q, o))),
      si(puede('mascotas'), () => all((o) => db.models.Mascota.mascotasPorCondominio(q, o))),
      si(puede('incidentes'), () => all((o) => db.models.Incidente.incidentesPorCondominio(q, o))),
      si(puede('usuarios'), () => all((o) => db.models.Perfil.list(o))),
      veCotizaciones ? listaCotizaciones().catch(() => [] as Cotizacion[]) : Promise.resolve([] as Cotizacion[]),
      veAsistencia ? listaAsistencia().catch(() => [] as SolicitudAyuda[]) : Promise.resolve([] as SolicitudAyuda[]),
      si(puede('proveedores'), () => adminCall<AsistenciaVista[]>('proveedores.asistencias', { condominioId: id, dias: 1 }).catch(() => [] as AsistenciaVista[])),
    ]);
    const reportes = reporta ? await adminCall<ReporteVista[]>('reportes.mios').catch(() => [] as ReporteVista[]) : [];
    return { pagos, reservas, mascotas, incidentes, perfiles, cotizaciones, ayuda, llegadas, reportes };
  }, [id, enCondo]);
  usePoll(() => datos.reload(true), 60000, !!id || veCotizaciones || veAsistencia || reporta);

  const r = useMemo(() => {
    const d = datos.data;
    const pend: Pendiente[] = [];
    for (const m of chatsPorResponder(mensajes))
      pend.push({ seccion: 'chat', id: `chat-${m.unidadId}`, icono: 'chat', titulo: `Mensaje de ${etiqueta(m.unidadId)}`, texto: m.texto || '📷 Foto', fecha: m.createdAt, nuevo: true, abrir: () => go(`chat/${m.unidadId}`) });
    if (d) {
      for (const p of d.pagos.filter((x) => x.estado === 'EN_REVISION'))
        pend.push({ seccion: 'finanzas', id: `pago-${p.id}`, icono: 'money', titulo: 'Comprobante por aprobar', texto: `${etiqueta(p.unidadId)} · ${money(p.monto)}`, fecha: p.createdAt, nuevo: true, abrir: () => go('finanzas/revision') });
      for (const x of d.reservas.filter((y) => y.estado === 'SOLICITADA'))
        pend.push({ seccion: 'amenidades', id: `reserva-${x.id}`, icono: 'calendar', titulo: 'Reserva por aprobar', texto: `${etiqueta(x.unidadId)} · ${x.fecha} ${x.horaInicio}–${x.horaFin}`, fecha: x.createdAt, nuevo: true, abrir: () => go('amenidades') });
      for (const m of d.mascotas.filter((y) => y.estado === 'PENDIENTE'))
        pend.push({ seccion: 'mascotas', id: `mascota-${m.id}`, icono: 'paw', titulo: `Mascota por validar: ${m.nombre}`, texto: etiqueta(m.unidadId), fecha: m.createdAt, nuevo: true, abrir: () => go('mascotas') });
      for (const i of d.incidentes.filter((y) => y.estado === 'ABIERTO'))
        pend.push({ seccion: 'incidentes', id: `incidente-${i.id}`, icono: 'alert', titulo: `Incidente nuevo: ${i.titulo}`, texto: etiqueta(i.unidadId), fecha: i.createdAt, nuevo: true, abrir: () => go('incidentes') });
      for (const p of d.perfiles.filter((y) => y.estado === 'PENDIENTE' && y.condominioId === id))
        pend.push({ seccion: 'condominios', id: `perfil-${p.userId}`, icono: 'users', titulo: `Solicitud de acceso: ${p.nombre || p.email}`, texto: p.unidadSolicitada ?? undefined, fecha: p.createdAt, nuevo: true, abrir: () => go('condominios/residentes') });
    }
    // Cotizaciones y asistencia técnica: no se quitan al verlas, solo al marcarlas como respondidas.
    const fijos: Pendiente[] = [
      ...(d?.cotizaciones ?? [])
        .filter((c) => c.estado === 'PENDIENTE')
        .map((c) => ({
          seccion: 'cotizaciones',
          id: `cotizacion-${c.id}`,
          icono: 'inbox',
          titulo: `${c.origen === 'CONTACTO' ? 'Mensaje del sitio web' : 'Solicitud de cotización'}: ${c.nombre}`,
          texto: resumenCotizacion(c) || undefined,
          fecha: c.createdAt,
          nuevo: true,
          abrir: () => go(`cotizaciones/${c.id}`),
        })),
      ...(d?.ayuda ?? [])
        .filter((c) => c.estado === 'PENDIENTE')
        .map((c) => ({
          seccion: 'asistencia',
          id: `asistencia-${c.id}`,
          icono: 'help',
          titulo: `Asistencia técnica: ${c.nombre}`,
          texto: [c.motivo, c.desarrollo, c.unidad].filter(Boolean).join(' · ') || undefined,
          fecha: c.createdAt,
          nuevo: true,
          abrir: () => go(`asistencia/${c.id}`),
        })),
    ];
    const conteos: Record<string, number> = {};
    for (const x of [...pend, ...fijos]) conteos[x.seccion] = (conteos[x.seccion] ?? 0) + 1;

    // Informativos: llegada y salida de proveedores de hoy, y respuestas a mis reportes de fallas y mejoras.
    const info: ItemCampana[] = [];
    for (const a of d?.llegadas ?? []) {
      const quien = a.nombrePublico || a.proveedorNombre || 'Proveedor';
      info.push({
        id: `llegada-${a.id}-${a.estado}`,
        icono: a.estado === 'SALIO' ? 'logout' : 'login',
        titulo: a.estado === 'SALIO' ? `${quien} terminó su servicio` : `Llegó ${quien}`,
        texto: a.estado === 'SALIO' && a.salidaEn ? `Salió ${fechaHora(a.salidaEn)}` : a.entradaDescripcion || `Entró ${fechaHora(a.entradaEn)}`,
        fecha: a.salidaEn || a.entradaEn,
        abrir: () => go('proveedores/asistencia'),
      });
    }
    for (const x of d?.reportes ?? [])
      if (x.atendidoEn)
        info.push({
          id: `reporte-${x.id}-${x.estado}`,
          icono: x.estado === 'RESUELTO' ? 'check' : 'flag',
          titulo: x.estado === 'RESUELTO' ? avisoResuelto(x.tipo) : `${TIPOS_REPORTE[x.tipo]?.corto ?? 'Reporte'}: ${ESTADOS_REPORTE[x.estado]}`,
          texto: x.respuesta || x.texto.slice(0, 90),
          fecha: x.atendidoEn,
          nuevo: true,
          abrir: () => window.dispatchEvent(new Event(EVENTO_MIS_REPORTES)),
        });
    const items = [...fijos, ...vistos([...pend, ...info])].sort((a, b) => String(b.fecha ?? '').localeCompare(String(a.fecha ?? '')));
    const total = Object.values(conteos).reduce((s, n) => s + n, 0);
    return { items, conteos, total };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos.data, mensajes, id, vistos]);

  return { ...r, recargar: () => datos.reload(true) };
}

export function CampanaAdmin({ pend }: { pend: PendientesAdmin }) {
  // El icono de la app lleva lo que falta por ver en la campana.
  const total = pend.items.filter((i) => i.nuevo).length;
  useInsigniaApp(total);
  return <Campana total={total} items={pend.items} vacio="No hay pendientes en este condominio." />;
}
