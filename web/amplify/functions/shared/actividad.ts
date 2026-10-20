// Registro de actividad: una entrada por petición y condominio con todo lo que se guardó (ver shared/firma.ts).
import { put } from './db';
import type { Cambio, Firmante } from './firma';

const NOMBRE_MODELO: Record<string, [string, string]> = {
  RolAdmin: ['un rol de administración', 'Rol'],
  Condominio: ['el condominio', 'Condominio'],
  Unidad: ['una unidad', 'Unidad'],
  Perfil: ['una cuenta', 'Cuenta'],
  Cargo: ['un cargo', 'Cargo'],
  Pago: ['un pago', 'Pago'],
  Egreso: ['un egreso', 'Egreso'],
  SaldoMensual: ['el saldo inicial del mes', 'Saldo inicial'],
  Comunicado: ['un comunicado', 'Comunicado'],
  Encuesta: ['una encuesta', 'Encuesta'],
  Mensaje: ['un mensaje del chat', 'Mensaje'],
  Incidente: ['un incidente', 'Incidente'],
  Mantenimiento: ['un mantenimiento', 'Mantenimiento'],
  Amenidad: ['una amenidad', 'Amenidad'],
  Reserva: ['una reserva', 'Reserva'],
  Mascota: ['una mascota', 'Mascota'],
};
const VERBO = { alta: 'Dio de alta', cambio: 'Modificó', baja: 'Eliminó' } as const;
const RESUMEN_ACCION: Record<string, string> = {
  'auto.cuotas': 'Generó las cuotas automáticas y los recargos',
  'auto.reservas': 'Canceló reservas sin comprobante (48 h)',
  crearUsuario: 'Dio de alta una cuenta',
  'residentes.editar': 'Editó los datos de un residente',
  'residentes.importar': 'Importó residentes desde Excel',
  aprobar: 'Autorizó o reasignó una cuenta',
  rechazar: 'Rechazó una solicitud de cuenta',
  suspender: 'Suspendió una cuenta',
  reactivar: 'Reactivó una cuenta',
  eliminarUsuario: 'Eliminó una cuenta',
  reenviarAcceso: 'Reenvió el acceso por correo',
  generarContrasena: 'Asignó una contraseña nueva',
  validarPago: 'Revisó un comprobante de pago',
  generarCargos: 'Generó las cuotas del mes',
  cargoExtraordinario: 'Generó un cargo extraordinario',
  'egresos.guardar': 'Registró o editó un egreso',
  'egresos.borrar': 'Eliminó un egreso',
  'saldos.inicial': 'Capturó el saldo inicial del mes',
  'comunicados.guardar': 'Publicó o editó un comunicado',
  'incidentes.atender': 'Registró una etapa de un incidente',
  'accesos.agregar': 'Registró un acceso (tag o tarjeta)',
  'accesos.estados': 'Cambió el estado de accesos',
  'accesos.eliminar': 'Eliminó un acceso',
  'documentos.guardar': 'Subió un documento del condominio',
  'documentos.quitar': 'Quitó un documento del condominio',
  'roles.guardar': 'Guardó un rol de administración',
  'roles.eliminar': 'Eliminó un rol de administración',
  'condominios.asignarAdmin': 'Cambió los administradores del condominio',
  'condominios.suspender': 'Suspendió el condominio',
  'condominios.reactivar': 'Reactivó el condominio suspendido',
  'condominios.eliminar': 'Envió el condominio a la papelera',
  'condominios.restaurar': 'Restauró el condominio de la papelera',
  'condominios.borrarDefinitivo': 'Pidió borrar definitivamente el condominio',
  avisar: 'Envió un aviso a los residentes',
};
const MAX_CAMBIOS = 60;

export async function guardarActividad(action: string, por: Firmante, cambios: Cambio[]) {
  if (!cambios.length) return;
  // Las cuentas de administración y los roles no son de un condominio: van al registro GLOBAL.
  const grupos = new Map<string, Cambio[]>();
  for (const c of cambios) {
    const k = c.condominioId || 'GLOBAL';
    grupos.set(k, [...(grupos.get(k) ?? []), c]);
  }
  const fecha = new Date().toISOString();
  for (const [condominioId, lista] of grupos) {
    const primero = lista[0];
    const n = NOMBRE_MODELO[primero.modelo];
    const resumen =
      RESUMEN_ACCION[action] ??
      (lista.length > 1 ? `${VERBO[primero.op]} ${lista.length} registros` : `${VERBO[primero.op]} ${n?.[0] ?? primero.modelo}`);
    await put('Actividad', {
      condominioId,
      fecha,
      porId: por.id,
      porNombre: por.nombre,
      porEmail: por.email ?? null,
      porRol: por.rol,
      accion: action === 'db' ? `db.${primero.op}.${primero.modelo}` : action,
      resumen: lista.length > MAX_CAMBIOS ? `${resumen} (${lista.length} registros)` : resumen,
      cambios: JSON.stringify(lista.slice(0, MAX_CAMBIOS).map((c) => ({ ...c, tipo: NOMBRE_MODELO[c.modelo]?.[1] ?? c.modelo }))),
    });
  }
}
