// Papelera de condominios (ver shared/condominios.ts).
// - desactivar: al eliminar un condominio, deshabilita en Cognito las cuentas de sus residentes y vigilantes
//   (y cierra sus sesiones); guarda cuáles para reactivarlas si se restaura.
// - reactivar: al restaurarlo, vuelve a habilitar esas cuentas.
// - purgar (y cada hora): borra el condominio con TODOS sus datos: registros de cada tabla, cuentas de Cognito,
//   archivos en S3 (con sus versiones anteriores) y su asignación a administradores. No hay vuelta atrás.
import {
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminUserGlobalSignOutCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DeleteObjectsCommand, ListObjectVersionsCommand, S3Client } from '@aws-sdk/client-s3';
import { BatchWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { cognito } from '../shared/cognito';
import { byIndex, ddb, get, now, put, scan, table, type Item } from '../shared/db';
import { fechaBorrado, jsonDe, type OrdenPapelera } from '../shared/condominios';

const UserPoolId = process.env.USER_POOL_ID!;
const Bucket = process.env.BUCKET!;
const s3 = new S3Client({});
const ES_ADMIN = (rol?: string | null) => rol === 'ADMIN' || rol === 'SUPERADMIN';

// Modelos con índice byCondominio. Voto (por encuesta), Aviso (por unidad) y Dispositivo (por usuario) se buscan aparte.
const POR_CONDOMINIO = [
  'Unidad',
  'Cargo',
  'Pago',
  'Egreso',
  'SaldoMensual',
  'Comunicado',
  'Encuesta',
  'Mensaje',
  'Incidente',
  'Mantenimiento',
  'Amenidad',
  'Reserva',
  'Visita',
  'TurnoVigilancia',
  'Mascota',
  'CorteAccesos',
  'ReporteProveedor',
  'Actividad',
];

/** Residentes y vigilantes del condominio (las cuentas de administración no se tocan). */
const cuentasDe = async (condominioId: string) =>
  (await byIndex('Perfil', 'byCondominio', 'condominioId', condominioId)).filter((p) => !ES_ADMIN(p.rol));

const sinUsuario = (err: any) => {
  if (err?.name !== 'UserNotFoundException') throw err;
};

/** Escribe la lista de cuentas desactivadas en el condominio, sin firmar (es una tarea interna). */
async function guardarEliminacion(id: string, eliminacion: Item) {
  await ddb.send(
    new UpdateCommand({
      TableName: table('Condominio'),
      Key: { id },
      UpdateExpression: 'SET eliminacion = :e, updatedAt = :u',
      ConditionExpression: 'attribute_exists(eliminadoEn)',
      ExpressionAttributeValues: { ':e': JSON.stringify(eliminacion), ':u': now() },
    }),
  );
}

async function desactivar(condominioId: string) {
  const c = await get('Condominio', { id: condominioId });
  if (!c?.eliminadoEn) return { desactivadas: 0 };
  // Las suspendidas ya están deshabilitadas: al restaurar deben seguir así.
  const cuentas = (await cuentasDe(condominioId)).filter((p) => p.estado !== 'SUSPENDIDO').map((p) => p.userId as string);
  for (const Username of cuentas) {
    await cognito.send(new AdminDisableUserCommand({ UserPoolId, Username })).catch(sinUsuario);
    await cognito.send(new AdminUserGlobalSignOutCommand({ UserPoolId, Username })).catch(() => undefined);
  }
  // Si lo restauraron mientras tanto, se deshace.
  const ahora = await get('Condominio', { id: condominioId });
  if (!ahora?.eliminadoEn) {
    await reactivar(cuentas);
    return { desactivadas: 0 };
  }
  await guardarEliminacion(condominioId, { ...(jsonDe(ahora.eliminacion) ?? {}), cuentas });
  return { desactivadas: cuentas.length };
}

async function reactivar(cuentas: string[]) {
  for (const Username of cuentas) await cognito.send(new AdminEnableUserCommand({ UserPoolId, Username })).catch(sinUsuario);
  return { reactivadas: cuentas.length };
}

/** Borra registros en lotes de 25 (reintenta los que DynamoDB no procesó). */
async function borrarRegistros(modelo: string, items: Item[]) {
  const llave = (i: Item) => (modelo === 'Perfil' ? { userId: i.userId } : { id: i.id });
  for (let k = 0; k < items.length; k += 25) {
    let pendientes: any[] = items.slice(k, k + 25).map((i) => ({ DeleteRequest: { Key: llave(i) } }));
    for (let intento = 0; pendientes.length && intento < 8; intento++) {
      if (intento) await new Promise((r) => setTimeout(r, 200 * 2 ** intento));
      const r = await ddb.send(new BatchWriteCommand({ RequestItems: { [table(modelo)]: pendientes } }));
      pendientes = r.UnprocessedItems?.[table(modelo)] ?? [];
    }
    if (pendientes.length) throw new Error(`No se pudieron borrar ${pendientes.length} registro(s) de ${modelo}`);
  }
  return items.length;
}

/** Borra todos los archivos de una carpeta, con sus versiones anteriores (el bucket guarda versiones). */
async function borrarCarpeta(Prefix: string) {
  let n = 0;
  let KeyMarker: string | undefined;
  let VersionIdMarker: string | undefined;
  do {
    const r = await s3.send(new ListObjectVersionsCommand({ Bucket, Prefix, KeyMarker, VersionIdMarker }));
    const objetos = [...(r.Versions ?? []), ...(r.DeleteMarkers ?? [])].map((v) => ({ Key: v.Key!, VersionId: v.VersionId }));
    if (objetos.length) {
      await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: objetos, Quiet: true } }));
      n += objetos.length;
    }
    KeyMarker = r.IsTruncated ? r.NextKeyMarker : undefined;
    VersionIdMarker = r.IsTruncated ? r.NextVersionIdMarker : undefined;
  } while (KeyMarker);
  return n;
}

