// Tarea diaria (00:15, hora de México): primero genera las cuotas automáticas del mes (generarCuotaAutomatica)
// y después aplica los recargos.
// Recargo por pago tardío. En los condominios que lo tienen activo, al día siguiente del vencimiento
// se carga el recargo a cada cuota de mantenimiento que siga sin pagar, siempre que la unidad no tenga
// ningún comprobante subido en revisión (por aprobar). Un solo recargo por cuota (id «<unidad>#<periodo>#recargo»),
// solo para cuotas que vencen después de activarlo (recargoDesde).
// Al final, el aviso de pago vencido (avisarVencidos): a cada unidad con una cuota recién vencida le llega su estado de
// cuenta pendiente por notificación (portal y app), por correo o por ambos, según Condominio.avisoMorosidad.
import { byIndex, hoyMX, put, scan, update, type Item } from '../shared/db';
import { operando } from '../shared/condominios';
import { crearCuotas, fechaCargo } from '../shared/cuotas';
import { enviarCorreo } from '../shared/correo';
import { armarAviso, fechaLarga, mxn } from './aviso-vencido';
import { SISTEMA, firmarComo, tomarCambios } from '../shared/firma';
import { guardarActividad } from '../shared/actividad';

const PORTAL = process.env.PORTAL_URL ?? 'https://staging.siia.casa/portal/';

export async function aplicarRecargos(c: Item, hoy = hoyMX()) {
  const monto = Number(c.recargoMonto);
  if (!c.recargoActivo || !(monto > 0) || c.activo === false || !operando(c)) return 0;
  const desde: string = c.recargoDesde ?? hoy;
  const [cargos, pagos] = await Promise.all([byIndex('Cargo', 'byCondominio', 'condominioId', c.id), byIndex('Pago', 'byCondominio', 'condominioId', c.id)]);
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
          tipo: 'RECARGO',
        },
        { ifNotExists: 'id' },
      );
    } catch (err: any) {
      if (err?.name === 'ConditionalCheckFailedException') continue;
      throw err;
    }
    n++;
  }
  return n;
}

/**
 * Aviso de pago vencido: una vez por cuota, al día siguiente de su vencimiento (o el primer día que se revise), a cada
 * unidad que no haya pagado ni tenga un comprobante en revisión. Lleva todo lo pendiente de la unidad (incluido el
 * recargo recién aplicado). Condominios que nunca eligieron cómo avisar: como antes, solo con el recargo activo y por
 * notificación.
 */
export async function avisarVencidos(c: Item, hoy = hoyMX()) {
  if (c.activo === false || !operando(c)) return 0;
  const desde: string | undefined = c.avisoMorosidadDesde ?? (c.recargoActivo ? c.recargoDesde : undefined);
  if (!desde) return 0;
  const modo: string = c.avisoMorosidad ?? 'NOTIFICACION';
  const [cargos, pagos, perfiles, unidades] = await Promise.all([
    byIndex('Cargo', 'byCondominio', 'condominioId', c.id),
    byIndex('Pago', 'byCondominio', 'condominioId', c.id),
    byIndex('Perfil', 'byCondominio', 'condominioId', c.id),
    byIndex('Unidad', 'byCondominio', 'condominioId', c.id),
  ]);
  const enRevision = new Set(pagos.filter((p) => p.estado === 'EN_REVISION').map((p) => p.unidadId));
  const porId = new Map(cargos.map((x) => [x.id, x]));
  const vencidas = cargos.filter(
    (x) => String(x.id).endsWith('#cuota') && x.estado === 'PENDIENTE' && x.vence && x.vence < hoy && x.vence >= desde && !x.avisoVencido && !enRevision.has(x.unidadId),
  );
  const porUnidad = new Map<string, Item[]>();
  for (const x of vencidas) porUnidad.set(x.unidadId, [...(porUnidad.get(x.unidadId) ?? []), x]);

  let n = 0;
  for (const [unidadId, nuevas] of porUnidad) {
    // Se marca antes de avisar: si algo falla, no se repite el aviso mañana.
    for (const x of nuevas) await update('Cargo', { id: x.id }, { avisoVencido: hoy });
    // Cuotas a las que ya se les aplicó el recargo otro día: ese aviso ya se envió (versión anterior).
    const pendientes = nuevas.filter((x) => !(porId.get(String(x.id).replace(/#cuota$/, '#recargo'))?.vence < hoy));
    if (!pendientes.length) continue;
    const unidad = unidades.find((u) => u.id === unidadId)?.etiqueta ?? 'Tu unidad';
    const datos = {
      condominio: c as any,
      unidad,
      cargos: cargos.filter((x) => x.unidadId === unidadId && x.estado === 'PENDIENTE') as any,
      nuevos: pendientes.map((x) => x.id),
      hoy,
      portal: PORTAL,
    };
    if (modo !== 'CORREO') {
      const a = armarAviso(datos);
      await put('Aviso', { condominioId: c.id, unidadId, tipo: 'PAGO', titulo: a.avisoTitulo, texto: a.avisoTexto, leido: false });
    }
    if (modo !== 'NOTIFICACION') {
      const residentes = perfiles.filter((p) => p.rol === 'RESIDENTE' && p.estado === 'APROBADO' && p.unidadId === unidadId && p.email);
      for (const r of residentes) {
        const a = armarAviso({ ...datos, nombre: r.nombre });
        await enviarCorreo(r.email, a.asunto, a.contenido, a.texto);
      }
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
  if (!c.cuotaAutomatica || c.activo === false || !operando(c)) return 0;
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
  let avisos = 0;
  for (const c of todos) {
    try {
      const n = await avisarVencidos(c, hoy);
      avisos += n;
      if (n) console.log(`${c.nombre}: ${n} aviso(s) de pago vencido`);
    } catch (err) {
      console.error(c.id, err);
    }
  }
  await guardarActividad('auto.cuotas', SISTEMA, tomarCambios()).catch((e) => console.error('actividad', e));
  return { hoy, cuotas, recargos: total, avisos };
};
