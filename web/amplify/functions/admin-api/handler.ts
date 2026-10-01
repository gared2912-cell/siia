// Acciones de administración que no son CRUD simple: usuarios en Cognito, folios de recibos,
// generación de cuotas y avisos masivos. AppSync ya restringe esta mutación al grupo ADMIN.
import type { AppSyncResolverEvent } from 'aws-lambda';
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  ListUsersCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminUserGlobalSignOutCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { cognito, emailDe } from '../shared/cognito';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomInt } from 'node:crypto';
import {
  ApiError,
  byIndex,
  ddb,
  fail,
  get,
  hoyMX,
  now,
  parsePayload,
  put,
  remove,
  str,
  table,
  update,
  type Item,
} from '../shared/db';

const UserPoolId = process.env.USER_POOL_ID!;
const ROLES = ['ADMIN', 'RESIDENTE', 'VIGILANTE'] as const;
type Rol = (typeof ROLES)[number];

async function asignarGrupo(username: string, rol: Rol) {
  const actuales = await cognito.send(new AdminListGroupsForUserCommand({ UserPoolId, Username: username }));
  for (const g of actuales.Groups ?? []) {
    if (g.GroupName !== rol && ROLES.includes(g.GroupName as Rol)) {
      await cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId, Username: username, GroupName: g.GroupName }));
    }
  }
  await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId, Username: username, GroupName: rol }));
}

async function validarAsignacion(p: Item): Promise<{ rol: Rol; condominioId: string | null; unidadId: string | null }> {
  const rol = (ROLES as readonly string[]).includes(p.rol) ? (p.rol as Rol) : 'RESIDENTE';
  if (rol === 'ADMIN') return { rol, condominioId: null, unidadId: null };
  const c = await get('Condominio', { id: str(p.condominioId, 64) });
  if (!c) fail('Selecciona el condominio.');
  if (rol === 'VIGILANTE') return { rol, condominioId: c!.id, unidadId: null };
  const u = await get('Unidad', { id: str(p.unidadId, 64) });
  if (!u || u.condominioId !== c!.id) fail('Selecciona la unidad del residente.');
  return { rol, condominioId: c!.id, unidadId: u!.id };
}

/** Contraseña temporal que cumple la política (mayúscula, minúscula, número y símbolo). */
function temporal() {
  const set = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '$#!%*?'];
  const chars = Array.from({ length: 12 }, (_, i) => {
    const s = set[i < 4 ? i : randomInt(3)];
    return s[randomInt(s.length)];
  });
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

async function perfilDe(userId: string) {
  const perfil = await get('Perfil', { userId });
  if (!perfil) fail('Usuario no encontrado.');
  return perfil!;
}

