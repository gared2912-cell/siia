// Envía notificaciones push cuando se crea un registro relevante (DynamoDB Streams, solo INSERT):
// - Aviso   → residentes de la unidad (lo mismo que aparece en la campana del portal).
// - Mensaje → de un residente: administradores (canal ADMIN) o vigilantes (canal CASETA);
//             de la administración o la caseta: residentes de la unidad.
// - Pago (en revisión), Incidente, Reserva (solicitada), Mascota (pendiente) → administradores con permiso.
// - Mascota (cambio): reporte de extravío, avistamiento («La vi») o «ya apareció» → administradores y caseta.
// - Cotizacion (formulario del sitio público) → administradores con acceso a Cotizaciones (de cualquier condominio).
// Cada usuario recibe solo las categorías que no apagó y, si es administrador, solo de sus condominios y secciones.
import type { DynamoDBStreamEvent } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { byIndex, get, scan, type Item } from '../shared/db';
import { enviarAUsuario, type Aviso } from '../shared/push';
import { CATEGORIAS_ADMIN, categoriaDeAviso } from '../shared/notificaciones';
import { alcanza, normalizarPermisos } from '../shared/permisos';
import { avisosSinLeer, chatSinLeer } from '../shared/pendientes';
import { avistamientosDe } from '../shared/mascotas';

