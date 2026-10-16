// Envía notificaciones push cuando se crea un registro relevante (DynamoDB Streams, solo INSERT):
// - Aviso   → residentes de la unidad (lo mismo que aparece en la campana del portal).
// - Mensaje → de un residente: administradores (canal ADMIN) o vigilantes (canal CASETA);
//             de la administración o la caseta: residentes de la unidad.
// - Pago (en revisión), Incidente, Reserva (solicitada), Mascota (pendiente) → administradores con permiso.
// Cada usuario recibe solo las categorías que no apagó y, si es administrador, solo de sus condominios y secciones.
import type { DynamoDBStreamEvent } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { byIndex, get, scan, type Item } from '../shared/db';
import { enviarAUsuario, type Aviso } from '../shared/push';
import { CATEGORIAS_ADMIN, categoriaDeAviso } from '../shared/notificaciones';
import { alcanza, normalizarPermisos } from '../shared/permisos';
import { avisosSinLeer, chatSinLeer } from '../shared/pendientes';

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

/** Administradores que atienden el condominio y cuyo rol incluye la categoría. */
async function administradores(condominioId: string, categoria: string) {
  const cat = CATEGORIAS_ADMIN.find((c) => c.key === categoria)!;
  const perfiles = (await scan('Perfil')).filter((p) => (p.rol === 'ADMIN' || p.rol === 'SUPERADMIN') && p.estado === 'APROBADO');
  const roles = new Map<string, Item | undefined>();
  const out: Item[] = [];
  for (const p of perfiles) {
    if (p.rol === 'ADMIN') {
      const condos: string[] = p.condominiosAdmin ?? [];
      if (!condos.includes('*') && !condos.includes(condominioId)) continue;
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
const corto = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

async function procesar(modelo: string, r: Item): Promise<number> {
  switch (modelo) {
    case 'Aviso':
      return enviarAResidentes(r.condominioId, r.unidadId, categoriaDeAviso(r.tipo), {
        title: r.titulo,
        body: r.texto ? corto(r.texto) : undefined,
        // Una solicitud de acceso abre Visitas para autorizarla ahí mismo
        url: r.tipo === 'ACCESO' ? '/portal/#visitas' : '/portal/#inicio',
        tag: `aviso-${r.id}`,
        // Imagen grande en la notificación (aviso de servicios); Android la muestra, iPhone solo el texto
        ...(r.imagen ? { image: r.imagen } : {}),
      });

    case 'Mensaje': {
      const texto = corto(r.texto ?? '');
      if (r.autorRol === 'RESIDENTE' && r.canal === 'CASETA') {
        return enviar(await vigilantes(r.condominioId), 'chat', { title: `Mensaje de ${r.autorNombre ?? 'un residente'}`, body: texto, url: '/portal/#chat', tag: `chat-${r.hilo}` });
      }
      if (r.autorRol === 'RESIDENTE') {
        const condo = await nombreCondo(r.condominioId);
        return enviar(await administradores(r.condominioId, 'chat'), 'chat', {
          title: `Mensaje de ${r.autorNombre ?? 'un residente'}`,
          body: `${condo}: ${texto}`,
          url: '/admin/#chat',
          tag: `chat-${r.hilo}`,
        });
      }
      const de = r.canal === 'CASETA' ? 'la caseta' : 'la administración';
      return enviarAResidentes(r.condominioId, r.unidadId, 'chat', { title: `Mensaje de ${de}`, body: texto, url: '/portal/#chat', tag: `chat-${r.hilo}` });
    }

    case 'Pago': {
      if (r.estado !== 'EN_REVISION') return 0;
      const [condo, unidad] = await Promise.all([nombreCondo(r.condominioId), etiqueta(r.unidadId)]);
      return enviar(await administradores(r.condominioId, 'pagos'), 'pagos', {
        title: 'Comprobante por aprobar',
        body: `${condo} · ${unidad} · ${mxn(r.monto ?? 0)}`,
        url: '/admin/#finanzas',
        tag: `pago-${r.id}`,
      });
    }

    case 'Incidente': {
      const [condo, unidad] = await Promise.all([nombreCondo(r.condominioId), etiqueta(r.unidadId)]);
      return enviar(await administradores(r.condominioId, 'incidentes'), 'incidentes', {
        title: `Incidente: ${corto(r.titulo ?? '', 60)}`,
        body: `${condo} · ${unidad}${r.categoria ? ` · ${r.categoria}` : ''}`,
        url: '/admin/#incidentes',
        tag: `incidente-${r.id}`,
      });
    }

    case 'Reserva': {
      if (r.estado !== 'SOLICITADA') return 0;
      const [condo, unidad, amenidad] = await Promise.all([nombreCondo(r.condominioId), etiqueta(r.unidadId), get('Amenidad', { id: r.amenidadId })]);
      return enviar(await administradores(r.condominioId, 'reservas'), 'reservas', {
        title: `Reserva por aprobar: ${amenidad?.nombre ?? 'amenidad'}`,
        body: `${condo} · ${unidad} · ${r.fecha} ${r.horaInicio}–${r.horaFin}`,
        url: '/admin/#amenidades',
        tag: `reserva-${r.id}`,
      });
    }

    case 'Mascota': {
      if (r.estado !== 'PENDIENTE') return 0;
      const [condo, unidad] = await Promise.all([nombreCondo(r.condominioId), etiqueta(r.unidadId)]);
      return enviar(await administradores(r.condominioId, 'mascotas'), 'mascotas', {
        title: `Mascota por validar: ${r.nombre}`,
        body: `${condo} · ${unidad}`,
        url: '/admin/#mascotas',
        tag: `mascota-${r.id}`,
      });
    }
  }
  return 0;
}

export const handler = async (event: DynamoDBStreamEvent) => {
  for (const rec of event.Records) {
    if (rec.eventName !== 'INSERT' || !rec.dynamodb?.NewImage) continue;
    const modelo = rec.eventSourceARN?.split(':table/')[1]?.split('-')[0] ?? '';
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