async function purgar(condominioId: string) {
  const c = await get('Condominio', { id: condominioId });
  // Solo se borra lo que está en la papelera.
  if (!c?.eliminadoEn) return { borrado: false };
  const cuentas = await cuentasDe(condominioId);
  const conteo: Record<string, number> = {};

  for (const modelo of POR_CONDOMINIO) {
    const items = await byIndex(modelo, 'byCondominio', 'condominioId', condominioId);
    // Antes de borrar encuestas y unidades: sus votos y avisos.
    if (modelo === 'Encuesta') {
      for (const e of items) conteo.Voto = (conteo.Voto ?? 0) + (await borrarRegistros('Voto', await byIndex('Voto', 'byEncuesta', 'encuestaId', e.id)));
    }
    if (modelo === 'Unidad') {
      for (const u of items) conteo.Aviso = (conteo.Aviso ?? 0) + (await borrarRegistros('Aviso', await byIndex('Aviso', 'byUnidad', 'unidadId', u.id)));
    }
    conteo[modelo] = await borrarRegistros(modelo, items);
  }

  let archivos = await borrarCarpeta(`condominios/${condominioId}/`);
  for (const p of cuentas) {
    conteo.Dispositivo = (conteo.Dispositivo ?? 0) + (await borrarRegistros('Dispositivo', await byIndex('Dispositivo', 'byUser', 'userId', p.userId)));
    archivos += await borrarCarpeta(`residentes/${p.userId}/`);
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId, Username: p.userId })).catch(sinUsuario);
  }
  conteo.Perfil = await borrarRegistros('Perfil', cuentas);

  // Administradores que lo tenían asignado.
  for (const a of (await scan('Perfil')).filter((p) => ES_ADMIN(p.rol) && (p.condominiosAdmin ?? []).includes(condominioId))) {
    await ddb.send(
      new UpdateCommand({
        TableName: table('Perfil'),
        Key: { userId: a.userId },
        UpdateExpression: 'SET condominiosAdmin = :l, updatedAt = :u',
        ExpressionAttributeValues: { ':l': a.condominiosAdmin.filter((x: string) => x !== condominioId), ':u': now() },
      }),
    );
  }
  // Proveedores que lo atendían (sus cuentas siguen activas para sus otros condominios).
  for (const a of (await scan('Perfil')).filter((p) => p.rol === 'PROVEEDOR' && (p.condominiosServicio ?? []).includes(condominioId))) {
    await ddb.send(
      new UpdateCommand({
        TableName: table('Perfil'),
        Key: { userId: a.userId },
        UpdateExpression: 'SET condominiosServicio = :l, updatedAt = :u',
        ExpressionAttributeValues: { ':l': a.condominiosServicio.filter((x: string) => x !== condominioId), ':u': now() },
      }),
    );
  }

  await borrarRegistros('Condominio', [c]);
  // Queda constancia en el registro global (sin datos de los residentes).
  const e = jsonDe(c.eliminacion);
  await put('Actividad', {
    condominioId: 'GLOBAL',
    fecha: now(),
    porId: 'sistema',
    porNombre: 'SIIA (automático)',
    porRol: 'SISTEMA',
    accion: 'condominios.purgar',
    resumen: `Borró definitivamente el condominio «${c.nombre}» (${conteo.Unidad ?? 0} unidades, ${cuentas.length} cuentas, ${archivos} archivos)`,
    cambios: JSON.stringify([
      {
        modelo: 'Condominio',
        op: 'baja',
        id: c.id,
        condominioId: null,
        etiqueta: c.nombre,
        tipo: 'Condominio',
        campos: [
          { campo: 'eliminadoEn', antes: c.eliminadoEn, despues: null },
          { campo: 'eliminadoPor', antes: e?.porNombre ?? null, despues: null },
        ],
      },
    ]),
  });
  console.log('purgado', c.id, c.nombre, JSON.stringify({ ...conteo, archivos }));
  return { borrado: true, conteo, archivos };
}

export const handler = async (event: Partial<OrdenPapelera> & Item) => {
  if (event?.accion === 'desactivar') return desactivar(String(event.condominioId));
  if (event?.accion === 'reactivar') return reactivar(Array.isArray(event.cuentas) ? event.cuentas.map(String) : []);
  if (event?.accion === 'purgar') return purgar(String(event.condominioId));

  // Cada hora: los que cumplieron su plazo en la papelera y los de borrado inmediato que no terminaron.
  const ahora = new Date().toISOString();
  const vencidos = (await scan('Condominio')).filter((c) => c.eliminadoEn && (fechaBorrado(c.eliminadoEn) <= ahora || jsonDe(c.eliminacion)?.purgando));
  for (const c of vencidos) {
    try {
      await purgar(c.id);
    } catch (err) {
      console.error('purgar', c.id, err);
    }
  }
  return { purgados: vencidos.length };
};