const mxn = (n: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
const apagada = (perfil: Item, categoria: string) => (perfil.notifApagadas ?? []).includes(categoria);

async function residentesDeUnidad(condominioId: string, unidadId: string) {
  return (await byIndex('Perfil', 'byCondominio', 'condominioId', condominioId)).filter(
    (p) => p.rol === 'RESIDENTE' && p.estado === 'APROBADO' && p.unidadId === unidadId,
  );
}

async function vigilantes(condominioId: string) {
  return (await byIndex('Perfil', 'byCondominio', 'condominioId', condominioId)).filter((p) => p.rol === 'VIGILANTE' && p.estado === 'APROBADO');
}

/** Administradores que atienden el condominio (null: cualquiera, p. ej. cotizaciones) y cuyo rol incluye la categoría. */
async function administradores(condominioId: string | null, categoria: string) {
  const cat = CATEGORIAS_ADMIN.find((c) => c.key === categoria)!;
  const perfiles = (await scan('Perfil')).filter((p) => (p.rol === 'ADMIN' || p.rol === 'SUPERADMIN') && p.estado === 'APROBADO');
  const roles = new Map<string, Item | undefined>();
  const out: Item[] = [];
  for (const p of perfiles) {
    if (p.rol === 'ADMIN') {
      const condos: string[] = p.condominiosAdmin ?? [];
      if (condominioId && !condos.includes('*') && !condos.includes(condominioId)) continue;
      if (!roles.has(p.rolAdminId)) roles.set(p.rolAdminId, p.rolAdminId ? await get('RolAdmin', { id: p.rolAdminId }) : undefined);
      const rol = roles.get(p.rolAdminId);
      if (!rol) continue;
      const permisos = normalizarPermisos(rol.permisos);
      if (!alcanza(permisos.secciones[cat.seccion], cat.nivel)) continue;
      if (cat.extra && !permisos.extras.includes(cat.extra)) continue;
    }
    out.push(p);
  }
  return out;
}

async function enviar(destinatarios: Item[], categoria: string, aviso: Aviso) {
  const porId = new Map(destinatarios.filter((p) => !apagada(p, categoria)).map((p) => [p.userId as string, p]));
  const n = await Promise.all([...porId].map(([id, p]) => enviarAUsuario(id, { ...aviso, silent: !!p.notifSilencio })));
  return n.reduce((s, x) => s + x, 0);
}

/** A los residentes, cada uno con su número de pendientes (avisos de la unidad + su chat sin leer) para el icono de la app. */
async function enviarAResidentes(condominioId: string, unidadId: string, categoria: string, aviso: Aviso) {
  const [perfiles, condominio, avisos] = await Promise.all([
    residentesDeUnidad(condominioId, unidadId),
    get('Condominio', { id: condominioId }),
    avisosSinLeer(unidadId),
  ]);
  const n = await Promise.all(
    perfiles
      .filter((p) => !apagada(p, categoria))
      .map(async (p) => {
        const chat = condominio ? await chatSinLeer(p, condominio, unidadId) : { ADMIN: 0, CASETA: 0 };
        return enviarAUsuario(p.userId, { ...aviso, badge: avisos + chat.ADMIN + chat.CASETA, silent: !!p.notifSilencio });
      }),
  );
  return n.reduce((s, x) => s + x, 0);
}

const etiqueta = async (unidadId?: string) => (unidadId ? ((await get('Unidad', { id: unidadId }))?.etiqueta ?? '') : '');
const nombreCondo = async (id: string) => (await get('Condominio', { id }))?.nombre ?? '';
/** Sección del panel con el condominio ya seleccionado (?c=), para administradores de varios condominios. */
const panel = (condominioId: string, seccion: string) => `/admin/?c=${encodeURIComponent(condominioId)}#/${seccion}`;
const corto = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Mascota extraviada: push a la administración (Mascotas perdidas) y a la caseta, si el condominio la tiene. */
async function cambioMascota(antes: Item | undefined, d: Item): Promise<number> {
  if (d.estado !== 'APROBADA') return 0;
  let title: string;
  let detalle: string;
  if (!antes?.extraviada && d.extraviada) {
    title = `Mascota extraviada: ${d.nombre}`;
    detalle = [d.especie, d.raza, d.color].filter(Boolean).join(' · ');
  } else if (antes?.extraviada && !d.extraviada) {
    title = `${d.nombre} ya apareció`;
    detalle = 'El dueño la marcó como encontrada.';
  } else {
    const previos = antes ? avistamientosDe(antes).length : 0;
    const lista = avistamientosDe(d);
    if (!d.extraviada || lista.length <= previos) return 0;
    const v = lista[lista.length - 1];
    title = `Vieron a ${d.nombre}`;
    detalle = `${v.quien}${v.unidad === 'Caseta' ? '' : ` (${v.unidad})`}: ${v.donde}`;
  }
  const [condo, unidad, condominio] = await Promise.all([nombreCondo(d.condominioId), etiqueta(d.unidadId), get('Condominio', { id: d.condominioId })]);
  const body = corto(`${condo} · ${unidad}${detalle ? ` · ${detalle}` : ''}`);
  const tag = `extravio-${d.id}`;
  const conCaseta = (condominio?.modulos ?? []).includes('visitas');
  const [a, c] = await Promise.all([
    enviar(await administradores(d.condominioId, 'extravios'), 'extravios', { title, body, url: panel(d.condominioId, 'mascotas'), tag }),
    conCaseta ? enviar(await vigilantes(d.condominioId), 'mascotas', { title, body, url: `/portal/#mascota/${d.id}`, tag }) : 0,
  ]);
  return a + c;
}

async function procesar(modelo: string, r: Item): Promise<number> {
  switch (modelo) {
    case 'Aviso':
      return enviarAResidentes(r.condominioId, r.unidadId, categoriaDeAviso(r.tipo), {
        title: r.titulo,
        body: r.texto ? corto(r.texto) : undefined,
        // Abre el aviso: lo marca como leído y lleva a su sección (una solicitud de acceso, a Visitas para autorizarla)
        url: `/portal/#aviso/${r.id}`,
        tag: `aviso-${r.id}`,
        // Imagen grande en la notificación (aviso de servicios); Android la muestra, iPhone solo el texto
        ...(r.imagen ? { image: r.imagen } : {}),
      });

    case 'Mensaje': {
      const texto = corto(r.texto ?? '');
      if (r.autorRol === 'RESIDENTE' && r.canal === 'CASETA') {
        return enviar(await vigilantes(r.condominioId), 'chat', { title: `Mensaje de ${r.autorNombre ?? 'un residente'}`, body: texto, url: `/portal/#chat/${r.unidadId}`, tag: `chat-${r.hilo}` });
      }
      if (r.autorRol === 'RESIDENTE') {
        const condo = await nombreCondo(r.condominioId);
        return enviar(await administradores(r.condominioId, 'chat'), 'chat', {
          title: `Mensaje de ${r.autorNombre ?? 'un residente'}`,
          body: `${condo}: ${texto}`,
          url: panel(r.condominioId, `chat/${r.unidadId}`),
          tag: `chat-${r.hilo}`,
        });
      }
      const de = r.canal === 'CASETA' ? 'la caseta' : 'la administración';
      return enviarAResidentes(r.condominioId, r.unidadId, 'chat', { title: `Mensaje de ${de}`, body: texto, url: `/portal/#chat/${r.canal === 'CASETA' ? 'CASETA' : 'ADMIN'}`, tag: `chat-${r.hilo}` });
    }

    case 'Pago': {
      if (r.estado !== 'EN_REVISION') return 0;
      const [condo, unidad] = await Promise.all([nombreCondo(r.condominioId), etiqueta(r.unidadId)]);
      return enviar(await administradores(r.condominioId, 'pagos'), 'pagos', {
        title: 'Comprobante por aprobar',
        body: `${condo} · ${unidad} · ${mxn(r.monto ?? 0)}`,
        url: panel(r.condominioId, 'finanzas/revision'),
        tag: `pago-${r.id}`,
      });
    }

    case 'Incidente': {
      const [condo, unidad] = await Promise.all([nombreCondo(r.condominioId), etiqueta(r.unidadId)]);
      return enviar(await administradores(r.condominioId, 'incidentes'), 'incidentes', {
        title: `Incidente: ${corto(r.titulo ?? '', 60)}`,
        body: `${condo} · ${unidad}${r.categoria ? ` · ${r.categoria}` : ''}`,
        url: panel(r.condominioId, 'incidentes'),
        tag: `incidente-${r.id}`,
      });
    }

    case 'Reserva': {
      if (r.estado !== 'SOLICITADA') return 0;
      const [condo, unidad, amenidad] = await Promise.all([nombreCondo(r.condominioId), etiqueta(r.unidadId), get('Amenidad', { id: r.amenidadId })]);
      return enviar(await administradores(r.condominioId, 'reservas'), 'reservas', {
        title: `Reserva por aprobar: ${amenidad?.nombre ?? 'amenidad'}`,
        body: `${condo} · ${unidad} · ${r.fecha} ${r.horaInicio}–${r.horaFin}`,
        url: panel(r.condominioId, 'amenidades'),
        tag: `reserva-${r.id}`,
      });
    }

    case 'Mascota': {
      if (r.estado !== 'PENDIENTE') return 0;
      const [condo, unidad] = await Promise.all([nombreCondo(r.condominioId), etiqueta(r.unidadId)]);
      return enviar(await administradores(r.condominioId, 'mascotas'), 'mascotas', {
        title: `Mascota por validar: ${r.nombre}`,
        body: `${condo} · ${unidad}`,
        url: panel(r.condominioId, 'mascotas'),
        tag: `mascota-${r.id}`,
      });
    }

    case 'AsistenciaProveedor': {
      const condo = await nombreCondo(r.condominioId);
      const quien = r.nombrePublico || r.proveedorNombre || 'Proveedor';
      const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City' });
      const salio = r.estado === 'SALIO';
      return enviar(await administradores(r.condominioId, 'proveedores'), 'proveedores', {
        title: salio ? `${quien} terminó su servicio · ${hora(r.salidaEn)}` : `Llegó ${quien} · ${hora(r.entradaEn)}`,
        body: `${condo}${r.proveedorNombre ? ` · ${r.proveedorNombre}` : ''}${!salio && r.entradaDescripcion ? ` · ${corto(r.entradaDescripcion, 80)}` : ''}`,
        url: panel(r.condominioId, 'proveedores/asistencia'),
        tag: `asistencia-prov-${r.id}`,
      });
    }

    case 'Cotizacion': {
      if (r.origen === 'SOPORTE') {
        return enviar(await administradores(null, 'asistencia'), 'asistencia', {
          title: `Asistencia técnica: ${corto(r.nombre ?? '', 50)}`,
          body: [r.motivo, r.desarrollo, r.unidad].filter(Boolean).join(' · ') || 'Un residente pide ayuda para entrar',
          url: `/admin/#/asistencia/${r.id}`,
          tag: `asistencia-${r.id}`,
        });
      }
      const contacto = r.origen === 'CONTACTO';
      return enviar(await administradores(null, 'cotizaciones'), 'cotizaciones', {
        title: contacto ? `Mensaje del sitio web: ${corto(r.nombre ?? '', 50)}` : `Solicitud de cotización: ${corto(r.nombre ?? '', 50)}`,
        body: [r.desarrollo, r.tipoDesarrollo, r.unidades ? `${r.unidades} unidades` : null, r.ubicacion, contacto ? r.motivo : null].filter(Boolean).join(' · ') || 'Desde el sitio web',
        url: `/admin/#/cotizaciones/${r.id}`,
        tag: `cotizacion-${r.id}`,
      });
    }
  }
  return 0;
}

export const handler = async (event: DynamoDBStreamEvent) => {
  for (const rec of event.Records) {
    if (!rec.dynamodb?.NewImage) continue;
    const modelo = rec.eventSourceARN?.split(':table/')[1]?.split('-')[0] ?? '';
    // Solo registros nuevos; de la asistencia de proveedores, también el check-out (pasa de DENTRO a SALIO);
    // de las mascotas, el extravío, los avistamientos y «ya apareció».
    if (rec.eventName !== 'INSERT') {
      const antes = rec.dynamodb.OldImage ? (unmarshall(rec.dynamodb.OldImage as any) as Item) : undefined;
      const despues = unmarshall(rec.dynamodb.NewImage as any) as Item;
      if (rec.eventName === 'MODIFY' && modelo === 'Mascota') {
        try {
          const n = await cambioMascota(antes, despues);
          if (n) console.log(`Mascota ${despues.id}: ${n} notificación(es) de extravío`);
        } catch (err) {
          console.error('Mascota', err);
        }
        continue;
      }
      if (!(rec.eventName === 'MODIFY' && modelo === 'AsistenciaProveedor' && antes?.estado === 'DENTRO' && despues.estado === 'SALIO')) continue;
    }
    try {
      const item = unmarshall(rec.dynamodb.NewImage as any) as Item;
      const n = await procesar(modelo, item);
      if (n) console.log(`${modelo} ${item.id}: ${n} notificación(es)`);
    } catch (err) {
      // Una notificación fallida no debe bloquear el flujo de la tabla.
      console.error(modelo, err);
    }
  }
};
