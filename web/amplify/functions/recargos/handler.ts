// Tarea diaria (00:15, hora de México): primero genera las cuotas automáticas del mes (generarCuotaAutomatica)
// y después aplica los recargos.
// Recargo por pago tardío. En los condominios que lo tienen activo, al día siguiente del vencimiento
// se carga el recargo a cada cuota de mantenimiento que siga sin pagar, siempre que la unidad no tenga
// ningún comprobante subido en revisión (por aprobar). Un solo recargo por cuota (id «<unidad>#<periodo>#recargo»),
// solo para cuotas que vencen después de activarlo (recargoDesde). La unidad recibe un aviso en el portal (que
// también llega como notificación a la app) y cada residente de la unidad, un correo a su dirección registrada.
import { byIndex, hoyMX, put, scan, type Item } from '../shared/db';
import { crearCuotas, fechaCargo } from '../shared/cuotas';
import { enviarCorreo } from '../shared/correo';
import { SISTEMA, firmarComo, tomarCambios } from '../shared/firma';
import { guardarActividad } from '../shared/actividad';

const PORTAL = process.env.PORTAL_URL ?? 'https://staging.siia.casa/portal/';
const fechaLarga = (iso: string) => {
  const [a, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(a, m - 1, d)));
};

const mxn = (n: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);

export async function aplicarRecargos(c: Item, hoy = hoyMX()) {
  const monto = Number(c.recargoMonto);
  if (!c.recargoActivo || !(monto > 0) || c.activo === false) return 0;
  const desde: string = c.recargoDesde ?? hoy;
  const [cargos, pagos, perfiles] = await Promise.all([
    byIndex('Cargo', 'byCondominio', 'condominioId', c.id),
    byIndex('Pago', 'byCondominio', 'condominioId', c.id),
    byIndex('Perfil', 'byCondominio', 'condominioId', c.id),
  ]);
  // Si la unidad tiene cualquier comprobante subido por aprobar, no se le carga recargo.
  const unidadesConPago = new Set(pagos.filter((p) => p.estado === 'EN_REVISION').map((p) => p.unidadId));
  const existentes = new Set(cargos.map((x) => x.id));

  let n = 0;
  for (const cuota of cargos) {
    if (!String(cuota.id).endsWith('#cuota') || cuota.estado !== 'PENDIENTE') continue;
    if (!cuota.vence || cuota.vence >= hoy || cuota.vence < desde) continue;
    if (unidadesConPago.has(cuota.unidadId)) continue;
    const id = String(cuota.id).replace(/#cuota$/, '#recargo');
    if (existentes.has(id)) continue;
    try {
      await put(
        'Cargo',
        {
          id,
          condominioId: c.id,
          unidadId: cuota.unidadId,
          concepto: `Recargo por pago tardío · ${cuota.concepto}`,
          periodo: cuota.periodo,
          monto,
          vence: hoy,
          estado: 'PENDIENTE',
        },
        { ifNotExists: 'id' },
      );
    } catch (err: any) {
      if (err?.name === 'ConditionalCheckFailedException') continue;
      throw err;
    }
    const titulo = `Recargo por pago tardío de ${mxn(monto)}`;
    await put('Aviso', {
      condominioId: c.id,
      unidadId: cuota.unidadId,
      tipo: 'PAGO',
      titulo,
      texto: `Tu ${String(cuota.concepto).toLowerCase()} venció el ${fechaLarga(cuota.vence)} sin pago registrado. Puedes consultarlo y pagar en Finanzas.`,
      leido: false,
    });
    const residentes = perfiles.filter((p) => p.rol === 'RESIDENTE' && p.estado === 'APROBADO' && p.unidadId === cuota.unidadId && p.email);
    for (const r of residentes) {
      await enviarCorreo(
        r.email,
        `${titulo} · ${c.nombre}`,
        [
          `Hola${r.nombre ? ` ${r.nombre}` : ''}:`,
          `Tu ${String(cuota.concepto).toLowerCase()} de ${mxn(Number(cuota.monto) || 0)} en ${c.nombre} venció el ${fechaLarga(cuota.vence)} y no tenemos registrado tu pago ni un comprobante por revisar.`,
          `Por eso se agregó a tu cuenta un recargo por pago tardío de ${mxn(monto)}. Tu adeudo por esta cuota ahora es de ${mxn((Number(cuota.monto) || 0) + monto)}.`,
          'Puedes consultar tu estado de cuenta y subir tu comprobante en el portal de residentes, sección Finanzas. Si ya pagaste, sube tu comprobante para que la administración lo revise.',
        ],
        { texto: 'Ir al portal', url: PORTAL },
      );
    }
    n++;
  }
  return n;
}

/**
 * Cuota automática: si el condominio la tiene activa y hoy ya es (o pasó) su día de cargo, genera la cuota del mes
 * para cada unidad (no se duplica si ya existe) y avisa a cada unidad nueva. Solo meses cuya fecha de cargo es a
 * partir de cuotaAutomaticaDesde, para no cobrar meses anteriores al activarla.
 */
export async function generarCuotaAutomatica(c: Item, hoy = hoyMX()) {
  if (!c.cuotaAutomatica || c.activo === false) return 0;
  const periodo = hoy.slice(0, 7);
  const cargo = fechaCargo(c, periodo);
  if (hoy < cargo || cargo < (c.cuotaAutomaticaDesde ?? hoy)) return 0;
  const { nuevas, vence } = await crearCuotas(c, periodo);
  for (const x of nuevas) {
    await put('Aviso', {
      condominioId: c.id,
      unidadId: x.unidadId,
      tipo: 'PAGO',
      titulo: `Tu ${String(x.concepto).toLowerCase()}: ${mxn(Number(x.monto) || 0)}`,
      texto: `Ya está en tu estado de cuenta. Vence el ${fechaLarga(vence)}. Puedes ver los datos para pagar y subir tu comprobante en Finanzas.`,
      leido: false,
    });
  }
  return nuevas.length;
}

export const handler = async () => {
  // Lo que se genere o cancele queda firmado como «SIIA (automático)» y en el registro de actividad.
  firmarComo(SISTEMA);
  const hoy = hoyMX();
  const todos = await scan('Condominio');
  let cuotas = 0;
  for (const c of todos.filter((x) => x.cuotaAutomatica)) {
    try {
      const n = await generarCuotaAutomatica(c, hoy);
      cuotas += n;
      if (n) console.log(`${c.nombre}: ${n} cuota(s) generada(s)`);
    } catch (err) {
      console.error(c.id, err);
    }
  }
  const condos = todos.filter((c) => c.recargoActivo);
  let total = 0;
  for (const c of condos) {
    try {
      const n = await aplicarRecargos(c, hoy);
      total += n;
      if (n) console.log(`${c.nombre}: ${n} recargo(s)`);
    } catch (err) {
      console.error(c.id, err);
    }
  }
  await guardarActividad('auto.cuotas', SISTEMA, tomarCambios()).catch((e) => console.error('actividad', e));
  return { hoy, cuotas, recargos: total };
};