const acciones: Record<string, (p: Item, yo: { sub: string; email: string }) => Promise<unknown>> = {
  // Alta directa por la administración: Cognito envía la invitación con contraseña temporal.
  async crearUsuario(p) {
    const email = str(p.email, 200).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('Correo no válido.');
    const nombre = str(p.nombre, 120);
    const asignacion = await validarAsignacion(p);
    let sub: string | undefined;
    try {
      const r = await cognito.send(
        new AdminCreateUserCommand({
          UserPoolId,
          Username: email,
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'email_verified', Value: 'true' },
            ...(nombre ? [{ Name: 'name', Value: nombre }] : []),
          ],
          DesiredDeliveryMediums: ['EMAIL'],
        }),
      );
      sub = r.User?.Attributes?.find((a) => a.Name === 'sub')?.Value;
    } catch (err: any) {
      if (err?.name === 'UsernameExistsException') fail('Ya existe un usuario con ese correo.');
      throw err;
    }
    if (!sub) fail('No se pudo crear el usuario.');
    await asignarGrupo(sub!, asignacion.rol);
    return put('Perfil', {
      userId: sub,
      email,
      nombre,
      telefono: str(p.telefono, 20),
      estado: 'APROBADO',
      ...asignacion,
    });
  },

  // Aprueba una solicitud (o cambia rol / condominio / unidad de un usuario existente).
  async aprobar(p) {
    const perfil = await perfilDe(str(p.userId, 64));
    const asignacion = await validarAsignacion(p);
    await asignarGrupo(perfil.userId, asignacion.rol);
    return update('Perfil', { userId: perfil.userId }, { ...asignacion, estado: 'APROBADO', nota: str(p.nota, 500) || null });
  },

  // Reenvía por correo los accesos con una contraseña temporal nueva.
  // Si el usuario ya había creado su contraseña, deja de funcionar y deberá crear otra al entrar.
  async reenviarAcceso(p) {
    const perfil = await perfilDe(str(p.userId, 64));
    if (perfil.estado !== 'APROBADO') fail('Solo se reenvía el acceso a usuarios autorizados.');
    const u = await cognito.send(new AdminGetUserCommand({ UserPoolId, Username: perfil.userId }));
    if (u.UserStatus !== 'FORCE_CHANGE_PASSWORD') {
      await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId, Username: perfil.userId, Password: temporal(), Permanent: false }));
    }
    await cognito.send(
      new AdminCreateUserCommand({ UserPoolId, Username: perfil.userId, MessageAction: 'RESEND', DesiredDeliveryMediums: ['EMAIL'] }),
    );
    return { ok: true, email: perfil.email };
  },

  // Estado de cada cuenta en Cognito: invitación sin usar, activa o deshabilitada.
  async estadoCuentas() {
    const r: Record<string, { status?: string; enabled?: boolean; creado?: string }> = {};
    let PaginationToken: string | undefined;
    do {
      const page = await cognito.send(new ListUsersCommand({ UserPoolId, PaginationToken }));
      for (const u of page.Users ?? []) {
        const sub = u.Attributes?.find((x) => x.Name === 'sub')?.Value ?? u.Username!;
        r[sub] = { status: u.UserStatus, enabled: u.Enabled, creado: u.UserCreateDate?.toISOString() };
      }
      PaginationToken = page.PaginationToken;
    } while (PaginationToken);
    return r;
  },

  async rechazar(p) {
    const perfil = await perfilDe(str(p.userId, 64));
    return update('Perfil', { userId: perfil.userId }, { estado: 'RECHAZADO', nota: str(p.nota, 500) || null });
  },

  async suspender(p, yo) {
    const perfil = await perfilDe(str(p.userId, 64));
    if (perfil.userId === yo.sub) fail('No puedes suspender tu propia cuenta.');
    await cognito.send(new AdminDisableUserCommand({ UserPoolId, Username: perfil.userId }));
    await cognito.send(new AdminUserGlobalSignOutCommand({ UserPoolId, Username: perfil.userId }));
    return update('Perfil', { userId: perfil.userId }, { estado: 'SUSPENDIDO' });
  },

  async reactivar(p) {
    const perfil = await perfilDe(str(p.userId, 64));
    await cognito.send(new AdminEnableUserCommand({ UserPoolId, Username: perfil.userId }));
    return update('Perfil', { userId: perfil.userId }, { estado: 'APROBADO' });
  },

  async eliminarUsuario(p, yo) {
    const perfil = await perfilDe(str(p.userId, 64));
    if (perfil.userId === yo.sub) fail('No puedes eliminar tu propia cuenta.');
    try {
      await cognito.send(new AdminDeleteUserCommand({ UserPoolId, Username: perfil.userId }));
    } catch (err: any) {
      if (err?.name !== 'UserNotFoundException') throw err;
    }
    await remove('Perfil', { userId: perfil.userId });
    return { ok: true };
  },

  // Valida o rechaza un comprobante. Al validar asigna folio consecutivo por condominio y liquida los cargos.
  async validarPago(p, yo) {
    const pago = await get('Pago', { id: str(p.pagoId, 64) });
    if (!pago) fail('Pago no encontrado.');
    if (pago!.estado !== 'EN_REVISION') fail('El pago ya fue procesado.');
    const nota = str(p.nota, 500) || null;
    if (!p.aprobar) {
      const r = await update('Pago', { id: pago!.id }, { estado: 'RECHAZADO', nota, validadoPor: yo.email, validadoEn: now() });
      await put('Aviso', {
        condominioId: pago!.condominioId,
        unidadId: pago!.unidadId,
        tipo: 'PAGO',
        titulo: 'Tu pago no fue aprobado',
        texto: nota ?? 'Comunícate con la administración para más detalles.',
        leido: false,
      });
      return r;
    }
    const seq = await ddb.send(
      new UpdateCommand({
        TableName: table('Condominio'),
        Key: { id: pago!.condominioId },
        UpdateExpression: 'ADD folioSeq :uno',
        ExpressionAttributeValues: { ':uno': 1 },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    const folio = `R-${String(seq.Attributes?.folioSeq ?? 1).padStart(5, '0')}`;
    await Promise.all(
      (pago!.cargoIds ?? []).map((id: string) => update('Cargo', { id }, { estado: 'PAGADO' }).catch(() => undefined)),
    );
    const r = await update('Pago', { id: pago!.id }, { estado: 'VALIDADO', folio, nota, validadoPor: yo.email, validadoEn: now() });
    await put('Aviso', {
      condominioId: pago!.condominioId,
      unidadId: pago!.unidadId,
      tipo: 'PAGO',
      titulo: `Tu pago fue aprobado · recibo ${folio}`,
      texto: `Aprobamos tu pago por ${new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(pago!.monto)}. Ya puedes descargar tu recibo en Finanzas.`,
      leido: false,
    });
    return r;
  },

  // Genera la cuota del periodo para cada unidad con cuota > 0 (idempotente por unidad y periodo).
  async generarCargos(p) {
    const c = await get('Condominio', { id: str(p.condominioId, 64) });
    if (!c) fail('Selecciona el condominio.');
    const periodo = str(p.periodo, 7);
    if (!/^\d{4}-\d{2}$/.test(periodo)) fail('Periodo no válido (AAAA-MM).');
    const vence = /^\d{4}-\d{2}-\d{2}$/.test(p.vence) ? p.vence : `${periodo}-10`;
    const concepto = str(p.concepto, 120) || `Cuota de mantenimiento ${periodo}`;
    const unidades = await byIndex('Unidad', 'byCondominio', 'condominioId', c!.id);
    let creados = 0;
    let omitidos = 0;
    for (const u of unidades) {
      if (!(u.cuota > 0)) {
        omitidos++;
        continue;
      }
      try {
        await put(
          'Cargo',
          { id: `${u.id}#${periodo}#cuota`, condominioId: c!.id, unidadId: u.id, concepto, periodo, monto: u.cuota, vence, estado: 'PENDIENTE' },
          { ifNotExists: 'id' },
        );
        creados++;
      } catch (err: any) {
        if (err?.name !== 'ConditionalCheckFailedException') throw err;
        omitidos++;
      }
    }
    return { creados, omitidos };
  },

  // Aviso a una unidad o a todas las unidades del condominio.
  async avisar(p) {
    const c = await get('Condominio', { id: str(p.condominioId, 64) });
    if (!c) fail('Selecciona el condominio.');
    const titulo = str(p.titulo, 140);
    if (!titulo) fail('Escribe el título del aviso.');
    const unidades = p.unidadId
      ? [await get('Unidad', { id: str(p.unidadId, 64) })].filter((u) => u?.condominioId === c!.id)
      : await byIndex('Unidad', 'byCondominio', 'condominioId', c!.id);
    await Promise.all(
      unidades.map((u) =>
        put('Aviso', { condominioId: c!.id, unidadId: u!.id, tipo: str(p.tipo, 30) || 'ADMIN', titulo, texto: str(p.texto, 1000), leido: false }),
      ),
    );
    return { enviados: unidades.length };
  },

  async hoy() {
    return { hoy: hoyMX() };
  },
};

export const handler = async (event: AppSyncResolverEvent<{ action: string; payload?: unknown }>) => {
  const identity = event.identity as any;
  const grupos: string[] = identity?.groups ?? identity?.claims?.['cognito:groups'] ?? [];
  const action = String(event.arguments.action ?? '');
  try {
    if (!grupos.includes('ADMIN')) fail('Acceso solo para administradores.');
    const fn = acciones[action];
    if (!fn) fail('Acción no válida.');
    const email = identity?.claims?.email || (await emailDe(identity.sub).catch(() => identity.sub));
    const r = await fn(parsePayload(event.arguments.payload), { sub: identity.sub, email });
    return r;
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    console.error(action, err);
    return { error: 'Ocurrió un error. Intenta de nuevo.' };
  }
};
